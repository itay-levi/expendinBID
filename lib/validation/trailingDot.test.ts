import { describe, expect, it } from 'vitest'
import { parseTargetUrl } from './targetUrlSchema'

describe('parseTargetUrl: the fully-qualified trailing dot', () => {
  it('treats brand.com. as brand.com, so it cannot become a separate empire', () => {
    const result = parseTargetUrl('https://brand.com./pricing')
    expect(result).toMatchObject({ success: true, hostname: 'brand.com', url: 'https://brand.com/pricing' })
  })

  it('strips any number of trailing dots', () => {
    expect(parseTargetUrl('brand.com...')).toMatchObject({ success: true, hostname: 'brand.com' })
  })

  it('still blocks localhost when it is written with a trailing dot', () => {
    // `localhost.` was neither in the blocked set nor a `.localhost` suffix, so it passed.
    expect(parseTargetUrl('http://localhost./').success).toBe(false)
    expect(parseTargetUrl('http://app.localhost./').success).toBe(false)
  })

  it('leaves an ordinary address untouched', () => {
    expect(parseTargetUrl('https://www.see.io/')).toMatchObject({ success: true, hostname: 'www.see.io' })
  })
})
