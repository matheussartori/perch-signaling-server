import { createServer, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'
import { RoomRegistry } from './RoomRegistry'
import { isSessionRole, RELAYABLE_KINDS, type RelayableKind, type SignalMessage } from './types'

/** Per-connection state we carry between messages once a socket has joined. */
interface Connection {
  /** The room code this socket joined, or `null` until it sends a valid join. */
  code: string | null
}

/**
 * WebSocket signaling server: brokers WebRTC handshakes between two peers that
 * share a room code and relays nothing else. Media never touches this process.
 *
 * WHY a class: it bundles the `ws` server, the room registry, and the
 * connection lifecycle so `index.ts` can start/stop it without knowing details.
 */
export class SignalingServer {
  private readonly registry = new RoomRegistry()
  private wss: WebSocketServer | null = null
  private http: Server | null = null

  constructor(private readonly port: number) {}

  /** Start listening. Resolves once the socket is bound to the port. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // WHY an http.Server under the WS server: a bare WebSocketServer rejects
      // plain HTTP, so hosting platforms (Fly/Render/Railway) see their health
      // probe fail and never route traffic. Answering GET /healthz on the same
      // port fixes that; WebSocket upgrades ride on top of the same listener.
      const http = createServer((req, res) => {
        if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.end('ok')
          return
        }
        res.writeHead(404)
        res.end()
      })
      const wss = new WebSocketServer({ server: http })
      this.http = http
      this.wss = wss
      wss.on('connection', (ws) => this.handleConnection(ws))
      http.on('error', reject)
      // Bind all interfaces so containers/VPS accept external traffic, not just loopback.
      http.listen(this.port, () => resolve())
    })
  }

  /** Stop listening and close every open socket. Resolves once fully closed. */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) return resolve()
      for (const client of this.wss.clients) client.close()
      this.wss.close(() => {
        if (this.http) return this.http.close(() => resolve())
        resolve()
      })
    })
  }

  private handleConnection(ws: WebSocket): void {
    const conn: Connection = { code: null }
    console.log('[signal] connection opened')

    ws.on('message', (raw) => this.handleMessage(ws, conn, raw))

    ws.on('close', () => {
      if (conn.code === null) {
        console.log('[signal] connection closed before join')
        return
      }
      // Removing notifies the surviving peer and reclaims the room if empty.
      this.registry.leave(conn.code, ws)
      console.log(`[signal] leave room=${conn.code} (${this.registry.size} room(s) active)`)
    })

    // A transport-level error will be followed by a `close`; just log it.
    ws.on('error', (err) => console.error('[signal] socket error:', err.message))
  }

  private handleMessage(ws: WebSocket, conn: Connection, raw: RawData): void {
    let message: SignalMessage
    try {
      message = JSON.parse(raw.toString()) as SignalMessage
    } catch {
      return this.fail(ws, 'Malformed message: expected JSON')
    }

    if (conn.code === null) {
      this.handleJoin(ws, conn, message)
      return
    }

    // Already joined: only peer-directed messages are accepted from here on.
    if (isRelayable(message)) {
      this.registry.getOrCreate(conn.code).relay(ws, message)
      return
    }
    this.fail(ws, `Unexpected message "${(message as { kind?: string }).kind}" after join`)
  }

  private handleJoin(ws: WebSocket, conn: Connection, message: SignalMessage): void {
    if (message.kind !== 'join') {
      return this.fail(ws, 'First message must be a "join"')
    }
    if (typeof message.code !== 'string' || message.code.length === 0) {
      return this.fail(ws, 'Join requires a non-empty room code')
    }
    if (!isSessionRole(message.role)) {
      return this.fail(ws, 'Join requires role "host" or "controller"')
    }

    const room = this.registry.getOrCreate(message.code)
    const result = room.add(ws, message.role)
    if (!result.ok) {
      // Drop the room again if this failed join left it empty (e.g. first-ever
      // join was rejected), so a bad attempt never leaks a room.
      this.registry.leave(message.code, ws)
      return this.fail(ws, result.message)
    }

    conn.code = message.code
    console.log(`[signal] join room=${message.code} role=${message.role}`)

    // If the peer was already waiting, introduce both sides now.
    room.broadcastPeerJoinedTo(ws)
  }

  /** Send an error frame and close the socket — the client cannot continue. */
  private fail(ws: WebSocket, message: string): void {
    console.warn(`[signal] rejecting connection: ${message}`)
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ kind: 'error', message } satisfies SignalMessage))
    }
    ws.close()
  }
}

/** True when a message is one a joined peer may have relayed to the other side. */
function isRelayable(message: SignalMessage): message is SignalMessage & { kind: RelayableKind } {
  return (RELAYABLE_KINDS as readonly string[]).includes(message.kind)
}
