#!/usr/bin/env node
'use strict'
/**
 * One-off generator (run from the repo root, output committed):
 *   node desktop/build/gen-icons.js
 * Produces the shell's placeholder icon set with zero image dependencies:
 *   desktop/build/icons/512x512.png  desktop/build/icons/tray.png
 *   desktop/build/icons/icon.icns    (ic07/ic08/ic09 PNG entries)
 * Rerun any time to regenerate.
 */

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Rounded-square app icon with a white pi glyph. */
function drawIcon(size, { squareColor, glyphColor, glyph }) {
  const rgba = Buffer.alloc(size * size * 4)
  const r = size * 0.22 // corner radius
  const set = (x, y, [cr, cg, cb, ca]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    const sa = ca / 255
    const da = rgba[i + 3] / 255
    const outA = sa + da * (1 - sa)
    if (outA <= 0) return
    for (let c = 0; c < 3; c++) {
      rgba[i + c] = Math.round(
        (rgba[i + c] * da * (1 - sa) + [cr, cg, cb][c] * sa) / outA
      )
    }
    rgba[i + 3] = Math.round(outA * 255)
  }
  const inRoundedSquare = (x, y) => {
    const min = size * 0.06
    const max = size * 0.94
    if (x < min || y < min || x > max || y > max) return false
    const dx = x < min + r ? min + r - x : x > max - r ? x - (max - r) : 0
    const dy = y < min + r ? min + r - y : y > max - r ? y - (max - r) : 0
    return dx * dx + dy * dy <= r * r
  }
  const sq = hex(squareColor)
  const gl = hex(glyphColor)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundedSquare(x, y)) continue
      let isGlyph = false
      if (glyph) {
        // pi glyph: horizontal bar + two legs
        const barTop = size * 0.28
        const barBottom = size * 0.35
        const barLeft = size * 0.24
        const barRight = size * 0.76
        const legLeft = [size * 0.38, size * 0.62]
        const legWidth = size * 0.08
        const legBottom = size * 0.78
        if (y >= barTop && y <= barBottom && x >= barLeft && x <= barRight) isGlyph = true
        for (const lx of legLeft) {
          if (x >= lx && x <= lx + legWidth && y >= barTop && y <= legBottom) isGlyph = true
        }
      }
      set(x, y, isGlyph ? gl : sq)
    }
  }
  return rgba
}

function hex(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
    parseInt(h.slice(7, 9) || 'ff', 16)
  ]
}

function makeICNS(entries) {
  // entries: [[type, pngBuffer], ...]
  const parts = []
  for (const [type, png] of entries) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(png.length + 8)
    parts.push(Buffer.from(type, 'ascii'), len, png)
  }
  const body = Buffer.concat(parts)
  const total = Buffer.alloc(4)
  total.writeUInt32BE(body.length + 8)
  return Buffer.concat([Buffer.from('icns', 'ascii'), total, body])
}

function main() {
  const outDir = path.join(__dirname, 'icons')
  fs.mkdirSync(outDir, { recursive: true })

  const blue = '#4f8cffee'
  const white = '#ffffffee'

  const png512 = encodePNG(512, 512, drawIcon(512, { squareColor: blue, glyphColor: white, glyph: true }))
  fs.writeFileSync(path.join(outDir, '512x512.png'), png512)

  const png256 = encodePNG(256, 256, drawIcon(256, { squareColor: blue, glyphColor: white, glyph: true }))
  const png128 = encodePNG(128, 128, drawIcon(128, { squareColor: blue, glyphColor: white, glyph: true }))
  const icns = makeICNS([['ic09', png512], ['ic08', png256], ['ic07', png128]])
  fs.writeFileSync(path.join(outDir, 'icon.icns'), icns)

  // Tray icon: simple, readable at 16-24px — solid rounded square, no glyph.
  const tray = encodePNG(32, 32, drawIcon(32, { squareColor: '#c9d4e8ff', glyphColor: white, glyph: false }))
  fs.writeFileSync(path.join(outDir, 'tray.png'), tray)

  console.log('icons written to', outDir)
}

main()
