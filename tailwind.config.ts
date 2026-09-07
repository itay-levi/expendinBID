import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hexwars: {
          bg: '#0B0E14',
          grid: '#1E2638',
          gridBorder: '#2A364F',
          cyan: '#00F0FF',
          green: '#00FF87',
          coral: '#FF3366',
          purple: '#8A2BE2',
        },
        glass: {
          DEFAULT: 'rgba(15, 18, 26, 0.55)',
          border: 'rgba(255, 255, 255, 0.08)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 0 1px rgba(0,240,255,.35), 0 0 24px rgba(0,240,255,.25)',
        'glow-green': '0 0 0 1px rgba(0,255,135,.35), 0 0 24px rgba(0,255,135,.25)',
        'glow-coral': '0 0 0 1px rgba(255,51,102,.4), 0 0 24px rgba(255,51,102,.3)',
        'glass-inset': 'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      backdropBlur: {
        hud: '16px',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.08)', opacity: '0.85' },
        },
        tickerScroll: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'pulse-glow': 'pulseGlow 1.2s ease-in-out infinite',
        'ticker-scroll': 'tickerScroll 30s linear infinite',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
