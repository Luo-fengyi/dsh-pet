// 补下载 Electron 运行时（npm install 时脚本被禁/网络不通时用）
// 用法: node _tools/fetch_electron.js
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const raw = (pkg.devDependencies && pkg.devDependencies.electron) || (pkg.dependencies && pkg.dependencies.electron) || '43.3.0'
const version = String(raw).replace(/^[^\d]*/, '')
const platform = process.arch === 'arm64' ? 'win32-arm64' : 'win32-x64'

const electronDir = path.join(ROOT, 'node_modules', 'electron')
const distDir = path.join(electronDir, 'dist')
const exePath = path.join(distDir, process.platform === 'win32' ? 'electron.exe' : 'electron')

if (fs.existsSync(exePath)) {
  console.log('Electron 运行时已存在，无需下载：' + exePath)
  process.exit(0)
}

const url = `https://registry.npmmirror.com/-/binary/electron/${version}/electron-v${version}-${platform}.zip`
const tmpZip = path.join(os.tmpdir(), `electron-v${version}-${platform}.zip`)
const tmpDir = path.join(os.tmpdir(), `electron-v${version}-${platform}`)

console.log('版本 ' + version + '（' + platform + '）')
console.log('下载 ' + url)

async function download() {
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(tmpZip, buf)
  console.log('已下载 ' + Math.round(buf.length / 1024 / 1024) + 'MB')
}

function unzip() {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log('解压…')
  execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${tmpDir}' -Force`,
  ], { stdio: 'inherit' })
  fs.mkdirSync(distDir, { recursive: true })
  // 有些包内带一层目录，有些直接是文件
  const entries = fs.readdirSync(tmpDir)
  const inner = entries.length === 1 && fs.statSync(path.join(tmpDir, entries[0])).isDirectory()
    ? path.join(tmpDir, entries[0])
    : tmpDir
  for (const f of fs.readdirSync(inner)) {
    fs.cpSync(path.join(inner, f), path.join(distDir, f), { recursive: true })
  }
  fs.writeFileSync(path.join(electronDir, 'path.txt'), process.platform === 'win32' ? 'electron.exe' : 'electron')
  console.log('完成 -> ' + distDir)
}

;(async () => {
  try {
    await download()
    unzip()
    console.log('现在可以双击 启动桌宠.vbs 了')
  } catch (e) {
    console.error('失败：' + e.message)
    console.error('可手动下载 ' + url + '，把里面内容解压到 node_modules/electron/dist')
    process.exitCode = 1
  }
})()
