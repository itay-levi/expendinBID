'use client'

type LiveTickerProps = {
  messages: string[]
}

/** Seamless infinite scroll: the message list is duplicated once, and the CSS animation translates exactly -50%. */
export function LiveTicker({ messages }: LiveTickerProps) {
  if (messages.length === 0) return null
  const looped = [...messages, ...messages]

  return (
    <div className="relative hidden flex-1 overflow-hidden md:block">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-glass to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-glass to-transparent" />
      <div className="flex w-max animate-ticker-scroll gap-8 whitespace-nowrap">
        {looped.map((message, index) => (
          <span key={index} className="font-mono text-xs text-white/60">
            {message}
          </span>
        ))}
      </div>
    </div>
  )
}
