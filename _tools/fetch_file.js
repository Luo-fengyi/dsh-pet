// 用法: node fetch_file.js <url> <输出文件路径>
const fs = require('fs')
const path = require('path')

const [url, out] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: node fetch_file.js <url> <outPath>')
  process.exit(2)
}

;(async () => {
  const info = out + '.info.txt'
  try {
    const res = await fetch(url, { redirect: 'follow' })
    const buf = Buffer.from(await res.arrayBuffer())
    if (!res.ok) throw new Error('HTTP ' + res.status)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, buf)
    fs.writeFileSync(info, 'OK ' + res.status + ' ' + buf.length + ' bytes\n' + url + '\n')
  } catch (e) {
    fs.mkdirSync(path.dirname(info), { recursive: true })
    fs.writeFileSync(info, 'FAIL ' + (e && e.message) + '\n' + url + '\n')
    process.exitCode = 1
  }
})()
