// Generates build/icon.ico (multi-size) and build/icon.png: a blue rounded square with three white script lines.
// Pure Node, no dependencies. Original artwork.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });

const BLUE_TOP = [0x3b, 0x82, 0xf6];
const BLUE_BOTTOM = [0x25, 0x63, 0xeb]; // #2563EB
const SS = 4; // supersampling per axis

// Signed distance to a rounded rect centred at (cx,cy) with half sizes (hx,hy) and radius r.
function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Three script lines (normalised coordinates).
const LINES = [
  { x0: 0.25, x1: 0.75, y: 0.34 },
  { x0: 0.25, x1: 0.62, y: 0.5 },
  { x0: 0.25, x1: 0.69, y: 0.66 }
];
const THICK = 0.085;

function render(size) {
  const px = Buffer.alloc(size * size * 4); // RGBA, top-down
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (sdRoundRect(u, v, 0.5, 0.5, 0.465, 0.465, 0.22) > 0) continue;
          let col = [0, 0, 0].map((_, i) => BLUE_TOP[i] + (BLUE_BOTTOM[i] - BLUE_TOP[i]) * v);
          for (const l of LINES) {
            const cx = (l.x0 + l.x1) / 2;
            const hx = (l.x1 - l.x0) / 2 + THICK / 2;
            if (sdRoundRect(u, v, cx, l.y, hx, THICK / 2, THICK / 2) <= 0) col = [255, 255, 255];
          }
          r += col[0]; g += col[1]; b += col[2]; a += 1;
        }
      }
      const i = (y * size + x) * 4;
      const n = Math.max(a, 1);
      px[i] = Math.round(r / n); px[i + 1] = Math.round(g / n); px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return px;
}

// --- PNG encoder
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- ICO: classic 32-bit DIB entries for small sizes, PNG for 256.
function encodeDib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(size, 4); header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4; // bottom-up
      const d = (y * size + x) * 4;
      pixels[d] = rgba[s + 2]; pixels[d + 1] = rgba[s + 1]; pixels[d + 2] = rgba[s]; pixels[d + 3] = rgba[s + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map((size) => {
  const rgba = render(size);
  return { size, data: size === 256 ? encodePng(size, rgba) : encodeDib(size, rgba), rgba };
});

const dir = Buffer.alloc(6 + 16 * images.length);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
let offset = dir.length;
images.forEach((img, i) => {
  const o = 6 + i * 16;
  dir[o] = img.size === 256 ? 0 : img.size; dir[o + 1] = img.size === 256 ? 0 : img.size;
  dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(img.data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
  offset += img.data.length;
});
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([dir, ...images.map((i) => i.data)]));
fs.writeFileSync(path.join(outDir, 'icon.png'), encodePng(256, images[images.length - 1].rgba));

// Also copy icon.png and compile dwmHelper.exe if on Windows
const winDir = path.join(root, 'src', 'main', 'windows');
fs.mkdirSync(winDir, { recursive: true });
fs.copyFileSync(path.join(outDir, 'icon.png'), path.join(winDir, 'logo.png'));

if (process.platform === 'win32') {
  const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const csFile = path.join(outDir, 'dwmHelper.cs');
  const exeOut = path.join(winDir, 'dwmHelper.exe');
  if (fs.existsSync(csc) && fs.existsSync(csFile)) {
    spawnSync(csc, ['/nologo', '/target:winexe', `/out:${exeOut}`, '/r:System.Drawing.dll', csFile], { stdio: 'ignore' });
  }
}

console.log(`icon: wrote build/icon.ico (${SIZES.join(', ')}) and build/icon.png`);
