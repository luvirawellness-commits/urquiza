import sharp from 'sharp'

const svg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="100" fill="#3D0E1A"/>
  <g transform="translate(256,256) scale(2.2)">
    <path d="M -42 -36 L -42 30 Q -42 38 -34 38 L 36 38"
      fill="none" stroke="#C9A227" stroke-width="9"
      stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M -10 -36 L -10 18"
      fill="none" stroke="#7B1FA2" stroke-width="9"
      stroke-linecap="round"/>
    <circle cx="-10" cy="-46" r="6" fill="#7B1FA2"/>
  </g>
</svg>`

const buf = Buffer.from(svg)

await sharp(buf).resize(32, 32).png().toFile('public/favicon.png')
console.log('✓  public/favicon.png (32×32)')
