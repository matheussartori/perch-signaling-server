# Perch Signaling Server

WebSocket signaling server for [Perch](https://github.com/matheussartori/perch-desktop). It pairs two peers that share a perch code and relays the WebRTC handshake between them.

[![Node.js](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

On a LAN, Perch doesn't need a server: the host app embeds its own rendezvous. This server exists for pairing machines on different networks. You host it somewhere public, both peers connect out to it and find each other by the perch code, so no IPs are exchanged and no router ports need to be opened. It only relays signaling messages. Once the handshake completes, screen, audio and input flow directly peer-to-peer and never pass through this process.

Some details worth knowing:

- It relays `join`, `offer`/`answer`, `ice` and `peer-joined`/`peer-left` verbatim between the two sides of a room. No media, no input, and it doesn't inspect payloads (ICE candidates pass through untyped).
- Each room holds exactly one `host` and one `controller`. The server introduces them with `peer-joined`, notifies the survivor with `peer-left`, and reclaims empty rooms immediately.
- The first frame must be a valid `join` (non-empty code, valid role). Anything malformed or out of order gets an `error` frame and a closed socket, without leaking a room.
- It answers `GET /healthz` with `ok` on the same port as the WebSocket, reads `process.env.PORT`, and shuts down cleanly on `SIGINT`/`SIGTERM`, so it plays well with PaaS platforms.
- It's about 340 lines of TypeScript on top of [`ws`](https://github.com/websockets/ws), run with `tsx`. A generic `Dockerfile` is included.
- Scale-to-zero hosting works: the Perch client reconnects with backoff ("Waking the server…") while a sleeping free-tier instance spins back up.
- A ready-to-run [coturn](https://github.com/coturn/coturn) TURN setup lives in [`turn/`](./turn/README.md) for the NAT-traversal half of the problem.

## How it works

```
  Host (network A)                                     Controller (network B)
  ┌──────────────┐        ┌──────────────────┐         ┌──────────────┐
  │  Perch app   │── ws ─►│ signaling server │◄── ws ──│  Perch app   │
  └──────────────┘        │  (public, this)  │         └──────────────┘
         │                └──────────────────┘                │
         │           join / offer / answer / ice              │
         │                                                    │
         └────────────── WebRTC P2P, direct ──────────────────┘
                screen · audio · input — never through here
```

1. Each client opens a WebSocket and sends `{ "kind": "join", "code": "<perch code>", "role": "host" | "controller" }`.
2. The server pairs the `host` with the `controller` in the same room (capacity 2) and announces each side to the other with `peer-joined`.
3. From then on it relays `offer` / `answer` / `ice` / `peer-left` verbatim to the opposite peer. Nothing else is accepted.
4. Once the WebRTC link is up, the peers talk directly. When both disconnect, the room is freed.

The wire contract lives in [`src/types.ts`](./src/types.ts), kept in sync with the desktop app's `src/domain/signaling/SignalMessage.ts`.

## Getting started

Requires Node 20+.

```bash
git clone https://github.com/matheussartori/perch-signaling-server.git
cd perch-signaling-server
npm install
npm start            # ws://localhost:8787 — set PORT to override
```

Check that it's up:

```bash
curl http://localhost:8787/healthz   # → ok
```

Point a Perch build at it via the desktop repo's `.env`:

```dotenv
VITE_SIGNAL_URL=ws://localhost:8787
```

## Deployment

Any platform that builds a `Dockerfile`, injects `PORT` and terminates TLS in front will do: Koyeb, Fly.io, Render, Railway, or a VPS behind Caddy/nginx. Without Docker, `npm install && npm start` behind a TLS proxy works the same. Clients must use the `wss://` form of the public URL.

### Koyeb (free tier, scale-to-zero)

Koyeb's free instance sleeps when idle and cold-starts on the next connection. That's fine here, since the Perch client tolerates it.

1. Push this repo to GitHub.
2. In Koyeb: Create Service → GitHub → pick this repo. Koyeb auto-detects the `Dockerfile`.
3. Instance: the free "nano" type, with min scale = 0 so it sleeps when idle.
4. Port / health check: Koyeb injects `PORT` automatically, leave it. Set the HTTP health check path to `/healthz`.
5. Deploy. You get a URL like `https://perch-signal-yourorg.koyeb.app`. Verify with `curl https://.../healthz` → `ok` (the first request may take a few seconds while the instance wakes).

Then bake the `wss://` URL into the Perch build:

```dotenv
VITE_SIGNAL_URL=wss://perch-signal-yourorg.koyeb.app
```

About the sleeping: when the instance is asleep, the first WebSocket attempt can fail or stall while the container spins back up. The Perch client retries with backoff (showing "Waking the server…") until it's up. An active session keeps a WebSocket open, which counts as live traffic, so the instance won't sleep mid-session. Once both peers disconnect, the platform scales back to zero on its own.

## TURN relay (NAT traversal)

Signaling only gets the two peers introduced; it doesn't get their media through difficult NATs. STUN-only pairing fails behind symmetric NAT, CGNAT (common on mobile carriers) and strict corporate firewalls. Those sessions need a TURN relay to carry the media.

A self-hosted [coturn](https://github.com/coturn/coturn) setup, with provisioning, config, verification and hardening notes, lives in [`turn/`](./turn/README.md). Since TURN carries real audio/video, run it on a VPS with a public IP rather than a scale-to-zero PaaS. Managed alternatives (Metered, Cloudflare, Twilio) also work. Either way, point the Perch client at it via `VITE_ICE_SERVERS` in the desktop repo's `.env`.

Test the app first: you only need TURN if direct P2P fails between your networks.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port. PaaS platforms inject their own; the default matches what the Perch desktop app dials out of the box. |

Rooms live in memory. There is no database and no state to persist.

## Development

```bash
npm run dev          # tsx watch — reloads on change
npm run typecheck    # tsc --noEmit
```

| Command | Description |
| --- | --- |
| `npm start` | Run the server (`tsx src/index.ts`) |
| `npm run dev` | Run with reload on change |
| `npm run typecheck` | Type-check with `tsc --noEmit` |

Quick manual smoke test with [`wscat`](https://github.com/websockets/wscat):

```bash
wscat -c ws://localhost:8787
> {"kind":"join","code":"ABC-DEF-GHJ","role":"host"}
# second terminal: join the same code as "controller" → both receive peer-joined
```

## Architecture

Small, layered and framework-free. It's the same code the desktop app embeds for LAN mode, packaged as its own deployable:

```
src/
  index.ts             Entry: env-driven port, startup logging, SIGINT/SIGTERM shutdown
  SignalingServer.ts   ws + http server: connection lifecycle, join validation,
                       relay routing, /healthz on the same port
  RoomRegistry.ts      Room lookup by code; reclaims empty rooms
  Room.ts              One host + one controller; peer introduction and relay
  types.ts             The wire contract (SignalMessage, SessionRole) — local
                       mirror of the perch-desktop domain types
turn/                  Self-hosted coturn TURN relay (docker compose + conf)
Dockerfile             Generic node:22-alpine image with a /healthz HEALTHCHECK
```

A few decisions worth explaining:

- The wire contract is duplicated on purpose. This repo must not reach into the desktop app's source tree, so [`src/types.ts`](./src/types.ts) documents which app files to keep it in sync with.
- HTTP is served under the WebSocket server because a bare `WebSocketServer` rejects plain HTTP, which makes PaaS health probes fail and traffic never route. Answering `GET /healthz` on the same listener fixes that.
- Invalid first frames, malformed JSON and out-of-contract messages all get an `error` frame and a closed socket.

Part of the Perch ecosystem:

| Repo | Role |
| --- | --- |
| [perch-desktop](https://github.com/matheussartori/perch-desktop) | The Electron app — host & control machines over WebRTC |
| perch-signaling-server | This repo — the hosted rendezvous for internet mode, plus the TURN relay setup |

## Support

Perch is a solo, open-source project. If it's useful to you and you want to help fund its development, you can buy me a coffee.

<a href="https://buymeacoffee.com/mattsartori">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="50" />
</a>

## License

[MIT](./LICENSE) © [Matheus Sartori](https://github.com/matheussartori)
