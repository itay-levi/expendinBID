import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { logoProxyUrl } from '@/lib/brand/logoProxyUrl'

/** Longest edge of the generated canvas. Big enough to stay sharp when a large empire zooms in. */
const MAX_TEXTURE_EDGE = 1024
/** Fraction of the territory the mark occupies, leaving a margin so it doesn't run to the border. */
const CONTAIN_RATIO = 0.76

export type LogoMosaicInput = {
  name: string
  domain: string
  colorHex: string
  logoUrl: string | null
  /** Territory width divided by depth. The canvas matches it so the mark is never stretched. */
  aspect: number
}

/**
 * The brand mark, drawn once at the shape of an empire's whole territory.
 *
 * Paired with `buildClusterMosaicGeometry`, this is what spreads a logo across every hex an empire
 * owns instead of stamping it on one. The canvas is generated at the territory's own aspect ratio
 * and the mark is contained inside it, so a wide empire gets a wide canvas and a compact one gets a
 * square — the logo keeps its proportions either way, which simply scaling one square texture to
 * fit a bounding box would not do.
 *
 * Everything outside the mark is transparent, so the brand-coloured hexes and the gaps between them
 * show through and the territory still reads as a grid of tiles rather than a printed sheet.
 */
export function useLogoMosaicTexture({ name, domain, colorHex, logoUrl, aspect }: LogoMosaicInput): THREE.Texture {
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null)
  const proxiedLogoUrl = useMemo(() => logoProxyUrl(logoUrl), [logoUrl])

  useEffect(() => {
    setLogoImage(null)
    if (!proxiedLogoUrl) return

    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (!cancelled) setLogoImage(image)
    }
    image.onerror = () => {
      // Falls back to the wordmark below. A dead logo must never fail a render.
    }
    image.src = proxiedLogoUrl

    return () => {
      cancelled = true
      image.src = ''
    }
  }, [proxiedLogoUrl])

  // Quantised so a one-hex change in a large territory doesn't force a full texture regeneration
  // for a visually identical result.
  const quantisedAspect = Math.max(0.25, Math.min(4, Math.round(aspect * 8) / 8))

  const texture = useMemo(
    () => createLogoMosaicTexture({ name, domain, colorHex, aspect: quantisedAspect }, logoImage),
    [name, domain, colorHex, quantisedAspect, logoImage],
  )

  useEffect(() => () => texture.dispose(), [texture])

  return texture
}

export function createLogoMosaicTexture(
  { name, domain, colorHex, aspect }: Omit<LogoMosaicInput, 'logoUrl'>,
  logoImage: HTMLImageElement | null,
): THREE.Texture {
  const width = aspect >= 1 ? MAX_TEXTURE_EDGE : Math.round(MAX_TEXTURE_EDGE * aspect)
  const height = aspect >= 1 ? Math.round(MAX_TEXTURE_EDGE / aspect) : MAX_TEXTURE_EDGE

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, width)
  canvas.height = Math.max(2, height)
  const ctx = canvas.getContext('2d')

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const boxWidth = canvas.width * CONTAIN_RATIO
    const boxHeight = canvas.height * CONTAIN_RATIO
    const boxX = (canvas.width - boxWidth) / 2
    const boxY = (canvas.height - boxHeight) / 2

    if (logoImage) {
      // Soft brand halo behind the mark, so a logo with thin strokes still separates from the tile
      // colour underneath it.
      const radius = Math.max(boxWidth, boxHeight) / 2
      const glow = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        radius * 0.1,
        canvas.width / 2,
        canvas.height / 2,
        radius,
      )
      glow.addColorStop(0, 'rgba(9,12,18,0.72)')
      glow.addColorStop(1, 'rgba(9,12,18,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      drawContained(ctx, logoImage, boxX, boxY, boxWidth, boxHeight)
    } else {
      // No logo: the domain becomes the mark. Territory must always say who owns it, and a blank
      // patch of colour does not.
      const text = (domain || name).toUpperCase()
      const size = fontSizeToFit(ctx, text, boxWidth, Math.min(boxHeight, canvas.height * 0.42))
      ctx.font = `700 ${size}px "Space Grotesk", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = size * 0.14
      ctx.strokeStyle = 'rgba(9,12,18,0.85)'
      ctx.strokeText(text, canvas.width / 2, canvas.height / 2)
      ctx.fillStyle = colorHex
      ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // Clamped, not repeated: UVs are generated to span exactly 0..1 across the territory, and a
  // rounding error at the edge must not wrap the image round to the far side.
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

function fontSizeToFit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxHeight: number): number {
  for (let size = Math.floor(maxHeight); size > 12; size -= 4) {
    ctx.font = `700 ${size}px "Space Grotesk", system-ui, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) return size
  }
  return 12
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const naturalWidth = image.naturalWidth || width
  const naturalHeight = image.naturalHeight || height
  const scale = Math.min(width / naturalWidth, height / naturalHeight)
  const drawWidth = naturalWidth * scale
  const drawHeight = naturalHeight * scale
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}
