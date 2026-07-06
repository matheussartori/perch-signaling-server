# Perch TURN relay (coturn)

The signaling server (this repo's root) only brokers the WebRTC **handshake**.
When two machines can't reach each other directly — symmetric NAT, mobile
carriers/CGNAT, strict corporate firewalls — the peer-to-peer link fails and the
media has to be **relayed**. That relay is TURN, and this folder is a ready-to-run
[coturn](https://github.com/coturn/coturn) deployment.

You only need this if STUN-only pairing fails between your networks — test the
app first. When you do need it, it carries real audio/video, so it lives on a
**VPS with a public IP** (Hetzner, DigitalOcean, …), **not** on Koyeb.

## 1. Provision

On a small VPS (1 vCPU / 1 GB is fine for 1:1 use) with Docker installed. Open
the firewall — these are ports on **your VPS**, not on anyone's home router:

```bash
# UDP + TCP 3478 (STUN/TURN control) and the UDP relay range from turnserver.conf
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
```

## 2. Configure

Edit `turnserver.conf` and replace every `REPLACE_` value:

- `external-ip` → your VPS public IPv4.
- `realm` → your domain or the IP.
- `user` → `USERNAME:PASSWORD`. Generate a strong password:
  ```bash
  openssl rand -base64 24
  ```
  These credentials get baked into the Perch client, so they are **not secret** —
  the `total-quota` / `user-quota` in the conf are what cap abuse.

## 3. Run

```bash
docker compose up -d
docker compose logs -f      # watch it start; look for "Relay ... initialized"
```

## 4. Verify

Use the WebRTC **Trickle ICE** test page
(`https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`):
add `turn:YOUR_VPS_IP:3478`, your username/password, and click *Gather* — you
should see a candidate of type **`relay`**. If you only ever see `srflx`/`host`,
TURN isn't reachable (check the firewall and `external-ip`).

## 5. Point Perch at it

In the perch-desktop repo's `.env`, set `VITE_ICE_SERVERS` to include the relay
(both UDP and TCP transports — TCP is the fallback when UDP is blocked):

```
VITE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:YOUR_VPS_IP:3478?transport=udp","username":"USER","credential":"PASS"},{"urls":"turn:YOUR_VPS_IP:3478?transport=tcp","username":"USER","credential":"PASS"}]
```

Then rebuild: `npm run dist:*`. Now cross-network sessions fall back to the relay
when direct P2P can't be established.

## Hardening later (optional)

- **TLS TURN (`turns:` on 5349):** lets TURN traverse firewalls that only allow
  443/TLS. Needs a cert (mount one and add `tls-listening-port=5349`,
  `cert=`, `pkey=`).
- **Ephemeral credentials:** instead of static creds in the binary, coturn's
  `use-auth-secret` mints time-limited credentials from a shared secret. In
  Perch that would mean the signaling server sends fresh ICE config over the
  WebSocket at join time (stays within the app's CSP). Bigger change — static
  creds + quotas are fine to start.
