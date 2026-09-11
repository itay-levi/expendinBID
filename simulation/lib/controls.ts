import readline from 'node:readline'
import type { SpeedName } from './args'

export type ControlHandlers = {
  setSpeed(name: SpeedName): void
  togglePause(): void
  status(): void
  quit(): void
}

/**
 * Single-key controls while the simulation runs: 1-4 change speed, p pauses, s prints a status
 * line, q (or Ctrl+C) finishes. Does nothing when the terminal is not interactive. Returns a
 * function that restores the terminal.
 */
export function attachControls(handlers: ControlHandlers): () => void {
  const input = process.stdin
  if (!input.isTTY) return () => undefined

  readline.emitKeypressEvents(input)
  input.setRawMode(true)
  input.resume()

  const onKey = (text: string | undefined, key: readline.Key | undefined): void => {
    if (key?.ctrl && key.name === 'c') {
      handlers.quit()
      return
    }
    switch ((text ?? '').toLowerCase()) {
      case '1':
        handlers.setSpeed('slow')
        break
      case '2':
        handlers.setSpeed('medium')
        break
      case '3':
        handlers.setSpeed('fast')
        break
      case '4':
        handlers.setSpeed('turbo')
        break
      case 'p':
        handlers.togglePause()
        break
      case 's':
        handlers.status()
        break
      case 'q':
        handlers.quit()
        break
      default:
        break
    }
  }

  input.on('keypress', onKey)
  let detached = false
  return () => {
    if (detached) return
    detached = true
    input.off('keypress', onKey)
    if (input.isTTY) input.setRawMode(false)
    input.pause()
  }
}
