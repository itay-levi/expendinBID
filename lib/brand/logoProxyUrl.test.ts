import { describe, expect, it } from 'vitest'
import { logoProxyUrl } from './logoProxyUrl'

describe('logoProxyUrl', () => {
  it('routes remote images through the same-origin proxy', () => {
    expect(logoProxyUrl('https://cdn.example.com/logo.png')).toBe(
      '/api/brand/logo?url=https%3A%2F%2Fcdn.example.com%2Flogo.png',
    )
  })

  it('encodes query strings so they cannot break out of the url parameter', () => {
    // A logo URL carrying its own query string must arrive at the proxy as one opaque value; if
    // the `&` survived unescaped it would split into a second parameter of our own endpoint.
    const proxied = logoProxyUrl('https://cdn.example.com/logo.png?w=128&fm=webp')
    expect(proxied).toBe('/api/brand/logo?url=https%3A%2F%2Fcdn.example.com%2Flogo.png%3Fw%3D128%26fm%3Dwebp')
    expect(proxied).not.toContain('&fm=')
  })

  it('encodes a url that tries to inject its own parameters', () => {
    const proxied = logoProxyUrl('https://evil.example.com/x.png&url=https://internal/')
    expect(proxied?.match(/url=/g)).toHaveLength(1)
  })

  it('passes data URIs through untouched — already same-origin, nothing to proxy', () => {
    const dataUri = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    expect(logoProxyUrl(dataUri)).toBe(dataUri)
  })

  it('passes same-origin paths through untouched', () => {
    expect(logoProxyUrl('/logo.png')).toBe('/logo.png')
  })

  it('returns null for absent input', () => {
    expect(logoProxyUrl(null)).toBeNull()
    expect(logoProxyUrl(undefined)).toBeNull()
    expect(logoProxyUrl('')).toBeNull()
  })

  it('refuses non-http schemes rather than proxying them', () => {
    // `javascript:` and `file:` must never reach an <img src> or the fetch behind the proxy.
    expect(logoProxyUrl('javascript:alert(1)')).toBeNull()
    expect(logoProxyUrl('file:///etc/passwd')).toBeNull()
    expect(logoProxyUrl('ftp://example.com/logo.png')).toBeNull()
    expect(logoProxyUrl('vbscript:msgbox(1)')).toBeNull()
    expect(logoProxyUrl('logo.png')).toBeNull()
  })

  it('accepts http and https case-insensitively', () => {
    expect(logoProxyUrl('HTTPS://example.com/a.png')).toContain('/api/brand/logo?url=')
    expect(logoProxyUrl('http://example.com/a.png')).toContain('/api/brand/logo?url=')
  })
})
