import sharp from 'sharp'
import { mkdirSync, existsSync } from 'fs'

// ── Design constants ─────────────────────────────────────────────────────────
// All geometry is expressed in the 512×512 viewBox coordinate space.
// sharp + librsvg scales the viewBox to whatever output size we request.

const BORDEAUX = '#3D0E1A'

/**
 * Build the SVG for the Luvira OS icon.
 *
 * @param {number} outputSize  - Pixel size of the output PNG
 * @param {object} opts
 *   rounded  – add rounded corners to the background rect (non-maskable icons)
 *   maskable – shrink the symbol so it sits comfortably inside the PWA safe zone
 *   social   – no rounding, no extra padding (1024 social-media version)
 */
function makeSvg(outputSize, { rounded = true, maskable = false } = {}) {
  // rx in viewBox units: 100/512 * outputSize keeps corners proportional
  const rxVb = rounded ? 100 : 0
  const rxAttr = rxVb > 0 ? `rx="${rxVb}"` : ''

  // For maskable icons the symbol must stay inside the "safe zone" (inner 80%).
  // We achieve this with an extra 20% shrink (scale factor × 0.6).
  const symbolScale = maskable ? 2.2 * 0.6 : 2.2

  return `<svg width="${outputSize}" height="${outputSize}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" ${rxAttr} fill="${BORDEAUX}"/>
  <g transform="translate(256,256) scale(${symbolScale})">
    <path d="M -42 -36 L -42 30 Q -42 38 -34 38 L 36 38"
      fill="none" stroke="#C9A227" stroke-width="9"
      stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M -10 -36 L -10 18"
      fill="none" stroke="#7B1FA2" stroke-width="9"
      stroke-linecap="round"/>
    <circle cx="-10" cy="-46" r="6" fill="#7B1FA2"/>
  </g>
</svg>`
}

// ── File manifest ─────────────────────────────────────────────────────────────
const configs = [
  { size: 192,  opts: { rounded: true,  maskable: false }, file: 'icon-192.png'            },
  { size: 512,  opts: { rounded: true,  maskable: false }, file: 'icon-512.png'            },
  { size: 192,  opts: { rounded: false, maskable: true  }, file: 'icon-maskable-192.png'   },
  { size: 512,  opts: { rounded: false, maskable: true  }, file: 'icon-maskable-512.png'   },
  { size: 1024, opts: { rounded: false, maskable: false }, file: 'logo-luvira-os-1024.png' },
]

// ── Generate ──────────────────────────────────────────────────────────────────
if (!existsSync('public/icons')) mkdirSync('public/icons', { recursive: true })

for (const { size, opts, file } of configs) {
  const dest = `public/icons/${file}`
  await sharp(Buffer.from(makeSvg(size, opts))).png().toFile(dest)
  console.log(`✓  ${dest}`)
}
