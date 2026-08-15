#!/usr/bin/env node
// Generates every release-facing MoneyWise brand asset from one mark definition.
//
// The mark is four ascending rounded bars — growth, rendered in the MoneyWise
// blue identity already used by the splash background and app chrome. It
// deliberately shares no geometry with the Expo chevron that previously stood in
// for the app icon across the launcher, adaptive, monochrome, splash and web
// assets.
//
// Re-run after changing MARK or PALETTE to regenerate all outputs:
//   node scripts/generate-brand-assets.mjs
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { PNG } = createRequire(import.meta.url)('pngjs')
const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images')

const PALETTE = {
  brand: [0x20, 0x8a, 0xef], // #208AEF — splash background, app accent
  brandTop: [0x3c, 0x9d, 0xff],
  brandBottom: [0x12, 0x6f, 0xc8],
  white: [0xff, 0xff, 0xff],
  ink: [0x08, 0x11, 0x22] // #081122 — app background
}

// Four bottom-aligned bars in a unit box, ascending left to right.
const BAR_COUNT = 4
const BAR_WIDTH = 0.17
const BAR_GAP = (1 - BAR_COUNT * BAR_WIDTH) / (BAR_COUNT - 1)
const BAR_HEIGHTS = [0.34, 0.56, 0.78, 1.0]

const MARK = BAR_HEIGHTS.map((height, index) => ({
  x: index * (BAR_WIDTH + BAR_GAP),
  y: 1 - height,
  width: BAR_WIDTH,
  height,
  radius: BAR_WIDTH / 2
}))

const SUBSAMPLES = 4

function insideRoundedRect(px, py, rect) {
  const { x, y, width, height, radius } = rect
  if (px < x || px > x + width || py < y || py > y + height) return false
  const innerLeft = x + radius
  const innerRight = x + width - radius
  const innerTop = y + radius
  const innerBottom = y + height - radius
  const cornerX = px < innerLeft ? innerLeft : px > innerRight ? innerRight : px
  const cornerY = py < innerTop ? innerTop : py > innerBottom ? innerBottom : py
  if (cornerX === px && cornerY === py) return true
  const dx = px - cornerX
  const dy = py - cornerY
  return dx * dx + dy * dy <= radius * radius
}

// Coverage of the mark at a pixel, in unit-box coordinates, via supersampling.
function markCoverage(pixelX, pixelY, size, boxOrigin, boxSize) {
  let hits = 0
  for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
    for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
      const deviceX = pixelX + (sx + 0.5) / SUBSAMPLES
      const deviceY = pixelY + (sy + 0.5) / SUBSAMPLES
      const unitX = (deviceX - boxOrigin.x) / boxSize
      const unitY = (deviceY - boxOrigin.y) / boxSize
      if (unitX < 0 || unitX > 1 || unitY < 0 || unitY > 1) continue
      if (MARK.some((rect) => insideRoundedRect(unitX, unitY, rect))) hits += 1
    }
  }
  return hits / (SUBSAMPLES * SUBSAMPLES)
}

/**
 * @param size        output edge length in pixels
 * @param markFraction fraction of the canvas the mark box spans
 * @param markColor   rgb triple painted for the mark
 * @param background  null for transparent, or { flat } / { top, bottom } gradient
 */
function render({ size, markFraction, markColor, background }) {
  const png = new PNG({ width: size, height: size })
  const boxSize = size * markFraction
  const boxOrigin = { x: (size - boxSize) / 2, y: (size - boxSize) / 2 }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (size * y + x) * 4
      let baseR = 0
      let baseG = 0
      let baseB = 0
      let baseA = 0

      if (background?.flat) {
        ;[baseR, baseG, baseB] = background.flat
        baseA = 255
      } else if (background?.top) {
        const t = y / (size - 1)
        baseR = Math.round(background.top[0] + (background.bottom[0] - background.top[0]) * t)
        baseG = Math.round(background.top[1] + (background.bottom[1] - background.top[1]) * t)
        baseB = Math.round(background.top[2] + (background.bottom[2] - background.top[2]) * t)
        baseA = 255
      }

      const coverage = markCoverage(x, y, size, boxOrigin, boxSize)
      if (coverage > 0) {
        baseR = Math.round(markColor[0] * coverage + baseR * (1 - coverage))
        baseG = Math.round(markColor[1] * coverage + baseG * (1 - coverage))
        baseB = Math.round(markColor[2] * coverage + baseB * (1 - coverage))
        baseA = Math.round(255 * coverage + baseA * (1 - coverage))
      }

      png.data[index] = baseR
      png.data[index + 1] = baseG
      png.data[index + 2] = baseB
      png.data[index + 3] = baseA
    }
  }
  return png
}

function emit(name, png) {
  const path = join(assets, name)
  writeFileSync(path, PNG.sync.write(png))
  console.log(`  ${name.padEnd(32)} ${png.width}x${png.height}`)
}

console.log('MoneyWise brand assets:')

// Launcher / iOS source icon: full-bleed brand gradient, white mark.
emit(
  'icon.png',
  render({
    size: 1024,
    markFraction: 0.52,
    markColor: PALETTE.white,
    background: { top: PALETTE.brandTop, bottom: PALETTE.brandBottom }
  })
)

// Adaptive icon foreground: mark only, held inside the 66% safe zone.
emit(
  'android-icon-foreground.png',
  render({ size: 512, markFraction: 0.40, markColor: PALETTE.white, background: null })
)

// Adaptive icon background: flat brand field beneath the foreground.
emit(
  'android-icon-background.png',
  render({ size: 512, markFraction: 0, markColor: PALETTE.white, background: { flat: PALETTE.brand } })
)

// Themed (monochrome) icon: opaque silhouette, tinted by the launcher.
emit(
  'android-icon-monochrome.png',
  render({ size: 512, markFraction: 0.40, markColor: PALETTE.ink, background: null })
)

// Splash mark: white on transparent, composited over #208AEF by expo-splash-screen.
emit(
  'splash-icon.png',
  render({ size: 512, markFraction: 0.72, markColor: PALETTE.white, background: null })
)

// Web favicon.
emit(
  'favicon.png',
  render({
    size: 64,
    markFraction: 0.58,
    markColor: PALETTE.white,
    background: { flat: PALETTE.brand }
  })
)

// iOS icon-composer symbol: same mark as vector art, tinted by icon.json's fill.
const SVG_SIZE = 512
const SVG_MARK = 0.52
const svgBox = SVG_SIZE * SVG_MARK
const svgOrigin = (SVG_SIZE - svgBox) / 2
const svgBars = MARK.map((rect) => {
  const x = svgOrigin + rect.x * svgBox
  const y = svgOrigin + rect.y * svgBox
  const width = rect.width * svgBox
  const height = rect.height * svgBox
  const radius = rect.radius * svgBox
  return `  <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="${radius.toFixed(2)}" fill="white"/>`
}).join('\n')

const svg = `<svg width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}" fill="none" xmlns="http://www.w3.org/2000/svg">
${svgBars}
</svg>
`
const svgPath = join(assets, '..', 'expo.icon', 'Assets', 'moneywise-symbol.svg')
writeFileSync(svgPath, svg)
console.log(`  moneywise-symbol.svg             ${SVG_SIZE}x${SVG_SIZE} (iOS icon symbol)`)

console.log('done.')
