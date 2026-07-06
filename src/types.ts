/**
 * Local mirror of the app's signaling contract.
 *
 * WHY duplicate this instead of importing from the app? The signaling server is
 * a separate deployable (its own repo) with its own lifecycle and dependency
 * graph; it must not reach into the desktop app's source tree. Keep this file in
 * sync with the perch-desktop repo's `src/domain/signaling/SignalMessage.ts` and
 * `src/domain/session/SessionRole.ts` whenever the wire contract changes.
 */

/** Which side of a session a peer is on (see app's SessionRole). */
export type SessionRole = 'host' | 'controller'

/**
 * Messages exchanged with the signaling server to broker a peer connection.
 * The server only relays these until a direct WebRTC link is established;
 * no media ever passes through it.
 *
 * `candidate` is typed loosely (`unknown`) on purpose: the server relays ICE
 * candidates verbatim and never inspects them, so it has no reason to depend on
 * the browser's `RTCIceCandidateInit` DOM type.
 */
export type SignalMessage =
  | { readonly kind: 'join'; readonly code: string; readonly role: SessionRole }
  | { readonly kind: 'peer-joined'; readonly role: SessionRole }
  | { readonly kind: 'peer-left' }
  | { readonly kind: 'offer'; readonly sdp: string }
  | { readonly kind: 'answer'; readonly sdp: string }
  | { readonly kind: 'ice'; readonly candidate: unknown }
  | { readonly kind: 'error'; readonly message: string }

/** Message kinds a joined client may send to be relayed to its peer. */
export const RELAYABLE_KINDS = ['offer', 'answer', 'ice', 'peer-left'] as const
export type RelayableKind = (typeof RELAYABLE_KINDS)[number]

/** Narrowing guard for `SessionRole`. */
export function isSessionRole(value: unknown): value is SessionRole {
  return value === 'host' || value === 'controller'
}
