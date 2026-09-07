'use client'

import { MousePointerClick, Wallet, Expand, Skull } from 'lucide-react'
import { GlassPanel } from './GlassPanel'

const STEPS = [
  { icon: MousePointerClick, label: 'Select Hex' },
  { icon: Wallet, label: 'Pay Valuation' },
  { icon: Expand, label: 'Expand Territory' },
  { icon: Skull, label: 'Swallow Rivals' },
]

export function HowItWorksPanel() {
  return (
    <GlassPanel title="How the Takeover Works" glow="none">
      <div className="flex h-full items-center justify-between">
        {STEPS.map((step, index) => {
          const Icon = step.icon
          return (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5 text-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-hexwars-cyan/40 bg-hexwars-cyan/10 text-hexwars-cyan">
                  <Icon size={16} />
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wide text-white/60">
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div className="mx-2 h-px w-4 bg-gradient-to-r from-hexwars-cyan/40 to-transparent md:w-6" />
              )}
            </div>
          )
        })}
      </div>
    </GlassPanel>
  )
}
