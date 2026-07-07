<h1 align="center">Perch Signaling Server</h1>

<p align="center">
  The rendezvous point for <a href="https://github.com/matheussartori/perch-desktop">Perch</a> — a tiny WebSocket server that brokers WebRTC handshakes between two peers sharing a perch code.
</p>

<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node.js" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://github.com/websockets/ws"><img src="https://img.shields.io/badge/ws-8-010101?logo=socketdotio&logoColor=white" alt="ws" /></a>
  <a href="./Dockerfile"><img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
  <a href="https://buymeacoffee.com/mattsartori"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black" alt="Buy Me a Coffee" /></a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#getting-started">Getting Started</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#turn-relay-nat-traversal">TURN Relay</a> ·
  <a href="#development">Development</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#support">Support</a>
</p>

This server is the **internet-mode companion** to
[Perch](https://github.com/matheussartori/perch-desktop), the portable
remote-control desktop app. On a LAN, Perch needs no server at all — the host
app embeds its own rendezvous. To pair two machines on **different networks**,
you host this standalone server once, publicly: both peers dial *out* to it,
find each other by the perch code alone — **no IPs exchanged, no router ports
opened** — and complete the WebRTC handshake. It relays **signaling only**;
once the handshake completes, screen, audio, and input flow directly
peer-to-peer and never touch this process.

## Features

- **Signaling only, ever** — relays `join`, `offer`/`answer`, `ice`,
  `peer-joined`/`peer-left` verbatim between the two sides of a room. No media,
  no input, no inspection of payloads (ICE candidates pass through untyped).
- **Room pairing by perch code** — each room holds exactly one `host` and one
  `controller`; the server introduces them with `peer-joined` and notifies the
  survivor with `peer-left`. Empty rooms are reclaimed immediately.
- **Strict at the edge** — the first frame must be a valid `join` (non-empty
  code, valid role); anything malformed or out-of-order gets an `error` frame
  and a closed socket. Failed joins never leak a room.
- **PaaS-friendly by design** — answers `GET /healthz` → `ok` on the same port
  the WebSocket upgrades ride on, so platform health probes pass; reads
  `process.env.PORT`; shuts down cleanly on `SIGINT`/`SIGTERM` so restarts
  never hit `EADDRINUSE`.
- **Tiny and dependency-light** — ~340 lines of TypeScript on top of
  [`ws`](https://github.com/websockets/ws), run directly with `tsx`. One
  generic `Dockerfile` deploys it anywhere.
- **Scale-to-zero tolerant** — pairs with the Perch client's
  reconnect-with-backoff ("Waking the server…"), so free-tier instances that
  sleep when idle work fine.
- **TURN relay included** — a ready-to-run [coturn](https://github.com/coturn/coturn)
  deployment for the NAT-traversal half of the problem lives in
  [`turn/`](./turn/README.md).

## How It Works

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

1. Each client opens a WebSocket and sends
   `{ "kind": "join", "code": "<perch code>", "role": "host" | "controller" }`.
2. The server pairs the `host` with the `controller` in the same room
   (capacity 2) and announces each side to the other with `peer-joined`.
3. From then on it relays `offer` / `answer` / `ice` / `peer-left` verbatim to
   the opposite peer — nothing else is accepted.
4. Once the WebRTC link is up, the peers talk directly; when both disconnect,
   the room is freed.

The wire contract lives in [`src/types.ts`](./src/types.ts), kept in sync with
the desktop app's `src/domain/signaling/SignalMessage.ts`.

## Getting Started

Requires **Node 20+**.

```bash
git clone https://github.com/matheussartori/perch-signaling-server.git
cd perch-signaling-server
npm install
npm start            # ws://localhost:8787 — set PORT to override
```

Verify it's up:

```bash
curl http://localhost:8787/healthz   # → ok
```

Point a Perch build at it via the desktop repo's `.env`:

```dotenv
VITE_SIGNAL_URL=ws://localhost:8787
```

## Deployment

Any platform that builds a `Dockerfile`, injects `PORT`, and terminates TLS in
front works: **Koyeb, Fly.io, Render, Railway, or a VPS behind Caddy/nginx**.
Without Docker, `npm install && npm start` behind a TLS proxy does the same.
Clients must dial the **`wss://`** form of the public URL.

### Koyeb (free tier, scale-to-zero)

Koyeb's free instance **sleeps when idle** and cold-starts on the next
connection — fine, because the Perch client is built to tolerate it.

1. Push this repo to GitHub.
2. In Koyeb: **Create Service → GitHub →** pick this repo. Koyeb auto-detects
   the `Dockerfile`.
3. **Instance:** the free "nano" type, with **min scale = 0** so it sleeps when
   idle (the whole point of the free tier).
4. **Port / health check:** Koyeb injects `PORT` automatically — leave it. Set
   the HTTP **health check path to `/healthz`**.
5. Deploy. You get a URL like `https://perch-signal-yourorg.koyeb.app`. Verify
   with `curl https://.../healthz` → `ok` (the first request may take a few
   seconds while the instance wakes).

Then bake the `wss://` URL into the Perch build:

```dotenv
VITE_SIGNAL_URL=wss://perch-signal-yourorg.koyeb.app
```

**How sleeping is handled** — when the instance is asleep, the first WebSocket
attempt can fail or stall while the container spins back up; the Perch client
retries with backoff (showing *"Waking the server…"*) until it's up. An active
session keeps a WebSocket open, which counts as live traffic, so the instance
won't sleep mid-session. Once both peers disconnect, the room is freed and the
platform scales back to zero on its own.

## TURN Relay (NAT traversal)

Signaling gets the two peers *introduced*; it does **not** get their media
through hostile NATs. STUN-only pairing fails behind symmetric NAT, CGNAT
(mobile carriers), and strict corporate firewalls — those sessions need a
**TURN relay** to carry the media.

A ready-to-run self-hosted [coturn](https://github.com/coturn/coturn) setup —
provisioning, config, verification, and hardening notes — lives in
[`turn/`](./turn/README.md). Since TURN carries real audio/video, it belongs on
a **VPS with a public IP**, not on a scale-to-zero PaaS. Managed alternatives
(Metered, Cloudflare, Twilio) work too. Either way, point the Perch client at
it via `VITE_ICE_SERVERS` in the desktop repo's `.env`.

Test the app first — you only need TURN if direct P2P fails between your
networks.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port. PaaS platforms inject their own; the default matches what the Perch desktop app dials out of the box. |

That's the whole surface — rooms live in memory, there is no database and no
state to persist.

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

A quick manual smoke test with [`wscat`](https://github.com/websockets/wscat):

```bash
wscat -c ws://localhost:8787
> {"kind":"join","code":"ABC-DEF-GHJ","role":"host"}
# second terminal: join the same code as "controller" → both receive peer-joined
```

## Architecture

Small, layered, and framework-free — the same code the desktop app embeds for
LAN mode, packaged as its own deployable:

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

- **The contract is duplicated on purpose** — this repo must not reach into the
  desktop app's source tree; [`src/types.ts`](./src/types.ts) documents which
  app files to keep it in sync with.
- **HTTP under the WebSocket server** — a bare `WebSocketServer` rejects plain
  HTTP, which makes PaaS health probes fail and traffic never route; answering
  `GET /healthz` on the same listener fixes that.
- **Fail-fast edges** — invalid first frames, malformed JSON, and
  out-of-contract messages all get an `error` frame and a closed socket.

Part of the Perch ecosystem:

| Repo | Role |
| --- | --- |
| [perch-desktop](https://github.com/matheussartori/perch-desktop) | The Electron app — host & control machines over WebRTC |
| **perch-signaling-server** | This repo — the hosted rendezvous for internet mode, plus the TURN relay setup |

## Support

Perch is a solo, open-source project. If it's useful to you and you'd like to
help fund its continued development, consider buying me a coffee — every bit is
genuinely appreciated. ☕

<p align="center">
  <a href="https://buymeacoffee.com/mattsartori">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="50" />
  </a>
</p>

## License

[MIT](./LICENSE) © [Matheus Sartori](https://github.com/matheussartori)
