import type { HexTile } from '@/types/game'
import { logger } from '@/lib/logger'

// Fan-out to connected clients, per ARCHITECTURE.md §8: every client subscribes to one channel
// and receives typed events (hex:updated, empire:eliminated, market:snapshot). This interface
// keeps the webhook handler decoupled from which vendor (Supabase Realtime, PartyKit, Socket.IO)
// actually carries the message — logged-only until one is configured.
export type RealtimeEvent =
  | { type: 'hex:updated'; hex: HexTile }
  | { type: 'empire:eliminated'; empireId: string }

export type Broadcaster = {
  publish(event: RealtimeEvent): Promise<void>
}

export const loggingBroadcaster: Broadcaster = {
  async publish(event) {
    logger.info('realtime broadcast (stub, no transport configured)', { type: event.type, event })
  },
}

// Swap this export for a Supabase Realtime / PartyKit / Socket.IO-backed implementation once one is chosen.
export const broadcaster: Broadcaster = loggingBroadcaster
