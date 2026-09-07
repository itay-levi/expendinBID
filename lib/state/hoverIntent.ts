import { useGameStore } from './gameStore'

/**
 * How long the Conquest Card stays open after the pointer leaves the hex it belongs to.
 *
 * Long enough to cross the gap between the hex and the card (which floats ~72px above it, with
 * canvas in between), short enough that the card doesn't linger once you've genuinely moved on.
 */
export const HOVER_GRACE_MS = 220

export type HoverIntent = {
  /** Pointer is over a hex: show its card immediately and cancel any pending close. */
  hover: (hexId: string) => void
  /** Pointer left a hex: close the card, but only after the grace period. */
  release: () => void
  /** Pointer reached the card itself: cancel the pending close and keep it open. */
  keep: () => void
}

/**
 * Hover-intent state machine for the Conquest Card.
 *
 * The card is a DOM overlay floating above the hex it describes, so reaching its Conquer button
 * means moving the pointer off the hex mesh and across a strip of bare canvas. Closing the card
 * the instant the pointer leaves the hex therefore makes the button unreachable — it disappears
 * mid-travel, every time.
 *
 * The previous attempt at solving this (pointerOutGuard) inspected `relatedTarget` to detect
 * "left the hex *into* the card". That cannot work for the path that actually matters: R3F
 * synthesizes a mesh's `pointerOut` from its own per-move raycasting, so the native event behind
 * it is a `pointermove` — and `relatedTarget` is always null on `pointermove`. The guard only ever
 * returned true for the canvas-level `pointerleave`, never for hex-to-canvas moves.
 *
 * A grace period sidesteps the event plumbing entirely: it depends on nothing but time, so it
 * behaves the same for mouse, pen, and synthetic events.
 */
export function createHoverIntent(
  apply: (hexId: string | null) => void,
  graceMs: number = HOVER_GRACE_MS,
): HoverIntent {
  let pendingClose: ReturnType<typeof setTimeout> | null = null

  function cancelPendingClose(): void {
    if (pendingClose === null) return
    clearTimeout(pendingClose)
    pendingClose = null
  }

  return {
    hover(hexId) {
      cancelPendingClose()
      apply(hexId)
    },
    release() {
      cancelPendingClose()
      pendingClose = setTimeout(() => {
        pendingClose = null
        apply(null)
      }, graceMs)
    },
    keep: cancelPendingClose,
  }
}

// Bound to the store rather than passed through props: the hex meshes request hover changes and
// the card cancels them, and those live in sibling components with no parent to thread state
// through. The store is already a singleton, so this is too.
const intent = createHoverIntent((hexId) => useGameStore.getState().setHoveredHex(hexId))

export const hoverHex = intent.hover
export const releaseHover = intent.release
export const keepHover = intent.keep

/** Adapter for the `onHoverChange(hexId | null)` prop shape the hex meshes already use. */
export function requestHoverChange(hexId: string | null): void {
  if (hexId === null) releaseHover()
  else hoverHex(hexId)
}
