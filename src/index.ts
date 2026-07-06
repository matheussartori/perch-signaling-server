import { SignalingServer } from './SignalingServer'

/**
 * Entry point for the Perch signaling server.
 *
 * WHY env-driven port with a default: the desktop app dials
 * `ws://localhost:8787` out of the box, but a deployment can override `PORT`
 * without a code change.
 */
const port = Number(process.env.PORT ?? 8787)

const server = new SignalingServer(port)

server
  .start()
  .then(() => {
    console.log(`[signal] Perch signaling server listening on port ${port} (health: GET /healthz)`)
  })
  .catch((err: unknown) => {
    console.error('[signal] failed to start:', err)
    process.exit(1)
  })

// Close sockets and release the port on shutdown so restarts don't hit
// EADDRINUSE. SIGINT = Ctrl-C locally; SIGTERM = how containers/PaaS stop us.
const shutdown = () => {
  console.log('\n[signal] shutting down…')
  server.stop().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
