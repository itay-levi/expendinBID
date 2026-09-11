/** Thrown when a request body exceeds its cap. Callers answer 413. */
export class BodyTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes`)
    this.name = 'BodyTooLargeError'
  }
}

/**
 * Reads a request body as text, refusing anything past `maxBytes`.
 *
 * `request.text()` and `request.json()` buffer whatever arrives, with no ceiling. On an endpoint an
 * anonymous caller can reach — both payment webhooks read the body BEFORE checking its signature,
 * because the signature covers those bytes — that lets anyone make the server hold an arbitrarily
 * large payload in memory. The declared length is checked first as a cheap early out; the stream is
 * counted regardless, because the header is optional and can lie.
 */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes)

  const reader = request.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      throw new BodyTooLargeError(maxBytes)
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}
