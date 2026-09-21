// 验证 DeepSeek（Anthropic 兼容端点）能不能看图
// 用法: node _tools/test_vision.js [图片路径] [模型名]
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CORE = path.resolve(__dirname, '..')
const CRED = process.env.DSH_CREDENTIALS ||
  path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.credentials.yaml')
const IMG = process.argv[2] || path.join(CORE, '..', 'DS', 'icon.png')
const MODEL = process.argv[3] || 'deepseek-flash'
const URL = 'https://api.deepseek.com/anthropic/v1/messages'

function findKey() {
  const yaml = fs.readFileSync(CRED, 'utf8')
  const m = yaml.match(/DEEPSEEK_API_KEY\s*:\s*["']?([^\s"']+)/)
  if (m) return m[1]
  const m2 = yaml.match(/(sk-[A-Za-z0-9_\-]{10,})/)
  if (m2) return m2[1]
  console.log('未从凭据文件里找到 key，结构如下：')
  console.log(yaml.replace(/sk-[A-Za-z0-9_\-]+/g, 'sk-****'))
  return null
}

async function tryOnce(name, headers, body) {
  try {
    const res = await fetch(URL, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await res.text()
    console.log('[' + name + '] HTTP ' + res.status)
    console.log('[' + name + '] ' + text.replace(/\s+/g, ' ').slice(0, 700))
    return res.ok
  } catch (e) {
    console.log('[' + name + '] ERR ' + e.message + (e.cause ? ' / ' + e.cause.message : ''))
    return false
  }
}

;(async () => {
  const key = findKey()
  if (!key) process.exit(1)
  console.log('key 前缀=' + key.slice(0, 6) + '****  长度=' + key.length)
  console.log('图片=' + IMG + ' 模型=' + MODEL)
  const b64 = fs.readFileSync(IMG).toString('base64')
  console.log('base64 长度=' + b64.length)
  const body = {
    model: MODEL,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
        { type: 'text', text: '这张图里是什么？用一句中文回答。' },
      ],
    }],
  }
  const base = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }
  if (await tryOnce('x-api-key', Object.assign({ 'x-api-key': key }, base), body)) return
  if (await tryOnce('bearer', Object.assign({ authorization: 'Bearer ' + key }, base), body)) return
  await tryOnce('x-api-key+beta', Object.assign({ 'x-api-key': key, 'anthropic-beta': 'vision-2024-01-01' }, base), body)
})()
