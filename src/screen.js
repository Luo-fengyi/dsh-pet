// 桌面截屏 + 缩放 + JPEG 压缩 + 画面变化比对（主进程用）
const { desktopCapturer, screen } = require('electron')
const crypto = require('node:crypto')

// 截主屏，缩到 maxWidth 宽，转 JPEG。返回 { jpeg, base64, width, height, bytes, hash, fingerprint }
async function grabScreen(maxWidth) {
  const targetW = Math.max(480, Math.min(1920, Math.round(maxWidth || 1280)))
  const primary = screen.getPrimaryDisplay()
  // 按主屏真实宽高比请求缩略图，否则 desktopCapturer 会按 16:9 裁掉两边
  const size = primary.size || { width: 16, height: 10 }
  const ratio = size.height / size.width
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetW, height: Math.max(1, Math.round(targetW * ratio)) },
    fetchWindowIcons: false,
  })
  if (!sources || !sources.length) return null

  const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0]
  let image = src.thumbnail
  if (!image || image.isEmpty()) return null

  const shotSize = image.getSize()
  if (shotSize.width > targetW) image = image.resize({ width: targetW, quality: 'good' })

  const jpeg = image.toJPEG(72)
  const finalSize = image.getSize()
  return {
    jpeg,
    base64: jpeg.toString('base64'),
    width: finalSize.width,
    height: finalSize.height,
    bytes: jpeg.length,
    hash: crypto.createHash('sha1').update(jpeg).digest('hex'),
    fingerprint: fingerprint(image),
  }
}

// 缩到 32x18 灰度做「画面变化」判断，避免整图比对太慢
function fingerprint(image) {
  try {
    const small = image.resize({ width: 32, height: 18, quality: 'good' })
    const bmp = small.toBitmap() // BGRA
    const out = []
    for (let i = 0; i + 3 < bmp.length; i += 4) {
      out.push((bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3)
    }
    return out
  } catch (_) {
    return null
  }
}

// 0~1 的平均像素差
function diffScore(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 1
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length / 255
}

// 存 PNG 便于调试查看（可选）
function toPNG(image) {
  try { return image.toPNG() } catch (_) { return null }
}

module.exports = { grabScreen, diffScore, fingerprint, toPNG }
