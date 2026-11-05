// Minimal, dependency-free ZIP writer (STORE method — no compression).
// We can't add an npm dependency because the production deploy is a plain
// `git reset --hard` with no `npm install`, so this builds a valid .zip from a
// directory using only Node's stdlib. Chrome's "Load unpacked" needs the files
// unzipped anyway, so skipping compression costs nothing meaningful here.

const fs = require('fs');
const path = require('path');

// ── CRC-32 (IEEE 802.3, same polynomial ZIP uses) ──────────────────────────
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(buf) {
  const t = crcTable();
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ t[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

// Recursively collect files as { name, data } with forward-slash paths.
function collect(absDir, prefix, out) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    // Skip VCS / junk that has no business in a shipped extension.
    if (entry.name === '.git' || entry.name === '.DS_Store' || entry.name === 'node_modules') continue;
    const abs = path.join(absDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collect(abs, rel, out);
    else if (entry.isFile()) out.push({ name: rel, data: fs.readFileSync(abs) });
  }
  return out;
}

/**
 * Build a ZIP (Buffer) of everything under `absDir`.
 * @param {string} absDir       directory to zip
 * @param {string} [rootName]   optional top-level folder inside the zip
 */
function zipDir(absDir, rootName) {
  const files = collect(absDir, rootName || '', []);
  // Fixed DOS date/time (1980-01-01 00:00) — deterministic, and non-zero date
  // keeps a few picky unzippers happy.
  const DOS_TIME = 0;
  const DOS_DATE = 0x0021;

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // method 0 = store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);        // compressed size (== size)
    local.writeUInt32LE(size, 22);        // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra len
    localChunks.push(local, nameBuf, f.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(0, 10);         // method
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra len
    central.writeUInt16LE(0, 32);         // comment len
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + f.data.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central dir signature
  end.writeUInt16LE(0, 4);                // disk number
  end.writeUInt16LE(0, 6);                // central dir start disk
  end.writeUInt16LE(files.length, 8);     // entries this disk
  end.writeUInt16LE(files.length, 10);    // total entries
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);          // central dir offset
  end.writeUInt16LE(0, 20);               // comment len

  return Buffer.concat([...localChunks, centralDir, end]);
}

module.exports = { zipDir, crc32 };
