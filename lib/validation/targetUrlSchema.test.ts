import { describe, expect, it } from 'vitest'
import { parseTargetUrl } from './targetUrlSchema'

describe('parseTargetUrl — accepts legitimate input', () => {
  it('accepts a full https URL', () => {
    const result = parseTargetUrl('https://mycompany.com')
    expect(result.success).toBe(true)
    if (result.success) expect(result.hostname).toBe('mycompany.com')
  })

  it('accepts http and preserves the scheme', () => {
    const result = parseTargetUrl('http://mycompany.com')
    expect(result.success).toBe(true)
    if (result.success) expect(result.url.startsWith('http://')).toBe(true)
  })

  it('upgrades a bare domain to https', () => {
    const result = parseTargetUrl('mycompany.com')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.url).toBe('https://mycompany.com/')
      expect(result.hostname).toBe('mycompany.com')
    }
  })

  it('accepts subdomains, paths, ports and query strings', () => {
    const result = parseTargetUrl('https://shop.example.co.uk:8443/a/b?x=1#f')
    expect(result.success).toBe(true)
    if (result.success) expect(result.hostname).toBe('shop.example.co.uk')
  })

  it('trims surrounding whitespace', () => {
    expect(parseTargetUrl('   https://example.com   ').success).toBe(true)
  })
})

describe('parseTargetUrl — rejects hostile or malformed input', () => {
  const rejected: Array<[string, string]> = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['file scheme', 'file:///etc/passwd'],
    ['ftp scheme', 'ftp://example.com'],
    ['localhost', 'http://localhost'],
    ['loopback literal', 'http://127.0.0.1'],
    ['zero address', 'http://0.0.0.0'],
    ['not a url at all', 'not a url'],
  ]

  for (const [label, input] of rejected) {
    it(`rejects ${label}`, () => {
      expect(parseTargetUrl(input).success).toBe(false)
    })
  }

  it('rejects an over-length URL rather than passing it downstream', () => {
    const long = `https://example.com/${'a'.repeat(3000)}`
    expect(parseTargetUrl(long).success).toBe(false)
  })

  it('always returns a human-readable error message on failure', () => {
    const result = parseTargetUrl('javascript:alert(1)')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.length).toBeGreaterThan(0)
  })

  it('never returns a hostname containing HTML-significant characters', () => {
    // Anything that parses must have a host the URL spec already normalised, which is what makes
    // it safe to render. Confirm the parser is genuinely doing that rather than passing text through.
    for (const attempt of ['https://exa<script>mple.com', 'https://ex"ample.com', 'https://ex ample.com']) {
      const result = parseTargetUrl(attempt)
      if (result.success) {
        expect(result.hostname).not.toMatch(/[<>"' ]/)
      }
    }
  })
})
