import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { logoProxyUrl } from '@/lib/brand/logoProxyUrl'
import type { PlaqueDetail } from '@/lib/hex/clusterFootprint'

/**
 * Canvas resolution by tier. Larger territories render physically larger on screen, so they need
 * more pixels to stay sharp when zoomed in — a fixed size would leave a 30-hex empire's tagline
 * visibly soft.
 */
const TEXTURE_EDGE_BY_DETAIL: Record<PlaqueDetail, number> = {
  compact: 512,
  standard: 1024,
  full: 1536,
}

/** Fraction of the territory the content occupies, leaving a margin clear of the border. */
const CONTAIN_RATIO = 0.82
const MAX_DESCRIPTION_LINES = 4

export type LogoMosaicInput = {
  name: string
  domain: string
  title: string
  description: string
  colorHex: string
  logoUrl: string | null
  /** Territory width divided by depth. The canvas matches it so the mark is never stretched. */
  aspect: number
  /**
   * Where the content goes, in 0..1 texture space, and how much room it has there.
   *
   * NOT the middle of the bounding box. Territory is rarely a neat rectangle, and centring content
   * in its bounding box puts it wherever the box happens to be centred — which on an L, a ring or
   * any ragged cluster is ground the empire does not own, so the mark and the wording get sliced
   * off at the tile edges. These come from the cluster's most interior tile and its clearance
   * (lib/hex/clusterFootprint.ts), so whatever is drawn lands on tiles that are actually theirs.
   */
  focus: { u: number; v: number; halfU: number; halfV: number }
  /** How much room the territory has — see lib/hex/clusterFootprint.ts. Controls what fits. */
  detail: PlaqueDetail
}

/**
 * An empire's brand, drawn once at the shape of its whole territory.
 *
 * Paired with `buildClusterMosaicGeometry`, this is what spreads a brand across every hex an
 * empire owns instead of stamping it on one. The canvas is generated at the territory's own aspect
 * ratio and the content is laid out inside it, so a wide empire gets a wide canvas and a compact
 * one gets a square — proportions are preserved either way, which simply scaling one square texture
 * to fit a bounding box would not do.
 *
 * The logo comes first and never yields. Words are added BENEATH it as the territory grows: a
 * single hex carries the mark alone, because a domain at that size would be a few pixels tall and
 * read as noise; a larger holding earns its domain underneath; a large one earns the scraped
 * description under that. Territory becomes real advertising space, and buying more of it literally
 * buys more room to say something — but the mark is always the part that survives.
 *
 * Everything outside the content is transparent, so the brand-coloured hexes and the gaps between
 * them show through and the territory still reads as a grid of tiles rather than a printed sheet.
 */
export function useLogoMosaicTexture({
  name,
  domain,
  title,
  description,
  colorHex,
  logoUrl,
  aspect,
  detail,
  focus,
}: LogoMosaicInput): THREE.Texture {
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
    () =>
      createLogoMosaicTexture(
        { name, domain, title, description, colorHex, aspect: quantisedAspect, detail, focus },
        logoImage,
      ),
    [name, domain, title, description, colorHex, quantisedAspect, detail, focus, logoImage],
  )

  useEffect(() => () => texture.dispose(), [texture])

  return texture
}

export function createLogoMosaicTexture(
  { name, domain, title, description, colorHex, aspect, detail, focus }: Omit<LogoMosaicInput, 'logoUrl'>,
  logoImage: HTMLImageElement | null,
): THREE.Texture {
  const edge = TEXTURE_EDGE_BY_DETAIL[detail]
  const width = Math.max(2, aspect >= 1 ? edge : Math.round(edge * aspect))
  const height = Math.max(2, aspect >= 1 ? Math.round(edge / aspect) : edge)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (ctx) {
    ctx.clearRect(0, 0, width, height)

    // The safe box: centred on the cluster's interior, not the bounding box, and never wider than
    // the clearance actually available there.
    const boxWidth = Math.max(8, width * focus.halfU * 2 * CONTAIN_RATIO)
    const boxHeight = Math.max(8, height * focus.halfV * 2 * CONTAIN_RATIO)
    const centerX = width * focus.u
    const centerY = height * focus.v
    const boxX = centerX - boxWidth / 2
    const boxY = centerY - boxHeight / 2

    // Backdrop under the content only. Brand marks and small text both need separation from a
    // saturated tile colour, and a full-bleed panel would hide the hex grid the mosaic sits on.
    drawContentScrim(ctx, centerX, centerY, Math.max(boxWidth, boxHeight) * 0.62)

    const showDomain = detail !== 'compact'
    const showDescription = detail === 'full' && Boolean(description || title)

    // The logo is ALWAYS drawn, always first, always on top. It is the thing that identifies the
    // owner at a glance, and it is the only element guaranteed to be legible at every zoom — words
    // stack underneath it and only when the territory is genuinely large enough to carry them.
    // A layout that ever set the mark aside to make room for text would be trading the reliable
    // signal for the fragile one.
    const markShare = !showDomain ? 1 : showDescription ? 0.52 : 0.68
    const markHeight = boxHeight * markShare
    const markSize = Math.min(markHeight, boxWidth)

    drawMark(
      ctx,
      boxX + (boxWidth - markSize) / 2,
      boxY + (markHeight - markSize) / 2,
      markSize,
      markSize,
      colorHex,
      name,
      domain,
      logoImage,
    )

    if (showDomain) {
      drawTextBlock(ctx, {
        x: boxX,
        y: boxY + markHeight + boxHeight * 0.03,
        width: boxWidth,
        height: boxHeight - markHeight - boxHeight * 0.03,
        domain: domain || name,
        description: showDescription ? description || title : '',
        scale: boxHeight,
      })
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // Clamped, not repeated: UVs span exactly 0..1 across the territory, and a rounding error at the
  // edge must not wrap the image round to the far side.
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

/** Soft dark pool behind the content so light logos and small text hold their contrast. */
function drawContentScrim(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius)
  gradient.addColorStop(0, 'rgba(9,12,18,0.8)')
  gradient.addColorStop(1, 'rgba(9,12,18,0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
}

/** The logo if one loaded, otherwise the domain as a wordmark. Territory always says who owns it. */
function drawMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  colorHex: string,
  name: string,
  domain: string,
  logoImage: HTMLImageElement | null,
): void {
  if (logoImage) {
    drawContained(ctx, logoImage, x, y, width, height)
    return
  }

  const text = (domain || name).toUpperCase()
  const size = fontSizeToFit(ctx, text, width, Math.min(height, width * 0.34), 700)
  ctx.font = `700 ${size}px "Space Grotesk", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = size * 0.14
  ctx.strokeStyle = 'rgba(9,12,18,0.85)'
  ctx.strokeText(text, x + width / 2, y + height / 2)
  ctx.fillStyle = colorHex
  ctx.fillText(text, x + width / 2, y + height / 2)
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  options: {
    x: number
    y: number
    width: number
    height: number
    domain: string
    description: string
    scale: number
  },
): void {
  const { x, y, width, height, domain, description, scale } = options
  const anchorX = x + width / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  // Sized off the canvas height rather than a fixed pixel value, so the domain occupies the same
  // visual share of the territory whatever resolution the tier renders at.
  const domainSize = fontSizeToFit(ctx, domain, width, Math.max(14, scale * 0.26), 700)
  ctx.font = `700 ${domainSize}px "Space Grotesk", system-ui, sans-serif`
  ctx.fillStyle = '#FFFFFF'
  ctx.lineWidth = domainSize * 0.16
  ctx.strokeStyle = 'rgba(9,12,18,0.9)'
  ctx.strokeText(domain, anchorX, y)
  ctx.fillText(domain, anchorX, y)

  if (!description) return

  const bodySize = Math.max(domainSize * 0.42, scale * 0.09)
  const lineHeight = bodySize * 1.28
  ctx.font = `500 ${bodySize}px "Inter", system-ui, sans-serif`

  const available = height - domainSize * 1.35
  const maxLines = Math.max(0, Math.min(MAX_DESCRIPTION_LINES, Math.floor(available / lineHeight)))
  if (maxLines === 0) return

  const lines = wrapText(ctx, description, width, maxLines)
  let lineY = y + domainSize * 1.35

  for (const line of lines) {
    ctx.lineWidth = bodySize * 0.2
    ctx.strokeStyle = 'rgba(9,12,18,0.9)'
    ctx.strokeText(line, anchorX, lineY)
    ctx.fillStyle = 'rgba(237,241,247,0.86)'
    ctx.fillText(line, anchorX, lineY)
    lineY += lineHeight
  }
}

/**
 * Greedy word wrap, truncated with an ellipsis at `maxLines`.
 *
 * Exported for tests: the wrapping is easy to get subtly wrong (a word longer than the line, an
 * empty string, a limit of zero) and each of those renders as visible garbage on the map.
 */
export function wrapText(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || maxLines <= 0 || maxWidth <= 0) return []

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
      continue
    }
    lines.push(current)
    current = word
    if (lines.length === maxLines) break
  }

  if (lines.length < maxLines && current) lines.push(current)

  // Anything that didn't fit is signalled rather than silently dropped.
  const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length
  if (consumed < words.length && lines.length > 0) {
    const last = lines.length - 1
    let truncated = lines[last] as string
    while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
      truncated = truncated.slice(0, -1)
    }
    lines[last] = `${truncated.trimEnd()}…`
  }

  return lines
}

function fontSizeToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  weight: number,
): number {
  for (let size = Math.floor(maxSize); size > 10; size -= 2) {
    ctx.font = `${weight} ${size}px "Space Grotesk", system-ui, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) return size
  }
  return 10
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
