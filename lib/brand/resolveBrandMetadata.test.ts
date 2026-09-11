import { describe, expect, it } from 'vitest'
import { extractIconCandidates, extractMeta } from './resolveBrandMetadata'

const BASE = 'https://example.com/page'

describe('extractMeta — normal pages', () => {
  it('prefers og:title over <title>', () => {
    const html = `<head><title>Fallback</title><meta property="og:title" content="Real Title"></head>`
    expect(extractMeta(html, BASE).title).toBe('Real Title')
  })

  it('falls back to <title> when og:title is absent', () => {
    expect(extractMeta('<head><title>Just A Title</title></head>', BASE).title).toBe('Just A Title')
  })

  it('prefers og:description over meta description', () => {
    const html = `<meta name="description" content="meta desc"><meta property="og:description" content="og desc">`
    expect(extractMeta(html, BASE).description).toBe('og desc')
  })

  it('resolves a relative og:image against the page URL', () => {
    const html = `<meta property="og:image" content="/img/logo.png">`
    expect(extractMeta(html, BASE).logoUrl).toBe('https://example.com/img/logo.png')
  })

  it('falls back to apple-touch-icon when there is no og:image', () => {
    const html = `<link rel="apple-touch-icon" href="/touch.png">`
    expect(extractMeta(html, BASE).logoUrl).toBe('https://example.com/touch.png')
  })

  it('returns null logo when the page advertises none', () => {
    expect(extractMeta('<head><title>x</title></head>', BASE).logoUrl).toBeNull()
  })

  it('decodes HTML entities into plain text', () => {
    const html = `<title>Ben &amp; Jerry&#39;s &quot;Best&quot;</title>`
    expect(extractMeta(html, BASE).title).toBe(`Ben & Jerry's "Best"`)
  })
})

describe('extractMeta — hostile / abusive input', () => {
  it('truncates an absurdly long title so it cannot bloat storage or the UI', () => {
    const html = `<title>${'A'.repeat(5000)}</title>`
    expect(extractMeta(html, BASE).title.length).toBeLessThanOrEqual(120)
  })

  it('truncates an absurdly long description', () => {
    const html = `<meta name="description" content="${'B'.repeat(5000)}">`
    expect(extractMeta(html, BASE).description.length).toBeLessThanOrEqual(240)
  })

  it('extracts injected markup as inert text rather than executing intent', () => {
    // The extracted value may legitimately contain angle brackets as TEXT. What matters is that
    // it comes back as a plain string for React to escape on render — never as markup we build
    // HTML from. This test pins the contract that callers receive a string, not HTML.
    const html = `<meta property="og:title" content="x&quot;&gt;&lt;img src=x onerror=alert(1)&gt;">`
    const { title } = extractMeta(html, BASE)
    expect(typeof title).toBe('string')
    expect(title).toContain('img src=x')
  })

  it('does not crash on malformed or empty HTML', () => {
    for (const html of ['', '<html', '<<<>>>', '<head><title></title></head>']) {
      expect(() => extractMeta(html, BASE)).not.toThrow()
    }
  })

  it('ignores metadata buried past the scanned head window', () => {
    const html = `${'<!-- padding -->'.repeat(9000)}<title>Way Too Late</title>`
    expect(extractMeta(html, BASE).title).toBe('')
  })

  it('does not throw when og:image is an unparseable URL', () => {
    const html = `<meta property="og:image" content="ht!tp://%%%">`
    expect(() => extractMeta(html, BASE)).not.toThrow()
  })
})

describe('extractIconCandidates — logo priority', () => {
  // Real head from outrank.so, which is what exposed the bug: a huge social banner alongside
  // perfectly good square icons.
  const outrankHead = `
    <meta property="og:image" content="https://www.outrank.so/opengraph-image.png?31d914"/>
    <meta property="og:image:width" content="2400"/>
    <meta property="og:image:height" content="1200"/>
    <link rel="icon" href="/icon.png?b2cf51" type="image/png" sizes="192x192"/>
    <link rel="apple-touch-icon" href="/apple-icon.png?84bb36" type="image/png" sizes="180x180"/>
  `

  it('prefers a square app icon over a social share banner', () => {
    // og:image is a 2400x1200 marketing card — picking it rendered a screenshot of the homepage
    // on the map instead of a logo.
    const best = extractIconCandidates(outrankHead, 'https://www.outrank.so/')[0]
    expect(best?.href).toBe('https://www.outrank.so/apple-icon.png?84bb36')
  })

  it('ranks by kind before size', () => {
    // The 192px icon is larger than the 180px apple-touch-icon, but apple-touch-icon is by
    // definition a designed square mark, so kind wins.
    const ranked = extractIconCandidates(outrankHead, 'https://www.outrank.so/')
    expect(ranked[0]?.href).toContain('apple-icon')
    expect(ranked[1]?.href).toContain('icon.png')
    expect(ranked[ranked.length - 1]?.href).toContain('opengraph-image')
  })

  it('prefers the largest icon among equals', () => {
    const head = `
      <link rel="icon" href="/small.png" sizes="32x32"/>
      <link rel="icon" href="/big.png" sizes="512x512"/>
    `
    expect(extractIconCandidates(head, 'https://x.com/')[0]?.href).toBe('https://x.com/big.png')
  })

  it('treats a scalable SVG icon as the largest available', () => {
    const head = `
      <link rel="icon" href="/raster.png" sizes="512x512"/>
      <link rel="icon" href="/vector.svg" sizes="any" type="image/svg+xml"/>
    `
    expect(extractIconCandidates(head, 'https://x.com/')[0]?.href).toBe('https://x.com/vector.svg')
  })

  it('skips Safari mask-icons, which are monochrome silhouettes', () => {
    const head = '<link rel="mask-icon" href="/pinned.svg" color="#000"/>'
    expect(extractIconCandidates(head, 'https://x.com/')).toHaveLength(0)
  })

  it('reads href and sizes regardless of attribute order', () => {
    const head = '<link sizes="180x180" href="/a.png" rel="apple-touch-icon"/>'
    expect(extractIconCandidates(head, 'https://x.com/')[0]?.href).toBe('https://x.com/a.png')
  })

  it('resolves relative and root-relative hrefs against the page', () => {
    const head = '<link rel="apple-touch-icon" href="assets/icon.png"/>'
    expect(extractIconCandidates(head, 'https://x.com/blog/post')[0]?.href).toBe(
      'https://x.com/blog/assets/icon.png',
    )
  })

  it('falls back to og:image when a site publishes no icon at all', () => {
    const head = '<meta property="og:image" content="https://x.com/card.png"/>'
    expect(extractIconCandidates(head, 'https://x.com/')[0]?.href).toBe('https://x.com/card.png')
  })

  it('returns nothing for a head with no images, and never throws on junk hrefs', () => {
    expect(extractIconCandidates('<title>Nothing here</title>', 'https://x.com/')).toEqual([])
    expect(() => extractIconCandidates('<link rel="icon" href="ht tp://:::"/>', 'https://x.com/')).not.toThrow()
  })
})

describe('extractIconCandidates: only fetchable web URLs become logos', () => {
  const PAGE = 'https://brand.example/'

  it('skips a data: icon and falls through to the next real one', () => {
    const head = `
      <link rel="apple-touch-icon" href="data:image/svg+xml;base64,${'A'.repeat(4000)}">
      <link rel="icon" href="/favicon.png" sizes="32x32">`
    expect(extractIconCandidates(head, PAGE).map((c) => c.href)).toEqual(['https://brand.example/favicon.png'])
  })

  it('never offers a javascript: or file: href', () => {
    const head = `<link rel="icon" href="javascript:alert(1)"><link rel="icon" href="file:///etc/passwd">`
    expect(extractIconCandidates(head, PAGE)).toEqual([])
  })

  it('drops an absurdly long URL', () => {
    const head = `<link rel="icon" href="/${'x'.repeat(3000)}.png">`
    expect(extractIconCandidates(head, PAGE)).toEqual([])
  })
})
