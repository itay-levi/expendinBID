import { describe, expect, it } from 'vitest'
import { BodyTooLargeError, readBodyWithLimit } from './readBodyWithLimit'

function streamedRequest(chunks: string[]): Request {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  // No content-length: the header is optional, so the cap has to hold on the stream itself.
  return new Request('https://hexwars.test/webhook', { method: 'POST', body, duplex: 'half' } as RequestInit)
}

describe('readBodyWithLimit', () => {
  it('reads a body under the limit', async () => {
    const request = new Request('https://hexwars.test/', { method: 'POST', body: '{"ok":true}' })
    expect(await readBodyWithLimit(request, 1_000)).toBe('{"ok":true}')
  })

  it('refuses a declared length over the limit without reading it', async () => {
    const request = new Request('https://hexwars.test/', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': '5000000' },
    })
    await expect(readBodyWithLimit(request, 1_000)).rejects.toBeInstanceOf(BodyTooLargeError)
  })

  it('refuses a streamed body that grows past the limit', async () => {
    await expect(readBodyWithLimit(streamedRequest(['a'.repeat(600), 'b'.repeat(600)]), 1_000)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    )
  })

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('é')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1))
        controller.enqueue(bytes.slice(1))
        controller.close()
      },
    })
    const request = new Request('https://hexwars.test/', { method: 'POST', body, duplex: 'half' } as RequestInit)
    expect(await readBodyWithLimit(request, 100)).toBe('é')
  })

  it('returns an empty string for a request with no body', async () => {
    expect(await readBodyWithLimit(new Request('https://hexwars.test/'), 100)).toBe('')
  })
})
