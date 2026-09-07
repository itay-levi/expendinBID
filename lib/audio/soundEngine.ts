// Minimal Web Audio API wrapper for the game's fixed set of one-shot SFX plus one loop.
// No library: three buffers and a master gain node don't justify a dependency.

type SfxName = 'select' | 'takeover' | 'alarm'

const SFX_SOURCES: Record<SfxName, string> = {
  select: '/sfx/select-lock.mp3',
  takeover: '/sfx/takeover-chaching.mp3',
  alarm: '/sfx/under-attack-alarm.mp3',
}

class SoundEngine {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private buffers = new Map<SfxName, AudioBuffer>()
  private alarmSource: AudioBufferSourceNode | null = null
  private muted = false

  /** Must be called from a user gesture (click) — browsers block AudioContext until then. */
  async init(): Promise<void> {
    if (this.context) return
    this.context = new AudioContext()
    this.masterGain = this.context.createGain()
    this.masterGain.connect(this.context.destination)

    await Promise.all(
      (Object.entries(SFX_SOURCES) as [SfxName, string][]).map(async ([name, url]) => {
        const response = await fetch(url)
        const arrayBuffer = await response.arrayBuffer()
        const audioBuffer = await this.context!.decodeAudioData(arrayBuffer)
        this.buffers.set(name, audioBuffer)
      }),
    )
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : 1
    }
  }

  playOneShot(name: 'select' | 'takeover'): void {
    if (!this.context || !this.masterGain || this.muted) return
    const buffer = this.buffers.get(name)
    if (!buffer) return

    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.masterGain)
    source.start()
  }

  startAlarmLoop(): void {
    if (!this.context || !this.masterGain || this.alarmSource) return
    const buffer = this.buffers.get('alarm')
    if (!buffer) return

    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(this.masterGain)
    source.start()
    this.alarmSource = source
  }

  stopAlarmLoop(): void {
    this.alarmSource?.stop()
    this.alarmSource = null
  }
}

export const soundEngine = new SoundEngine()
