import type { WebSocket } from 'ws'
import type { SessionRole, SignalMessage } from './types'

/** Result of attempting to add a member; failures carry a user-facing reason. */
export type AddResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

/**
 * A single rendezvous point for exactly two peers that share a room code.
 *
 * WHY keyed by WebSocket: the socket is the only stable identity the server has
 * for a peer (a role is not unique enough — both sides could momentarily race),
 * so membership, relaying, and cleanup all pivot on the socket instance.
 */
export class Room {
  /** Sockets mapped to the role they claimed on join. Capacity is two. */
  private readonly members = new Map<WebSocket, SessionRole>()

  /**
   * Admit a socket under `role`. Rejects when the room is full or the role is
   * already occupied, so a host and a controller can never be confused for two
   * hosts (which would make relaying ambiguous).
   */
  add(ws: WebSocket, role: SessionRole): AddResult {
    if (this.members.has(ws)) return { ok: true }
    if (this.members.size >= 2) {
      return { ok: false, message: 'Room is full' }
    }
    for (const takenRole of this.members.values()) {
      if (takenRole === role) {
        return { ok: false, message: `Role "${role}" is already taken in this room` }
      }
    }
    this.members.set(ws, role)
    return { ok: true }
  }

  /** Drop a socket from the room and tell the surviving peer it left. */
  remove(ws: WebSocket): void {
    if (!this.members.delete(ws)) return
    // Only one peer can remain (capacity two), so notify it directly.
    for (const [otherWs] of this.members) {
      this.send(otherWs, { kind: 'peer-left' })
    }
  }

  /**
   * Forward a relayable message to the *other* member. The server never echoes
   * a message back to its sender — signaling is strictly peer-to-peer.
   */
  relay(fromWs: WebSocket, message: SignalMessage): void {
    for (const [ws] of this.members) {
      if (ws !== fromWs) this.send(ws, message)
    }
  }

  /**
   * Once both peers are present, tell EACH side who the other is. Both learn
   * the peer's role so the controller knows it may begin the WebRTC offer.
   *
   * No-op until the room is full: a lone first peer has nobody to be told about.
   */
  broadcastPeerJoinedTo(newWs: WebSocket): void {
    if (this.members.size < 2) return
    const newRole = this.members.get(newWs)
    if (!newRole) return
    for (const [ws, role] of this.members) {
      if (ws === newWs) {
        // Newcomer hears about the peer that was already waiting.
        continue
      }
      this.send(ws, { kind: 'peer-joined', role: newRole })
      this.send(newWs, { kind: 'peer-joined', role })
    }
  }

  /** True when the room has no members and can be reclaimed by the registry. */
  isEmpty(): boolean {
    return this.members.size === 0
  }

  /** Serialize and send a message, skipping sockets that are not open. */
  private send(ws: WebSocket, message: SignalMessage): void {
    // 1 === WebSocket.OPEN; guard against sending to a closing/closed socket.
    if (ws.readyState !== 1) return
    ws.send(JSON.stringify(message))
  }
}
