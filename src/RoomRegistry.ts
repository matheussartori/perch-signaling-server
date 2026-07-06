import type { WebSocket } from 'ws'
import { Room } from './Room'

/**
 * Owns the set of live rooms, keyed by room code.
 *
 * WHY on-demand creation + eager cleanup: room codes are ephemeral and
 * unbounded (any string a client dials), so we must never accumulate empty
 * rooms. A room exists exactly while at least one peer is connected to it.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>()

  /** Return the room for `code`, creating it on first use. */
  getOrCreate(code: string): Room {
    let room = this.rooms.get(code)
    if (!room) {
      room = new Room()
      this.rooms.set(code, room)
    }
    return room
  }

  /**
   * Remove a socket from its room, letting the room notify the surviving peer,
   * then discard the room if it is now empty. Safe to call for codes with no
   * room (e.g. a socket that closed before completing its join).
   */
  leave(code: string, ws: WebSocket): void {
    const room = this.rooms.get(code)
    if (!room) return
    room.remove(ws)
    if (room.isEmpty()) this.rooms.delete(code)
  }

  /** Number of active rooms — handy for logging/observability. */
  get size(): number {
    return this.rooms.size
  }
}
