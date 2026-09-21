// 下载 Live2D Cubism Core（Live2D 公司的 SDK，本项目不随仓库分发，需自行下载）
// 用法: node _tools/fetch_core.js
const fs = require('node:fs')
const path = require('node:path')

const URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
const OUT = path.resolve(__dirname, '..', 'vendor', 'live2dcubismcore.min.js')

;(async () => {
  if (fs.existsSync(OUT) && fs.statSync(OUT).size > 1000) {
    console.log('已存在，跳过：' + OUT)
    return
  }
  try {
    const res = await fetch(URL)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, buf)
    console.log('已下载 ' + Math.round(buf.length / 1024) + 'KB -> ' + OUT)
    console.log('提示：使用 Cubism Core 需遵守 Live2D 的 SDK 许可条款。')
  } catch (e) {
    console.error('下载失败：' + e.message)
    console.error('可手动下载 ' + URL + ' 放到 vendor/live2dcubismcore.min.js')
    process.exitCode = 1
  }
})()
