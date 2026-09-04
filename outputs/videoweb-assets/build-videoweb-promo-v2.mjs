import sharp from "/Users/ai6677/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/lib/index.js";

const root = "/Users/ai6677/Documents/GitHub/autofill_forms_ai/outputs/videoweb-assets";

function overlaySvg(width, height, body) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#0a0c0b" stop-opacity="0.98"/>
          <stop offset="43%" stop-color="#0a0c0b" stop-opacity="0.86"/>
          <stop offset="70%" stop-color="#0a0c0b" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#0a0c0b" stop-opacity="0"/>
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.7"/>
        </filter>
      </defs>
      ${body}
    </svg>
  `);
}

async function transparentLogo(size) {
  const source = await sharp(`${root}/videoweb-logo-512.png`)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < source.data.length; i += 4) {
    const distanceFromWhite = 255 - Math.min(source.data[i], source.data[i + 1], source.data[i + 2]);
    source.data[i + 3] = Math.max(0, Math.min(255, (distanceFromWhite - 2) * 18));
  }

  return sharp(source.data, { raw: source.info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 5 })
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer();
}

async function roundedScreenshot(width, height) {
  const screenshot = await sharp(`${root}/videoweb-website-screenshot-1400.jpg`)
    .resize(width, height, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const mask = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="16" fill="white"/>
    </svg>
  `);
  return sharp(screenshot)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function buildProductPromo() {
  const width = 1200;
  const height = 675;
  const logo = await transparentLogo(52);
  const screenshot = await roundedScreenshot(650, 309);
  const overlay = overlaySvg(width, height, `
    <rect width="770" height="${height}" fill="url(#shade)"/>
    <rect x="494" y="275" width="670" height="329" rx="22" fill="#101311" stroke="#737a70" stroke-width="1.5" filter="url(#shadow)"/>
    <text x="128" y="94" fill="#efffc5" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="700">VideoWeb.ai</text>
    <text x="64" y="194" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="49" font-weight="700">
      <tspan x="64" dy="0">Create Videos.</tspan>
      <tspan x="64" dy="60">Generate Images.</tspan>
      <tspan x="64" dy="60">Make Music.</tspan>
    </text>
    <text x="64" y="421" fill="#d8ddd5" font-family="Arial, Helvetica, sans-serif" font-size="21">Every creative AI tool, in one workspace.</text>
    <line x1="64" y1="472" x2="424" y2="472" stroke="#dfff9c" stroke-width="3"/>
    <text x="64" y="518" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">VIDEO</text>
    <circle cx="160" cy="512" r="3" fill="#7ee7da"/>
    <text x="181" y="518" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">IMAGE</text>
    <circle cx="276" cy="512" r="3" fill="#ff9b78"/>
    <text x="297" y="518" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">MUSIC</text>
  `);

  await sharp(`${root}/videoweb-product-background-v2.png`)
    .resize(width, height, { fit: "cover", position: "centre" })
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: logo, left: 64, top: 58 },
      { input: screenshot, left: 504, top: 285 },
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(`${root}/videoweb-product-promo-v2-1200x675.jpg`);
}

async function buildBanner() {
  const width = 1600;
  const height = 600;
  const logo = await transparentLogo(58);
  const overlay = overlaySvg(width, height, `
    <rect width="850" height="${height}" fill="url(#shade)"/>
    <text x="158" y="122" fill="#efffc5" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="700">VideoWeb.ai</text>
    <text x="80" y="245" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="700">
      <tspan x="80" dy="0">Create Without</tspan>
      <tspan x="80" dy="68">Limits.</tspan>
    </text>
    <text x="80" y="388" fill="#d8ddd5" font-family="Arial, Helvetica, sans-serif" font-size="24">Video, image and music AI in one place.</text>
    <line x1="80" y1="442" x2="536" y2="442" stroke="#dfff9c" stroke-width="3"/>
    <text x="80" y="497" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="600">VIDEO</text>
    <circle cx="179" cy="491" r="3" fill="#7ee7da"/>
    <text x="201" y="497" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="600">IMAGE</text>
    <circle cx="300" cy="491" r="3" fill="#ff9b78"/>
    <text x="322" y="497" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="600">MUSIC</text>
  `);

  await sharp(`${root}/videoweb-banner-background-v2.png`)
    .resize(width, height, { fit: "cover", position: "centre" })
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: logo, left: 80, top: 70 },
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(`${root}/videoweb-banner-promo-v2-1600x600.jpg`);
}

await Promise.all([buildProductPromo(), buildBanner()]);
