import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHoverIntent } from './hoverIntent'

describe('createHoverIntent', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a hovered hex immediately, with no delay', () => {
    const apply = vi.fn()
    createHoverIntent(apply, 200).hover('hex_1')
    expect(apply).toHaveBeenCalledWith('hex_1')
  })

  it('does not close until the grace period has elapsed', () => {
    const apply = vi.fn()
    const intent = createHoverIntent(apply, 200)

    intent.hover('hex_1')
    apply.mockClear()
    intent.release()

    vi.advanceTimersByTime(199)
    expect(apply).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(apply).toHaveBeenCalledWith(null)
  })

  it('keeps the card open when the pointer reaches it mid-grace — the whole point of this module', () => {
    const apply = vi.fn()
    const intent = createHoverIntent(apply, 200)

    intent.hover('hex_1')
    apply.mockClear()
    intent.release()
    vi.advanceTimersByTime(100)
    intent.keep()

    vi.advanceTimersByTime(10_000)
    expect(apply).not.toHaveBeenCalled()
  })

  it('cancels a pending close when the pointer lands on another hex', () => {
    const apply = vi.fn()
    const intent = createHoverIntent(apply, 200)

    intent.hover('hex_1')
    intent.release()
    vi.advanceTimersByTime(100)
    intent.hover('hex_2')
    apply.mockClear()

    vi.advanceTimersByTime(10_000)
    // Never closes: the second hover superseded the pending close rather than queueing behind it.
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not stack timers when release is called repeatedly', () => {
    const apply = vi.fn()
    const intent = createHoverIntent(apply, 200)

    intent.hover('hex_1')
    apply.mockClear()
    intent.release()
    intent.release()
    intent.release()

    vi.advanceTimersByTime(500)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(null)
  })
})
