/** Fallback when a logo yields nothing usable — the palette's neutral accent. */
export const DEFAULT_BRAND_COLOR = '#8A2BE2'

/** Pixels below this alpha are transparent padding, not part of the mark. */
const MIN_ALPHA = 200
/** Below this saturation a pixel is grey/black/white — background, not brand. */
const MIN_SATURATION = 0.22
/** Very dark or very light pixels are usually the logo's backdrop or its outline. */
const MIN_LIGHTNESS = 0.18
const MAX_LIGHTNESS = 0.88
/** Buckets per channel. 6 gives 216 bins — enough to group shades, coarse enough to find a peak. */
const BUCKETS = 6

export type Rgb = { r: number; g: number; b: number }

/**
 * The most representative colour in a logo.
 *
 * Every empire currently renders in the same hardcoded purple, so territories cannot be told apart
 * and "your colour" means nothing. This picks a real one out of the mark we already fetch.
 *
 * It is deliberately NOT a plain "most common pixel" count. The most common pixel in a typical logo
 * is white, black, or transparent padding — all of which would give every brand the same grey map.
 * Pixels are filtered to those with actual chroma first, then bucketed and counted, so the answer
 * is the dominant *brand* colour rather than the dominant *pixel*.
 *
 * Takes raw RGBA (the shape `CanvasRenderingContext2D.getImageData` returns) so it stays a pure
 * function over numbers and can be tested without a browser.
 */
export function dominantColorFromPixels(pixels: ArrayLike<number>, sampleStride = 4): string {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>()
  const step = 4 * Math.max(1, Math.floor(sampleStride))

  for (let i = 0; i + 3 < pixels.length; i += step) {
    const r = pixels[i] as number
    const g = pixels[i + 1] as number
    const b = pixels[i + 2] as number
    const a = pixels[i + 3] as number

    if (a < MIN_ALPHA) continue

    const { s, l } = saturationLightness(r, g, b)
    if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue

    const key =
      (Math.floor((r / 256) * BUCKETS) * BUCKETS + Math.floor((g / 256) * BUCKETS)) * BUCKETS +
      Math.floor((b / 256) * BUCKETS)

    const bin = bins.get(key)
    if (bin) {
      bin.count += 1
      bin.r += r
      bin.g += g
      bin.b += b
    } else {
      bins.set(key, { count: 1, r, g, b })
    }
  }

  let best: { count: number; r: number; g: number; b: number } | null = null
  for (const bin of bins.values()) {
    if (!best || bin.count > best.count) best = bin
  }

  // A logo that is entirely greyscale (plenty are) legitimately has no brand colour to find.
  if (!best) return DEFAULT_BRAND_COLOR

  return toHex({
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
  })
}

/** HSL saturation and lightness, the two channels used to reject non-brand pixels. */
export function saturationLightness(r: number, g: number, b: number): { s: number; l: number } {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  if (max === min) return { s: 0, l }
  const d = max - min
  return { s: l > 0.5 ? d / (2 - max - min) : d / (max + min), l }
}

export function toHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/**
 * Nudges a colour into a range that stays legible as a tile fill.
 *
 * A near-black brand colour makes territory indistinguishable from the empty grid, and a near-white
 * one blows out the logo drawn on top of it. Hue is preserved — it is still recognisably theirs.
 */
const READABLE_MIN_LIGHTNESS = 0.3
const READABLE_MAX_LIGHTNESS = 0.72

export function ensureReadableOnMap(hex: string): string {
  const rgb = fromHex(hex)
  if (!rgb) return DEFAULT_BRAND_COLOR

  const { l } = saturationLightness(rgb.r, rgb.g, rgb.b)
  if (l >= READABLE_MIN_LIGHTNESS && l <= READABLE_MAX_LIGHTNESS) return hex.toUpperCase()

  // Zero lightness means every channel is zero. There are no ratios to scale, so multiplying
  // leaves black exactly as unreadable as it arrived — a black-logo brand got black territory,
  // invisible against the grid, which is the one thing this function exists to prevent. Nothing
  // about the hue survives to preserve, so lift it to the floor as neutral grey.
  if (l === 0) {
    const floor = READABLE_MIN_LIGHTNESS * 255
    return toHex({ r: floor, g: floor, b: floor })
  }

  // Lightness scales linearly with the channels, so this lands exactly on the boundary. The old
  // `Math.max(l, 0.02)` divisor guarded against dividing by zero but capped the lift at 15x, which
  // left very dark colours (#010101 and friends) short of the floor and still unreadable. The
  // l === 0 branch above is the guard now, so the factor can be exact.
  const factor = l < READABLE_MIN_LIGHTNESS ? READABLE_MIN_LIGHTNESS / l : READABLE_MAX_LIGHTNESS / l
  return toHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor })
}

/** Parses `#RGB` or `#RRGGBB`. Null for anything else — this runs on scraped, untrusted values. */
export function fromHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const body = match[1] as string
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** True for a well-formed hex colour. Used to validate anything arriving from a client. */
export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
}

/**
 * The single gate between an untrusted colour and the database.
 *
 * The colour is sampled in the buyer's browser, so it reaches the server as client input like any
 * other. Three things must hold before it can be stored, and no caller should have to remember
 * them separately:
 *
 *  - **Well-formed**, falling back to the default rather than failing a purchase over a colour.
 *  - **Exactly six digits.** `#abc` satisfies isValidHexColor but violates the DB's
 *    empires_color_is_hex CHECK, and ensureReadableOnMap's pass-through branch preserves
 *    shorthand — so validating with those two alone turns a good payment into a 500.
 *  - **Legible as a tile fill**, so no value, hostile or merely unlucky, yields territory that
 *    vanishes against the grid or blows out the logo drawn on it.
 */
export function normalizeBrandColor(value: unknown): string {
  if (!isValidHexColor(value)) return DEFAULT_BRAND_COLOR
  const rgb = fromHex(value)
  if (!rgb) return DEFAULT_BRAND_COLOR
  // Round-trip through toHex FIRST so shorthand is expanded before the readability clamp gets a
  // chance to hand it back unchanged.
  return ensureReadableOnMap(toHex(rgb))
}
