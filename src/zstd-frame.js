// zstd 帧扫描 + 解压（复用 DshPanel 里已验证的实现）
// DSH 会话日志是「每帧一个独立 zstd frame」的追加文件，标准解压器会因尾部半帧失败
const zlib = require('node:zlib')

const ZSTD_MAGIC = 4247762216

function scanZstdFrames(buffer, maxFrames) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornStart: start, badMagic: offset }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset); offset += 1
    if ((descriptor & 24) !== 0) return { frames, tornStart: start, badHeader: true }
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
      if (blockType === 3) return { frames, tornStart: start, badBlock: true }
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

// 从文件尾部读取并解压出文本行（处理半帧、坏帧）
function readTailLines(filePath, tailBytes) {
  const fs = require('node:fs')
  const size = fs.statSync(filePath).size
  const start = Math.max(0, size - (tailBytes || 512 * 1024))
  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.alloc(size - start)
  try { fs.readSync(fd, buf, 0, buf.length, start) } finally { fs.closeSync(fd) }

  // 从尾部切片里第一个 magic 开始扫，保证帧对齐
  let begin = 0
  while (begin + 4 <= buf.length && buf.readUInt32LE(begin) !== ZSTD_MAGIC) begin += 1

  const { frames } = scanZstdFrames(buf.subarray(begin))
  const parts = []
  for (const f of frames) {
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(begin + f.start, begin + f.end))) } catch (_) { /* 半帧跳过 */ }
  }
  return {
    text: Buffer.concat(parts).toString('utf8'),
    frames: frames.length,
    truncated: start > 0,
  }
}

module.exports = { scanZstdFrames, readTailLines, ZSTD_MAGIC }
