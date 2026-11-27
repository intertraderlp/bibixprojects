// Generate the Bibix Idealista Scraper icon (red rounded square, white "ID") as
// PNGs with no external deps. Run: node generate-icons.js  → icons/icon{16,32,48,128}.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Red background, white letters.
const RED = [226, 68, 92]; // #e2445c (Bibix red)

// Is a point inside the rounded-square card? (coords in pixels, size = icon size)
function inCard(x, y, size) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.5;                 // half-size (fills the icon)
  const corner = size * 0.22;
  const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
  if (dx > r || dy > r) return false;
  if (dx <= r - corner || dy <= r - corner) return true;
  return Math.hypot(dx - (r - corner), dy - (r - corner)) <= corner;
}

// Letter "I": top serif, bottom serif, vertical stem. Box-local coords (0..W, 0..H).
function inI(lx, ly, W, H, th) {
  if (lx < 0 || lx > W || ly < 0 || ly > H) return false;
  if (Math.abs(lx - W / 2) <= th / 2) return true;   // stem
  if (ly <= th) return true;                          // top serif
  if (ly >= H - th) return true;                      // bottom serif
  return false;
}

// Letter "D": left stem + top/bottom bars + right half-ellipse bowl (a ring of width th).
function inD(lx, ly, W, H, th) {
  if (lx < 0 || lx > W || ly < 0 || ly > H) return false;
  const ex = lx, ey = ly - H / 2;
  const split = W * 0.42;
  const outer = (ex <= split && Math.abs(ey) <= H / 2) ||
                (ex >= split && Math.pow((ex - split) / (W - split), 2) + Math.pow(ey / (H / 2), 2) <= 1);
  if (!outer) return false;
  const innSplit = split;
  const innW = W - split - th, innH = H / 2 - th;
  const inner = ex >= th && (
    (ex <= innSplit && Math.abs(ey) <= H / 2 - th) ||
    (ex >= innSplit && innW > 0 && innH > 0 && Math.pow((ex - innSplit) / innW, 2) + Math.pow(ey / innH, 2) <= 1)
  );
  return outer && !inner;
}

function makePNG(size) {
  const px = Buffer.alloc(size * size * 4);
  // Glyph layout
  const H = size * 0.48;
  const top = (size - H) / 2;
  const th = Math.max(1.4, size * 0.12);           // stroke thickness
  const wI = size * 0.14, wD = size * 0.26, gap = size * 0.08;
  const totalW = wI + gap + wD;
  const startX = (size - totalW) / 2;
  const iX = startX, dX = startX + wI + gap;

  const S = 4;                                      // supersampling grid
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let card = 0, letter = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const px2 = x + (sx + 0.5) / S, py2 = y + (sy + 0.5) / S;
        if (!inCard(px2, py2, size)) continue;
        card++;
        const ly = py2 - top;
        if (inI(px2 - iX, ly, wI, H, th) || inD(px2 - dX, ly, wD, H, th)) letter++;
      }
      const i = (y * size + x) * 4;
      const n = S * S;
      if (card === 0) { px[i] = px[i+1] = px[i+2] = px[i+3] = 0; continue; }
      const lc = letter / n;                         // letter coverage
      px[i]   = Math.round(RED[0] * (1 - lc) + 255 * lc);
      px[i+1] = Math.round(RED[1] * (1 - lc) + 255 * lc);
      px[i+2] = Math.round(RED[2] * (1 - lc) + 255 * lc);
      px[i+3] = Math.round((card / n) * 255);
    }
  }

  // Zlib-wrap raw scanlines (filter byte 0 per row).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), makePNG(size));
  console.log('wrote icon' + size + '.png');
}
