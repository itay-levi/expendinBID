/**
 * Shared map dimensions. These MUST be the single source of truth: the renderer, the demo seed,
 * and the server-side repository all have to agree on which coordinates exist, or hovering a hex
 * the store doesn't know about silently renders nothing.
 */
export const MAP_RADIUS = 12
export const HEX_SIZE = 1
