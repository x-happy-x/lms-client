// Regenerates icons/icon{16,32,48,128}.png (blue rounded square with a download arrow).
// No dependencies: rasterizes with 4x4 supersampling and writes PNG via zlib.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [37, 99, 235]
const FG = [255, 255, 255]

function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// Shape tests in unit coordinates (0..1).
function inRoundedSquare(x, y) {
  const r = 0.22
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function inArrow(x, y) {
  const stem = x >= 0.43 && x <= 0.57 && y >= 0.18 && y <= 0.52
  const head = y >= 0.44 && y <= 0.68 && Math.abs(x - 0.5) <= (0.68 - y) * 1.05
  const tray = y >= 0.74 && y <= 0.84 && x >= 0.24 && x <= 0.76
  return stem || head || tray
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const ss = 4
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0
    for (let px = 0; px < size; px++) {
      let bg = 0
      let fg = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size
          const y = (py + (sy + 0.5) / ss) / size
          if (!inRoundedSquare(x, y)) continue
          if (inArrow(x, y)) fg++
          else bg++
        }
      }
      const total = ss * ss
      const alpha = (bg + fg) / total
      const mix = bg + fg ? fg / (bg + fg) : 0
      const offset = py * (size * 4 + 1) + 1 + px * 4
      for (let i = 0; i < 3; i++) raw[offset + i] = Math.round(BG[i] * (1 - mix) + FG[i] * mix)
      raw[offset + 3] = Math.round(alpha * 255)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), png(size))
}
