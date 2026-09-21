// 取当前前台窗口的标题/进程名（Windows 只能用 P/Invoke，所以借一次 PowerShell）
// 结果缓存，避免频繁起进程
const { execFile } = require('node:child_process')
const path = require('node:path')

const SCRIPT = path.join(__dirname, '..', '_tools', 'foreground.ps1')
const CACHE_MS = 5000
let cache = { at: 0, value: null }
let pending = null

function parse(stdout) {
  const out = { title: '', proc: '' }
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (line.startsWith('TITLE=')) out.title = line.slice(6).trim()
    else if (line.startsWith('PROC=')) out.proc = line.slice(5).trim()
  }
  return out
}

function getForeground() {
  const now = Date.now()
  if (cache.value && now - cache.at < CACHE_MS) return Promise.resolve(cache.value)
  if (pending) return pending
  pending = new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        pending = null
        if (err && !stdout) { resolve(cache.value || { title: '', proc: '', error: err.message }) ; return }
        const value = parse(stdout)
        cache = { at: Date.now(), value }
        resolve(value)
      }
    )
  })
  return pending
}

module.exports = { getForeground }
