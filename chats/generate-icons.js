// Generate the Bibix Chat AI icon (teal rounded square, white "A" with a speech-bubble tail)
// as PNGs with no external deps. Run: node generate-icons.js → icon-192.png, icon-512.png (PWA icons)
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
function crc32(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } let crc = 0xffffffff; for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const tb = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0); return Buffer.concat([len, tb, data, crc]); }
const TEAL = [15, 157, 138];
function inCard(x, y, s) { const c = s / 2, r = s / 2, k = s * 0.22; const dx = Math.abs(x - c), dy = Math.abs(y - c); if (dx > r || dy > r) return false; if (dx <= r - k || dy <= r - k) return true; return Math.hypot(dx - (r - k), dy - (r - k)) <= k; }
// Letter "A": two slanted strokes + crossbar, in a box.
function inA(x, y, s) {
  const bx = s * 0.22, by = s * 0.2, W = s * 0.56, H = s * 0.58, th = Math.max(1.2, s * 0.11);
  const lx = x - bx, ly = y - by; if (lx < 0 || lx > W || ly < 0 || ly > H) return false;
  const half = W / 2; const t = ly / H; // 0 top → 1 bottom
  const leftEdge = half - t * half, rightEdge = half + t * half;
  if (Math.abs(lx - leftEdge) <= th / 2 || Math.abs(lx - rightEdge) <= th / 2) return true;
  if (ly >= H * 0.62 && ly <= H * 0.62 + th * 0.8 && lx > leftEdge && lx < rightEdge) return true;
  return false;
}
function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size); const ss = 4;
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) {
    let a = 0, w = 0;
    for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) { const px = x + (i + .5) / ss, py = y + (j + .5) / ss; if (inCard(px, py, size)) { a++; if (inA(px, py, size)) w++; } }
    const cov = a / (ss * ss), wf = a ? w / a : 0; const o = y * (size * 4 + 1) + 1 + x * 4;
    raw[o] = Math.round(TEAL[0] + (255 - TEAL[0]) * wf); raw[o + 1] = Math.round(TEAL[1] + (255 - TEAL[1]) * wf); raw[o + 2] = Math.round(TEAL[2] + (255 - TEAL[2]) * wf); raw[o + 3] = Math.round(255 * cov);
  } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [192, 512]) fs.writeFileSync(path.join(__dirname, `icon-${s}.png`), render(s));
console.log('icons written');
