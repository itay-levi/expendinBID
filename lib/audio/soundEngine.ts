// Minimal Web Audio wrapper for the game's one-shot sound effects plus one alarm loop.
//
// The sounds are synthesized rather than loaded. The previous version fetched three mp3 files from
// /sfx/, which never existed — there is no public/ folder — so the "Horn of Battle" toggle looked
// like a working control and did nothing at all. Oscillators need no assets, no network, and no
// decode step, and the whole palette is a few short tones.

type OneShot = 'select' | 'takeover'
type Note = { frequency: number; offset: number; duration: number }

const MASTER_VOLUME = 0.35

const ONE_SHOTS: Record<OneShot, { wave: OscillatorType; notes: Note[] }> = {
  // A short, bright tick — confirms a tile went into the basket.
  select: { wave: 'triangle', notes: [{ frequency: 880, offset: 0, duration: 0.07 }] },
  // Two rising notes — someone just took ground.
  takeover: {
    wave: 'square',
    notes: [
      { frequency: 523.25, offset: 0, duration: 0.09 },
      { frequency: 783.99, offset: 0.08, duration: 0.18 },
    ],
  },
}

class SoundEngine {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private alarm: { tone: OscillatorNode; sweep: OscillatorNode } | null = null
  private muted = true

  /** Must be called from a user gesture — browsers keep audio suspended until one happens. */
  async init(): Promise<void> {
    if (this.context || typeof window === 'undefined') return
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return

    this.context = new AudioContextClass()
    this.master = this.context.createGain()
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME
    this.master.connect(this.context.destination)
    await this.context.resume().catch(() => undefined)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.context && this.master) {
      // A short ramp rather than a jump, so muting mid-sound does not click.
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.context.currentTime, 0.02)
      if (!muted) void this.context.resume().catch(() => undefined)
    }
    if (muted) this.stopAlarmLoop()
  }

  playOneShot(name: OneShot): void {
    const context = this.context
    const master = this.master
    if (!context || !master || this.muted) return

    const { wave, notes } = ONE_SHOTS[name]
    for (const note of notes) {
      const start = context.currentTime + note.offset
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      oscillator.type = wave
      oscillator.frequency.value = note.frequency
      // Exponential ramps can't touch zero, hence the tiny floor.
      envelope.gain.setValueAtTime(0.0001, start)
      envelope.gain.exponentialRampToValueAtTime(0.25, start + 0.01)
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.duration)
      oscillator.connect(envelope).connect(master)
      oscillator.start(start)
      oscillator.stop(start + note.duration + 0.02)
    }
  }

  /** A two-tone siren for "your territory is under attack". Idempotent. */
  startAlarmLoop(): void {
    const context = this.context
    const master = this.master
    if (!context || !master || this.muted || this.alarm) return

    const tone = context.createOscillator()
    const sweep = context.createOscillator()
    const sweepDepth = context.createGain()
    const level = context.createGain()

    tone.type = 'sawtooth'
    tone.frequency.value = 660
    sweep.frequency.value = 1.5 // wobbles per second
    sweepDepth.gain.value = 180 // Hz either side of the base tone
    level.gain.value = 0.08

    sweep.connect(sweepDepth).connect(tone.frequency)
    tone.connect(level).connect(master)
    tone.start()
    sweep.start()
    this.alarm = { tone, sweep }
  }

  stopAlarmLoop(): void {
    this.alarm?.tone.stop()
    this.alarm?.sweep.stop()
    this.alarm = null
  }
}

export const soundEngine = new SoundEngine()
