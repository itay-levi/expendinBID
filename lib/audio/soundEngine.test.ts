import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Just enough of the Web Audio API to observe what the engine schedules. */
class FakeParam {
  value = 0
  setValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
  setTargetAtTime = vi.fn((target: number) => {
    this.value = target
  })
}

class FakeNode {
  connect = vi.fn(<T>(next: T) => next)
}

class FakeOscillator extends FakeNode {
  type = 'sine'
  frequency = new FakeParam()
  start = vi.fn()
  stop = vi.fn()
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null
  currentTime = 0
  destination = {}
  oscillators: FakeOscillator[] = []
  resume = vi.fn(async () => undefined)
  constructor() {
    FakeAudioContext.last = this
  }
  createOscillator() {
    const oscillator = new FakeOscillator()
    this.oscillators.push(oscillator)
    return oscillator
  }
  createGain() {
    return new FakeGain()
  }
}

/** A fresh engine per test — it is a module-level singleton. */
async function loadEngine() {
  vi.resetModules()
  return (await import('./soundEngine')).soundEngine
}

beforeEach(() => {
  FakeAudioContext.last = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('soundEngine', () => {
  it('does nothing, and does not throw, where there is no browser', async () => {
    const engine = await loadEngine()
    await engine.init()
    expect(() => engine.playOneShot('select')).not.toThrow()
  })

  it('stays silent until it is unmuted — sound is off by default', async () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    const engine = await loadEngine()
    await engine.init()
    engine.playOneShot('select')
    expect(FakeAudioContext.last?.oscillators).toHaveLength(0)
  })

  it('plays one tone for a selection and two for a takeover', async () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    const engine = await loadEngine()
    await engine.init()
    engine.setMuted(false)

    engine.playOneShot('select')
    expect(FakeAudioContext.last?.oscillators).toHaveLength(1)

    engine.playOneShot('takeover')
    expect(FakeAudioContext.last?.oscillators).toHaveLength(3)
    // Every scheduled tone is also scheduled to stop, so nothing drones on.
    for (const oscillator of FakeAudioContext.last?.oscillators ?? []) expect(oscillator.stop).toHaveBeenCalled()
  })

  it('starts the alarm once however often it is asked, and muting stops it', async () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    const engine = await loadEngine()
    await engine.init()
    engine.setMuted(false)

    engine.startAlarmLoop()
    engine.startAlarmLoop()
    const [tone, sweep] = FakeAudioContext.last?.oscillators ?? []
    expect(FakeAudioContext.last?.oscillators).toHaveLength(2)

    engine.setMuted(true)
    expect(tone?.stop).toHaveBeenCalled()
    expect(sweep?.stop).toHaveBeenCalled()
  })

  it('creates its audio context only once', async () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext })
    const engine = await loadEngine()
    await engine.init()
    const first = FakeAudioContext.last
    await engine.init()
    expect(FakeAudioContext.last).toBe(first)
  })
})
