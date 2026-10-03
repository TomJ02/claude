// =============================================================================
//  generate-icons.js : dessine la tête de singe de l'icône (PNG + ICO) sans
//  aucune dépendance. Lancer avec : npm run icons
//
//  Produit dans assets/ :
//    icon.png       1024 px (icône de l'application / macOS)
//    icon.ico       16 → 256 px (exécutable et zone de notification Windows)
//    tray.png       18 px, tray@2x.png 36 px (zone de notification macOS / Linux)
// =============================================================================
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'assets');

const COL = {
  fur: [139, 90, 52],
  furDark: [106, 64, 36],
  skin: [242, 208, 164],
  ear: [233, 180, 143],
  eye: [27, 18, 12],
  white: [255, 255, 255],
  mouth: [91, 42, 27],
  blush: [255, 143, 156],
  outline: [42, 25, 16],
};

// --- Formes (fonctions de distance signée, repère [-1, 1], y vers le haut) ---
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ellipse = (cx, cy, rx, ry) => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const union =
  (...fs) =>
  (x, y) =>
    Math.min(...fs.map((f) => f(x, y)));
const grow = (f, t) => (x, y) => f(x, y) - t;
// Arc de sourire : anneau limité à sa partie basse
const smile = (cx, cy, r, t) => (x, y) => Math.max(Math.abs(Math.hypot(x - cx, y - cy) - r) - t, y - (cy - r * 0.35));

const S = 0.94; // marge
const head = circle(0, -0.02 * S, 0.66 * S);
const earL = circle(-0.7 * S, 0.04 * S, 0.27 * S);
const earR = circle(0.7 * S, 0.04 * S, 0.27 * S);
const tuft = ellipse(0, 0.68 * S, 0.08 * S, 0.14 * S);
const silhouette = union(head, earL, earR, tuft);

const layers = [
  [grow(silhouette, 0.06 * S), COL.outline],
  [tuft, COL.furDark],
  [earL, COL.fur],
  [earR, COL.fur],
  [circle(-0.7 * S, 0.04 * S, 0.16 * S), COL.ear],
  [circle(0.7 * S, 0.04 * S, 0.16 * S), COL.ear],
  [head, COL.fur],
  [
    union(
      circle(-0.23 * S, 0.06 * S, 0.29 * S),
      circle(0.23 * S, 0.06 * S, 0.29 * S),
      ellipse(0, -0.3 * S, 0.44 * S, 0.3 * S),
    ),
    COL.skin,
  ],
  [ellipse(-0.23 * S, 0.08 * S, 0.095 * S, 0.115 * S), COL.eye],
  [ellipse(0.23 * S, 0.08 * S, 0.095 * S, 0.115 * S), COL.eye],
  [circle(-0.19 * S, 0.13 * S, 0.035 * S), COL.white],
  [circle(0.27 * S, 0.13 * S, 0.035 * S), COL.white],
  [ellipse(-0.06 * S, -0.16 * S, 0.032 * S, 0.024 * S), COL.mouth],
  [ellipse(0.06 * S, -0.16 * S, 0.032 * S, 0.024 * S), COL.mouth],
  [smile(0, -0.2 * S, 0.15 * S, 0.026 * S), COL.mouth],
  [ellipse(-0.43 * S, -0.16 * S, 0.09 * S, 0.055 * S), COL.blush, 0.75],
  [ellipse(0.43 * S, -0.16 * S, 0.09 * S, 0.055 * S), COL.blush, 0.75],
];

function render(size) {
  const px = new Float32Array(size * size * 4); // RGBA prémultiplié
  const ss = size < 64 ? 4 : 2; // sur-échantillonnage
  const pixel = 2 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = ((i + (si + 0.5) / ss) / size) * 2 - 1;
          const y = 1 - ((j + (sj + 0.5) / ss) / size) * 2;
          let cr = 0,
            cg = 0,
            cb = 0,
            ca = 0;
          for (const [f, col, alpha = 1] of layers) {
            const cov = Math.min(1, Math.max(0, 0.5 - f(x, y) / (pixel / ss))) * alpha;
            if (cov <= 0) continue;
            cr = col[0] * cov + cr * (1 - cov);
            cg = col[1] * cov + cg * (1 - cov);
            cb = col[2] * cov + cb * (1 - cov);
            ca = cov + ca * (1 - cov);
          }
          r += cr;
          g += cg;
          b += cb;
          a += ca;
        }
      }
      const n = ss * ss;
      const o = (j * size + i) * 4;
      px[o] = r / n;
      px[o + 1] = g / n;
      px[o + 2] = b / n;
      px[o + 3] = a / n;
    }
  }
  // Dé-prémultiplication → octets RGBA
  const out = Buffer.alloc(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const a = px[k * 4 + 3];
    for (let c = 0; c < 3; c++) out[k * 4 + c] = a > 0 ? Math.round(Math.min(255, px[k * 4 + c] / a)) : 0;
    out[k * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

// --- Encodage PNG ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const rgba = render(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre "None"
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Encodage ICO (images PNG embarquées, supporté depuis Windows Vista) ---
function ico(sizes) {
  const images = sizes.map((s) => png(s));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header[e] = s >= 256 ? 0 : s;
    header[e + 1] = s >= 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4); // plans
    header.writeUInt16LE(32, e + 6); // bits par pixel
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.png'), png(1024));
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico([16, 20, 24, 32, 40, 48, 64, 128, 256]));
fs.writeFileSync(path.join(OUT, 'tray.png'), png(18));
fs.writeFileSync(path.join(OUT, 'tray@2x.png'), png(36));
console.log('Icônes générées dans', OUT);
