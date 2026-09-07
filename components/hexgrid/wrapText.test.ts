import { describe, expect, it } from 'vitest'
import { fitParagraph, wrapLines, wrapText } from './useLogoMosaicTexture'

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

describe('wrapLines', () => {
  it('reports the true line count with no limit and no ellipsis', () => {
    // fitParagraph depends on this: a wrapper that silently truncates cannot answer
    // "does this fit?", which is the whole question being asked.
    const lines = wrapLines(ctx, SEE_IO_TAGLINE, 200)
    expect(lines.length).toBeGreaterThan(4)
    expect(lines.join(' ')).not.toContain('…')
    expect(lines.join(' ').replace(/\s+/g, ' ')).toBe(SEE_IO_TAGLINE.replace(/\s+/g, ' '))
  })

  it('handles empty input and a zero-width box', () => {
    expect(wrapLines(ctx, '', 200)).toEqual([])
    expect(wrapLines(ctx, 'hello', 0)).toEqual([])
  })
})

describe('fitParagraph', () => {
  /** Mock with a settable font, sized so measured width scales with the declared px. */
  function sizingCtx(): Pick<CanvasRenderingContext2D, 'measureText'> & { font: string } {
    return {
      font: '',
      measureText(text: string) {
        const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10)
        return { width: text.length * px * 0.5 } as TextMetrics
      },
    }
  }

  const OUTRANK = 'Get traffic and outrank competitors with Backlinks & SEO-optimized content while you sleep.'

  it('SHRINKS to fit the whole sentence rather than cutting it', () => {
    // The reported bug: the description rendered large and stopped at "competitors with…".
    // Somebody paying for this space wants their sentence read.
    const { lines } = fitParagraph(sizingCtx(), OUTRANK, 260, 150)
    expect(lines.join(' ')).not.toContain('…')
    expect(lines.join(' ').replace(/\s+/g, ' ')).toBe(OUTRANK)
  })

  it('never overflows the box it was given', () => {
    for (const height of [40, 70, 110, 200]) {
      const { size, lines } = fitParagraph(sizingCtx(), OUTRANK, 260, height)
      expect(lines.length * size * 1.22).toBeLessThanOrEqual(height + 0.001)
    }
  })

  it('never exceeds the line budget', () => {
    const { lines } = fitParagraph(sizingCtx(), OUTRANK, 260, 400, 3)
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('uses a bigger font when there is more room', () => {
    const tight = fitParagraph(sizingCtx(), OUTRANK, 260, 60)
    const roomy = fitParagraph(sizingCtx(), OUTRANK, 260, 220)
    expect(roomy.size).toBeGreaterThan(tight.size)
  })

  it('falls back to an ellipsis only when even the floor size overflows', () => {
    // A box too small for the text at any legible size: cut a few words, not half the sentence.
    const { lines } = fitParagraph(sizingCtx(), OUTRANK, 120, 18)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[lines.length - 1]).toMatch(/…$/)
  })

  it('returns nothing for empty text or a degenerate box', () => {
    expect(fitParagraph(sizingCtx(), '', 200, 100).lines).toEqual([])
    expect(fitParagraph(sizingCtx(), OUTRANK, 0, 100).lines).toEqual([])
    expect(fitParagraph(sizingCtx(), OUTRANK, 200, 0).lines).toEqual([])
  })
})
