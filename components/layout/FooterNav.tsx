import Link from 'next/link'

/**
 * Mandatory compliance links. The game canvas (app/page.tsx) is a fixed, non-scrolling 3D scene
 * with no natural "footer" region — the bottom edge is fully occupied by the 4-panel dashboard —
 * so this renders as a compact pair of links inside the top HUD bar instead of a page footer.
 */
export function FooterNav() {
  return (
    <nav aria-label="Legal" className="flex items-center gap-2 text-[10px] text-white/35">
      <Link href="/terms" target="_blank" className="hover:text-hexwars-cyan hover:underline">
        Terms
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/privacy" target="_blank" className="hover:text-hexwars-cyan hover:underline">
        Privacy
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/refund-policy" target="_blank" className="hover:text-hexwars-cyan hover:underline">
        Refunds
      </Link>
    </nav>
  )
}
