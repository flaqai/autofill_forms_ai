import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const outDir = '/Users/ai6677/Desktop/工作文件/Fylia AI'
const screenshotPath = path.join(outDir, 'fylia-ai-website-screenshot-1480x987.png')
const iconSource = await fs.readFile('/tmp/fylia-icon.svg', 'utf8')
const croppedIcon = iconSource.replace(
  '<svg width="64" height="64" viewBox="0 0 64 64"',
  '<svg width="600" height="600" viewBox="12 12 40 40"',
)

await fs.writeFile(path.join(outDir, 'fylia-ai-logo-master.svg'), croppedIcon)

for (const size of [256, 500, 512, 560, 600]) {
  await sharp(Buffer.from(croppedIcon))
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, `fylia-ai-logo-transparent-${size}x${size}.png`))
}

const logo260 = await sharp(Buffer.from(croppedIcon)).resize(260, 260).png().toBuffer()
await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: logo260, left: 70, top: 20 }])
  .png({ compressionLevel: 9 })
  .toFile(path.join(outDir, 'fylia-ai-logo-transparent-400x300.png'))

const screenshot = await fs.readFile(screenshotPath)
const logo96 = await sharp(Buffer.from(croppedIcon)).resize(96, 96).png().toBuffer()
const logo72 = await sharp(Buffer.from(croppedIcon)).resize(72, 72).png().toBuffer()

function roundedMask(width, height, radius) {
  return Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="white"/></svg>`)
}

async function roundedScreenshot(width, height, radius = 10) {
  return sharp(screenshot)
    .resize(width, height, { fit: 'cover', position: 'top' })
    .composite([{ input: roundedMask(width, height, radius), blend: 'dest-in' }])
    .png()
    .toBuffer()
}

const galleryShot = await roundedScreenshot(800, 534, 12)
const galleryOneSvg = Buffer.from(`
<svg width="1400" height="800" xmlns="http://www.w3.org/2000/svg">
  <rect width="1400" height="800" fill="#111216"/>
  <rect x="0" y="0" width="12" height="800" fill="#d838f2"/>
  <circle cx="1280" cy="82" r="150" fill="#172d36" opacity="0.82"/>
  <rect x="48" y="48" width="1304" height="704" rx="8" fill="none" stroke="#30323a"/>
  <text x="148" y="102" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">Fylia AI</text>
  <text x="78" y="205" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="700">One workspace.</text>
  <text x="78" y="276" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700">Images + video.</text>
  <text x="78" y="335" fill="#b8bac4" font-family="Arial, Helvetica, sans-serif" font-size="25">Generate, edit and enhance visual content</text>
  <text x="78" y="371" fill="#b8bac4" font-family="Arial, Helvetica, sans-serif" font-size="25">with leading AI models in one place.</text>
  <rect x="78" y="420" width="195" height="48" rx="6" fill="#d838f2"/>
  <text x="176" y="451" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">Text to Video</text>
  <rect x="286" y="420" width="205" height="48" rx="6" fill="#1f3f4d"/>
  <text x="389" y="451" text-anchor="middle" fill="#dff8ff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">Image to Video</text>
  <rect x="78" y="482" width="195" height="48" rx="6" fill="#35363e"/>
  <text x="176" y="513" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">AI Image Tools</text>
  <rect x="286" y="482" width="205" height="48" rx="6" fill="#35363e"/>
  <text x="389" y="513" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">Free Utilities</text>
  <text x="78" y="665" fill="#f1c85b" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700">CREATE AT FYLIA.AI</text>
  <rect x="542" y="119" width="820" height="574" rx="16" fill="#08090b" stroke="#42444d" stroke-width="2"/>
  <circle cx="572" cy="145" r="6" fill="#ff6b67"/><circle cx="593" cy="145" r="6" fill="#f1c85b"/><circle cx="614" cy="145" r="6" fill="#3bc27f"/>
</svg>`)

await sharp(galleryOneSvg)
  .composite([
    { input: logo72, left: 64, top: 55 },
    { input: galleryShot, left: 552, top: 159 },
  ])
  .jpeg({ quality: 82, chromaSubsampling: '4:2:0', mozjpeg: true })
  .toFile(path.join(outDir, 'fylia-ai-gallery-1400x800-01.jpg'))

const galleryTwoShot = await roundedScreenshot(780, 520, 10)
const galleryTwoSvg = Buffer.from(`
<svg width="1400" height="800" xmlns="http://www.w3.org/2000/svg">
  <rect width="1400" height="800" fill="#f5f6f8"/>
  <rect x="48" y="48" width="1304" height="704" rx="8" fill="#ffffff" stroke="#d8dbe2"/>
  <rect x="78" y="90" width="20" height="92" rx="4" fill="#d838f2"/>
  <text x="124" y="128" fill="#16171b" font-family="Arial, Helvetica, sans-serif" font-size="50" font-weight="700">From prompt to polished visual</text>
  <text x="124" y="174" fill="#5b5e68" font-family="Arial, Helvetica, sans-serif" font-size="23">A practical creative workspace for image and video production.</text>
  <rect x="78" y="220" width="806" height="556" rx="14" fill="#101115"/>
  <text x="930" y="270" fill="#16171b" font-family="Arial, Helvetica, sans-serif" font-size="35" font-weight="700">Built for real workflows</text>
  <circle cx="947" cy="333" r="14" fill="#d838f2"/><text x="978" y="342" fill="#292b31" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">Generate</text>
  <text x="978" y="376" fill="#6b6e78" font-family="Arial, Helvetica, sans-serif" font-size="20">Text, image and reference inputs</text>
  <circle cx="947" cy="441" r="14" fill="#36a9c9"/><text x="978" y="450" fill="#292b31" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">Control</text>
  <text x="978" y="484" fill="#6b6e78" font-family="Arial, Helvetica, sans-serif" font-size="20">Models, ratios and resolutions</text>
  <circle cx="947" cy="549" r="14" fill="#f1c85b"/><text x="978" y="558" fill="#292b31" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">Finish</text>
  <text x="978" y="592" fill="#6b6e78" font-family="Arial, Helvetica, sans-serif" font-size="20">Edit, enhance and export</text>
  <rect x="930" y="652" width="264" height="56" rx="6" fill="#16171b"/>
  <text x="1062" y="688" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="700">Explore Fylia AI</text>
</svg>`)

await sharp(galleryTwoSvg)
  .composite([{ input: galleryTwoShot, left: 91, top: 238 }])
  .jpeg({ quality: 82, chromaSubsampling: '4:2:0', mozjpeg: true })
  .toFile(path.join(outDir, 'fylia-ai-gallery-1400x800-02.jpg'))

const promoShot = await roundedScreenshot(590, 393, 10)
const promoSvg = Buffer.from(`
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#101115"/>
  <rect x="0" y="0" width="1200" height="10" fill="#d838f2"/>
  <rect x="52" y="52" width="1096" height="526" rx="8" fill="none" stroke="#30323a"/>
  <text x="148" y="128" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">Fylia AI</text>
  <text x="78" y="220" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="700">Create images.</text>
  <text x="78" y="283" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="700">Create videos.</text>
  <text x="78" y="340" fill="#b8bac4" font-family="Arial, Helvetica, sans-serif" font-size="24">Leading AI models and practical</text>
  <text x="78" y="375" fill="#b8bac4" font-family="Arial, Helvetica, sans-serif" font-size="24">creative tools in one workspace.</text>
  <rect x="78" y="430" width="216" height="54" rx="6" fill="#d838f2"/>
  <text x="186" y="465" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="700">Start creating</text>
  <text x="78" y="535" fill="#f1c85b" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">FYLIA.AI</text>
  <rect x="548" y="92" width="624" height="446" rx="14" fill="#08090b" stroke="#42444d"/>
</svg>`)

await sharp(promoSvg)
  .composite([
    { input: logo72, left: 65, top: 81 },
    { input: promoShot, left: 565, top: 122 },
  ])
  .jpeg({ quality: 82, chromaSubsampling: '4:2:0', mozjpeg: true })
  .toFile(path.join(outDir, 'fylia-ai-product-promo-1200x630.jpg'))

const bannerShot = await roundedScreenshot(650, 433, 8)
const bannerSvg = Buffer.from(`
<svg width="1500" height="500" xmlns="http://www.w3.org/2000/svg">
  <rect width="1500" height="500" fill="#111216"/>
  <rect x="0" y="0" width="14" height="500" fill="#d838f2"/>
  <path d="M650 0 H1500 V500 H760 Z" fill="#171a20"/>
  <text x="188" y="136" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="700">Fylia AI</text>
  <text x="96" y="235" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700">Create beyond the prompt.</text>
  <text x="96" y="290" fill="#b8bac4" font-family="Arial, Helvetica, sans-serif" font-size="24">AI images, videos and creative tools in one workspace.</text>
  <rect x="96" y="345" width="184" height="54" rx="6" fill="#d838f2"/>
  <text x="188" y="380" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="700">Explore Fylia AI</text>
  <text x="310" y="380" fill="#f1c85b" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">FYLIA.AI</text>
</svg>`)

await sharp(bannerSvg)
  .composite([
    { input: logo96, left: 72, top: 54 },
    { input: bannerShot, left: 824, top: 34 },
  ])
  .jpeg({ quality: 82, chromaSubsampling: '4:2:0', mozjpeg: true })
  .toFile(path.join(outDir, 'fylia-ai-banner-1500x500.jpg'))

await sharp('/tmp/fylia-home-page.jpg')
  .jpeg({ quality: 78, chromaSubsampling: '4:2:0', mozjpeg: true })
  .toFile(path.join(outDir, 'fylia-ai-official-preview-1200x630-under-400kb.jpg'))

await sharp(screenshot)
  .resize(1400, 800, { fit: 'cover', position: 'top' })
  .jpeg({ quality: 80, chromaSubsampling: '4:2:0', mozjpeg: true })
  .toFile(path.join(outDir, 'fylia-ai-website-screenshot-1400x800-under-400kb.jpg'))
