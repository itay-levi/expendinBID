import { describe, expect, it } from 'vitest'
import { wrapText } from './useLogoMosaicTexture'

/**
 * Stand-in for a canvas 2D context: every character is 10 units wide, so line widths are exactly
 * predictable and the assertions below are about the wrapping logic rather than font metrics.
 */
const ctx = { measureText: (text: string) => ({ width: text.length * 10 }) } as Pick<
  CanvasRenderingContext2D,
  'measureText'
>

const SEE_IO_TAGLINE =
  'Describe what you want, and an AI agent designs it, builds it, and puts it online in minutes. No coding required!'

describe('wrapText', () => {
  it('breaks a real tagline into lines that each fit', () => {
    const lines = wrapText(ctx, SEE_IO_TAGLINE, 300, 4)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(300)
    }
  })

  it('never exceeds the line budget', () => {
    // The budget is computed from the space actually left under the logo, so overflowing it draws
    // text off the bottom of the territory and onto whatever is behind it.
    for (const maxLines of [1, 2, 3, 4]) {
      expect(wrapText(ctx, SEE_IO_TAGLINE, 200, maxLines).length).toBeLessThanOrEqual(maxLines)
    }
  })

  it('marks truncation with an ellipsis instead of silently dropping the rest', () => {
    const lines = wrapText(ctx, SEE_IO_TAGLINE, 200, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/…$/)
  })

  it('adds no ellipsis when everything fits', () => {
    const lines = wrapText(ctx, 'Short and sweet', 1000, 4)
    expect(lines).toEqual(['Short and sweet'])
  })

  it('keeps a word longer than the line rather than looping forever', () => {
    // A single unbreakable token wider than maxWidth would otherwise never fit, and a naive
    // implementation spins or emits an infinite run of empty lines.
    const lines = wrapText(ctx, 'supercalifragilisticexpialidocious', 50, 3)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('super')
  })

  it('handles empty and whitespace-only input', () => {
    expect(wrapText(ctx, '', 300, 4)).toEqual([])
    expect(wrapText(ctx, '   \n  ', 300, 4)).toEqual([])
  })

  it('returns nothing for a zero or negative budget', () => {
    // Happens whenever the logo fills the territory and no room is left underneath it.
    expect(wrapText(ctx, SEE_IO_TAGLINE, 300, 0)).toEqual([])
    expect(wrapText(ctx, SEE_IO_TAGLINE, 300, -1)).toEqual([])
    expect(wrapText(ctx, SEE_IO_TAGLINE, 0, 4)).toEqual([])
  })

  it('collapses runs of whitespace, which scraped meta tags are full of', () => {
    expect(wrapText(ctx, '  Build\n\n  things   fast  ', 1000, 4)).toEqual(['Build things fast'])
  })
})
