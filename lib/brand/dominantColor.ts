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
export function ensureReadableOnMap(hex: string): string {
  const rgb = fromHex(hex)
  if (!rgb) return DEFAULT_BRAND_COLOR

  const { l } = saturationLightness(rgb.r, rgb.g, rgb.b)
  if (l >= 0.3 && l <= 0.72) return hex.toUpperCase()

  const factor = l < 0.3 ? 0.3 / Math.max(l, 0.02) : 0.72 / l
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
