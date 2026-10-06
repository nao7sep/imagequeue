#!/usr/bin/env node
// Seeds a sample session into an ImageQueue data folder, for looking at the
// preview, the preview window and the fullscreen view without generating
// anything: completed images in two columns, a kept one, a failed task with a
// provider's reason, and a completed task whose image file is missing. Point it
// at a throwaway folder and run the app with IMAGEQUEUE_DATA_DIR set to it:
//
//   node scripts/seed-sample-session.mjs /tmp/iq-sample
//   IMAGEQUEUE_DATA_DIR=/tmp/iq-sample npm run dev
//
// then resume the "sample" session from Sessions. It refuses a folder that
// already holds an ImageQueue config, so it cannot write into real data.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.argv[2]
if (!root) {
  console.error('Usage: node scripts/seed-sample-session.mjs <data folder>')
  process.exit(1)
}
const dataDir = path.resolve(root)
if (fs.existsSync(path.join(dataDir, 'config.json'))) {
  console.error(`${dataDir} already holds an ImageQueue config; seed a throwaway folder instead.`)
  process.exit(1)
}

// A solid-colour PNG with a lighter band across its middle, so one image is
// told from the next at a glance.
function png(width, height, [r, g, b]) {
  const band = [Math.min(255, r + 90), Math.min(255, g + 90), Math.min(255, b + 90)]
  const rows = []
  for (let y = 0; y < height; y++) {
    const inBand = y > height * 0.45 && y < height * 0.55
    const [cr, cg, cb] = inBand ? band : [r, g, b]
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) row.set([cr, cg, cb], 1 + x * 3)
    rows.push(row)
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const sessionId = 'sample'
const sessionDir = path.join(dataDir, 'output', sessionId)
fs.mkdirSync(sessionDir, { recursive: true })

const now = new Date()
const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()
let counter = 0

function task(backend, status, { color, size = [1024, 1024], prompt, error = null, providerMessage = null, missing = false } = {}) {
  counter++
  const id = `sample-${counter}`
  const baseName = color || missing ? `sample-${String(counter).padStart(2, '0')}` : null
  const imagePath = baseName ? path.join(sessionDir, `${baseName}.png`) : null
  if (color) fs.writeFileSync(imagePath, png(size[0], size[1], color))
  return {
    id,
    prompt: prompt ?? `Sample image ${counter}`,
    backend,
    model: backend === 'openai' ? 'gpt-image-2' : 'gemini-3-pro-image',
    params: { width: size[0], height: size[1], outputFormat: 'png' },
    status,
    enqueuedAt: at(60 - counter),
    startedAt: at(59 - counter),
    completedAt: status === 'failed' || status === 'completed' || status === 'kept' ? at(58 - counter) : null,
    durationMs: 4200,
    imagePath,
    baseName,
    error,
    providerMessage,
  }
}

const tasks = {
  openai: [
    task('openai', 'completed', { color: [180, 40, 40], prompt: 'Red, square' }),
    task('openai', 'completed', { color: [40, 120, 200], size: [1536, 1024], prompt: 'Blue, landscape' }),
    task('openai', 'completed', { color: [40, 160, 80], size: [1024, 1536], prompt: 'Green, portrait' }),
    task('openai', 'completed', { missing: true, prompt: 'Completed, but its image file is missing' }),
    task('openai', 'kept', { color: [120, 60, 160], prompt: 'Purple, kept' }),
  ],
  nanobanana: [
    task('nanobanana', 'completed', { color: [220, 150, 30], prompt: 'Orange, square' }),
    task('nanobanana', 'failed', {
      prompt: 'Refused by the provider',
      error: { key: 'taskFailure.refusedWithReason', values: { name: 'Nano Banana', reason: 'SAFETY' } },
      providerMessage: 'The request was blocked by the safety filter.',
    }),
    task('nanobanana', 'completed', { color: [30, 150, 150], size: [1536, 1024], prompt: 'Teal, landscape' }),
  ],
  grok: [],
  flux: [],
  drawthings: [],
}

const count = (status) => Object.values(tasks).flat().filter((t) => t.status === status).length
const manifest = {
  formatVersion: 1,
  sessionId,
  createdAt: at(60),
  updatedAt: at(1),
  lastResumedAt: null,
  taskCounts: {
    total: Object.values(tasks).flat().length,
    queued: 0,
    generating: 0,
    completed: count('completed'),
    kept: count('kept'),
    failed: count('failed'),
    interrupted: 0,
  },
  elaboratedPrompts: [],
  draft: {},
  tasks,
}
fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(manifest, null, 2))
console.log(`Seeded ${Object.values(tasks).flat().length} tasks into ${sessionDir}`)
