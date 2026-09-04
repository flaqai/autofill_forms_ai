import sharp from "/Users/ai6677/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/lib/index.js";

const root = "/Users/ai6677/Documents/GitHub/autofill_forms_ai/outputs/fylia-assets";

function textOverlay(width, height, body) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#08090b" stop-opacity="0.99"/>
          <stop offset="42%" stop-color="#08090b" stop-opacity="0.88"/>
          <stop offset="68%" stop-color="#08090b" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#08090b" stop-opacity="0"/>
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.72"/>
        </filter>
      </defs>
      ${body}
    </svg>
  `);
}

async function roundedScreenshot(width, height) {
  const screenshot = await sharp(`${root}/fylia-ai-website-screenshot-1480x987.png`)
    .resize(width, height, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const mask = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="16" fill="white"/></svg>`);
  return sharp(screenshot).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

async function logoMark(size) {
  return sharp(`${root}/fylia-ai-logo-official.svg`, { density: 1200 })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer();
}

async function buildProductPromo() {
  const width = 1200;
  const height = 675;
  const interfaceImage = await roundedScreenshot(625, 417);
  const logo = await logoMark(48);
  const overlay = textOverlay(width, height, `
    <rect width="760" height="${height}" fill="url(#shade)"/>
    <rect x="514" y="145" width="645" height="437" rx="22" fill="#090a0d" stroke="#555760" stroke-width="1.5" filter="url(#shadow)"/>
    <text x="128" y="95" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">Fylia AI</text>
    <text x="64" y="211" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="50" font-weight="700">
      <tspan x="64" dy="0">Create Images.</tspan>
      <tspan x="64" dy="61">Make Videos.</tspan>
      <tspan x="64" dy="61">Edit Every Detail.</tspan>
    </text>
    <text x="64" y="431" fill="#d7d9df" font-family="Arial, Helvetica, sans-serif" font-size="21">Generate, edit and enhance in one workspace.</text>
    <line x1="64" y1="478" x2="430" y2="478" stroke="#dc35ef" stroke-width="3"/>
    <text x="64" y="521" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">IMAGE</text>
    <circle cx="159" cy="515" r="3" fill="#56d8e8"/>
    <text x="180" y="521" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">VIDEO</text>
    <circle cx="268" cy="515" r="3" fill="#f2bf58"/>
    <text x="289" y="521" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">EFFECTS</text>
  `);

  await sharp(`${root}/fylia-ai-product-background-v2.png`)
    .resize(width, height, { fit: "cover", position: "centre" })
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: logo, left: 64, top: 59 },
      { input: interfaceImage, left: 524, top: 155 },
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(`${root}/fylia-ai-product-promo-v2-1200x675.jpg`);
}

async function buildBanner() {
  const width = 1600;
  const height = 600;
  const logo = await logoMark(58);
  const overlay = textOverlay(width, height, `
    <rect width="820" height="${height}" fill="url(#shade)"/>
    <text x="158" y="124" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="700">Fylia AI</text>
    <text x="80" y="270" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="700">
      <tspan x="80" dy="0">Ideas In.</tspan>
      <tspan x="80" dy="72">Stories In Motion.</tspan>
    </text>
    <text x="80" y="410" fill="#d7d9df" font-family="Arial, Helvetica, sans-serif" font-size="24">Generate, edit and enhance images and videos.</text>
    <line x1="80" y1="461" x2="530" y2="461" stroke="#dc35ef" stroke-width="3"/>
    <text x="80" y="510" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">CREATE</text>
    <circle cx="176" cy="504" r="3" fill="#56d8e8"/>
    <text x="198" y="510" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">TRANSFORM</text>
    <circle cx="334" cy="504" r="3" fill="#f2bf58"/>
    <text x="356" y="510" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">ANIMATE</text>
  `);

  await sharp(`${root}/fylia-ai-banner-background-v2.png`)
    .resize(width, height, { fit: "cover", position: "centre" })
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: logo, left: 80, top: 72 },
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(`${root}/fylia-ai-banner-promo-v2-1600x600.jpg`);
}

await Promise.all([buildProductPromo(), buildBanner()]);
