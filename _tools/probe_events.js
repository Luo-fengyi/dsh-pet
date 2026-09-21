// 只读探测：解压 session.jsonl.zstd，统计事件种类，输出最近事件摘要
// 用法: node probe_events.js <session.jsonl.zstd> <outFile.txt>
const fs = require('fs')
const z = require('node:zlib')

const ZSTD_MAGIC = 4247762216

function scanZstdFrames(buffer, maxFrames) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('invalid frame magic at byte ' + offset)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset); offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3); offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) { if (buffer.length - offset < 4) return { frames, tornStart: start }; offset += 4 }
    frames.push({ start, end: offset })
    if (maxFrames && frames.length === maxFrames) return { frames }
  }
  return { frames }
}

const src = process.argv[2]
const out = process.argv[3]
const raw = fs.readFileSync(src)
const { frames } = scanZstdFrames(raw)
const outs = []
for (const f of frames) {
  try { outs.push(z.zstdDecompressSync(Buffer.from(raw.subarray(f.start, f.end)))) } catch (_) {}
}
const text = Buffer.concat(outs).toString('utf8')
const lines = text.split('\n').filter((l) => l.trim())
const counts = {}
const samples = {}
const tail = []
for (const line of lines) {
  let obj
  try { obj = JSON.parse(line) } catch (_) { counts['<bad-json>'] = (counts['<bad-json>'] || 0) + 1; continue }
  const key = obj.kind || obj.type || '<no-kind>'
  counts[key] = (counts[key] || 0) + 1
  if (!samples[key]) samples[key] = JSON.stringify(obj).slice(0, 400)
  tail.push({ key, obj })
}
const outLines = []
outLines.push('frames=' + frames.length + ' lines=' + lines.length)
outLines.push('--- counts ---')
for (const k of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) outLines.push(k + ' = ' + counts[k])
outLines.push('--- samples ---')
for (const k of Object.keys(samples)) outLines.push('[' + k + '] ' + samples[k])
outLines.push('--- last 12 events (key + keys of payload) ---')
for (const t of tail.slice(-12)) {
  const o = t.obj
  outLines.push(t.key + ' :: ' + JSON.stringify(Object.keys(o)) + ' :: ' + JSON.stringify(o).slice(0, 300))
}
fs.writeFileSync(out, outLines.join('\n'), 'utf8')
