# Perch signaling server

A tiny standalone WebSocket server that brokers WebRTC handshakes between two
Perch peers sharing a room code. It relays **signaling only** — `join`,
`offer`/`answer`, `ice`, `peer-joined`/`peer-left`. No audio, video, or input
ever passes through it; once the handshake completes, media flows directly
peer-to-peer.

This is what lets Perch pair two machines **without knowing each other's IP and
without opening any port on a router**: both the host and the controller dial
_out_ to this server (which you host once, publicly), and they find each other
by the perch code alone.

## Contract

Clients open a WebSocket and send `{ "kind": "join", "code": "<room>", "role": "host" | "controller" }`.
The server pairs a `host` with a `controller` in the same room (capacity 2),
announces each side to the other with `peer-joined`, and relays
`offer` / `answer` / `ice` / `peer-left` verbatim to the opposite peer. It also
answers `GET /healthz` → `ok` on the same port, so platform health checks pass.

## Run locally

```
npm install
npm start          # ws://localhost:8787  (set PORT to override)
npm run dev        # same, with reload on change
npm run typecheck
```

## Deploy on Koyeb (free tier, scale-to-zero)

Koyeb's free instance **sleeps when idle** and cold-starts on the next
connection. That's fine — the Perch client is built to tolerate it (see below).

1. Push this repo to GitHub.
2. In Koyeb: **Create Service → GitHub →** pick this repo. Koyeb auto-detects the
   `Dockerfile`.
3. **Instance:** the free "nano" type. Set **min scale = 0** so it sleeps when
   idle (the whole point of the free tier).
4. **Port / health check:** Koyeb injects `PORT` automatically — `index.ts`
   reads `process.env.PORT`, so leave it. Set the HTTP **health check path to
   `/healthz`**.
5. Deploy. You get a public URL like `https://perch-signal-yourorg.koyeb.app`.
   Verify: `curl https://perch-signal-yourorg.koyeb.app/healthz` → `ok`
   (the first request may take a few seconds while the instance wakes).

Your Perch client dials the **`wss://`** form of that URL (TLS is terminated by
Koyeb):

```
VITE_SIGNAL_URL=wss://perch-signal-yourorg.koyeb.app
```

### How sleeping is handled

- **Cold start on connect:** when the instance is asleep, the first WebSocket
  attempt can fail or stall while Koyeb spins the container back up. The Perch
  client **retries the WebSocket with backoff** (showing "Waking the server…")
  until it's up — no HTTP ping needed, so it stays within the app's strict CSP.
- **Staying awake mid-session:** an active session keeps a WebSocket open, which
  Koyeb counts as live traffic, so it won't sleep while someone is connected.
- **Idle → sleep:** once both peers disconnect the room is freed and, with no
  open connections, Koyeb scales the instance back to zero on its own.

## TURN (NAT traversal) — separate concern

This server does **not** do NAT traversal. STUN alone fails behind many
home/corporate NATs, so cross-network sessions also need a TURN relay (managed:
Metered/Cloudflare/Twilio, or self-hosted `coturn`). Point the client at it via
`VITE_ICE_SERVERS` (a JSON array of `RTCIceServer`). See the perch-desktop repo's
`.env.example`.

## Other platforms

The `Dockerfile` is generic: any platform that builds a Dockerfile, injects
`PORT`, and terminates TLS works the same way (Fly, Render, Railway, a VPS behind
Caddy/nginx). Without Docker: `npm install && npm start` behind a TLS proxy.
