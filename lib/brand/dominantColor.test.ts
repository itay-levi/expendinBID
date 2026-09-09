import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BRAND_COLOR,
  dominantColorFromPixels,
  ensureReadableOnMap,
  fromHex,
  isValidHexColor,
  saturationLightness,
  toHex,
} from './dominantColor'

/** Builds an RGBA buffer from [r,g,b,a] tuples repeated `count` times each. */
function pixels(...groups: Array<{ rgba: [number, number, number, number]; count: number }>): number[] {
  const out: number[] = []
  for (const { rgba, count } of groups) {
    for (let i = 0; i < count; i += 1) out.push(...rgba)
  }
  return out
}

describe('dominantColorFromPixels', () => {
  it('finds the brand colour in a logo that is mostly white', () => {
    // The case that makes a naive "most common pixel" useless: almost every real logo is mostly
    // white or transparent, and counting raw pixels would paint every territory the same grey.
    const data = pixels(
      { rgba: [255, 255, 255, 255], count: 900 },
      { rgba: [0, 120, 220, 255], count: 100 },
    )
    expect(dominantColorFromPixels(data, 1)).toBe('#0078DC')
  })

  it('ignores transparent padding', () => {
    const data = pixels(
      { rgba: [10, 200, 90, 0], count: 900 }, // fully transparent — not part of the mark
      { rgba: [220, 40, 40, 255], count: 60 },
    )
    expect(dominantColorFromPixels(data, 1)).toBe('#DC2828')
  })

  it('ignores black outlines and near-black backdrops', () => {
    const data = pixels(
      { rgba: [8, 8, 12, 255], count: 800 },
      { rgba: [240, 180, 20, 255], count: 90 },
    )
    expect(dominantColorFromPixels(data, 1)).toBe('#F0B414')
  })

  it('groups shades of one colour rather than splitting the vote', () => {
    // Anti-aliasing produces dozens of near-identical shades. Without bucketing, a logo with one
    // colour in many shades can lose to a smaller block of a flat second colour.
    const data = pixels(
      { rgba: [0, 118, 220, 255], count: 40 },
      { rgba: [0, 122, 224, 255], count: 40 },
      { rgba: [4, 126, 228, 255], count: 40 },
      { rgba: [220, 40, 40, 255], count: 90 },
    )
    const result = fromHex(dominantColorFromPixels(data, 1))!
    expect(result.b).toBeGreaterThan(result.r) // blue family won, not the flat red
  })

  it('falls back for an entirely greyscale logo', () => {
    const data = pixels(
      { rgba: [20, 20, 20, 255], count: 300 },
      { rgba: [128, 128, 128, 255], count: 300 },
      { rgba: [250, 250, 250, 255], count: 300 },
    )
    expect(dominantColorFromPixels(data, 1)).toBe(DEFAULT_BRAND_COLOR)
  })

  it('falls back for empty or malformed input instead of throwing', () => {
    expect(dominantColorFromPixels([], 1)).toBe(DEFAULT_BRAND_COLOR)
    expect(dominantColorFromPixels([255, 0], 1)).toBe(DEFAULT_BRAND_COLOR)
  })

  it('gives the same answer whatever the sampling stride', () => {
    const data = pixels(
      { rgba: [255, 255, 255, 255], count: 400 },
      { rgba: [30, 160, 90, 255], count: 400 },
    )
    expect(dominantColorFromPixels(data, 4)).toBe(dominantColorFromPixels(data, 1))
  })
})

describe('ensureReadableOnMap', () => {
  it('leaves a mid-tone colour alone', () => {
    expect(ensureReadableOnMap('#3B82F6')).toBe('#3B82F6')
  })

  it('lifts a near-black brand off the empty grid', () => {
    // A near-black fill makes owned territory indistinguishable from unclaimed ground.
    const lifted = fromHex(ensureReadableOnMap('#050508'))!
    const { l } = saturationLightness(lifted.r, lifted.g, lifted.b)
    expect(l).toBeGreaterThan(0.1)
  })

  it('pulls a near-white brand down so the logo on top stays visible', () => {
    const dimmed = fromHex(ensureReadableOnMap('#FEFEFE'))!
    const { l } = saturationLightness(dimmed.r, dimmed.g, dimmed.b)
    expect(l).toBeLessThan(0.95)
  })

  it('preserves the hue so it still reads as their colour', () => {
    const original = fromHex('#0A0A40')! // very dark blue
    const adjusted = fromHex(ensureReadableOnMap('#0A0A40'))!
    expect(adjusted.b).toBeGreaterThan(adjusted.r)
    expect(adjusted.b).toBeGreaterThan(original.b)
  })

  it('falls back for an unparseable value', () => {
    expect(ensureReadableOnMap('not a colour')).toBe(DEFAULT_BRAND_COLOR)
  })
})

describe('fromHex / toHex / isValidHexColor', () => {
  it('round-trips a six-digit hex', () => {
    expect(toHex(fromHex('#1E90FF')!)).toBe('#1E90FF')
  })

  it('expands three-digit shorthand', () => {
    expect(fromHex('#0AF')).toEqual({ r: 0, g: 170, b: 255 })
  })

  it('clamps out-of-range channels', () => {
    expect(toHex({ r: -20, g: 300, b: 128 })).toBe('#00FF80')
  })

  it('validates what may arrive from a client', () => {
    // This value crosses the wire on a claim, so anything malformed must be rejected outright
    // rather than reaching a CSS or canvas context.
    expect(isValidHexColor('#ABC')).toBe(true)
    expect(isValidHexColor('#AABBCC')).toBe(true)
    expect(isValidHexColor('AABBCC')).toBe(false)
    expect(isValidHexColor('#GGGGGG')).toBe(false)
    expect(isValidHexColor('red')).toBe(false)
    expect(isValidHexColor('#ABC; background:url(x)')).toBe(false)
    expect(isValidHexColor(123)).toBe(false)
    expect(isValidHexColor(null)).toBe(false)
  })
})
