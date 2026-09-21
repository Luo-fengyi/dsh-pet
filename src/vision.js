// 调用视觉/对话模型：DeepSeek（Anthropic 兼容格式）或任意 OpenAI 兼容接口
const fs = require('node:fs')
const path = require('node:path')

const PRESETS = {
  deepseek: {
    kind: 'anthropic',
    endpoint: 'https://api.deepseek.com/anthropic/v1/messages',
    model: 'deepseek-flash',
    label: 'DeepSeek 官方（推荐）',
  },
  openai: {
    kind: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    label: 'OpenAI',
  },
  zhipu: {
    kind: 'openai',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4v-flash',
    label: '智谱 GLM-4V',
  },
  dashscope: {
    kind: 'openai',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-vl-plus',
    label: '通义千问 qwen-vl',
  },
  custom: {
    kind: 'openai',
    endpoint: '',
    model: '',
    label: '自定义（OpenAI 兼容）',
  },
}

// 没填 key 时，尝试复用 DSH 凭据（只有 DeepSeek 用得上）
function keyFromDsh() {
  const home = process.env.DSH_HOME || path.join(require('node:os').homedir(), '.dsh')
  const file = path.join(home, '.credentials.yaml')
  try {
    const text = fs.readFileSync(file, 'utf8')
    const m = text.match(/DEEPSEEK_API_KEY\s*:\s*["']?(sk-[A-Za-z0-9_\-]+)/)
    if (m) return m[1]
  } catch (_) {}
  return process.env.DEEPSEEK_API_KEY || null
}

function resolveApi(visionCfg) {
  const preset = PRESETS[visionCfg.preset] || PRESETS.deepseek
  const kind = visionCfg.format || preset.kind
  const endpoint = (visionCfg.endpoint || preset.endpoint || '').trim()
  const model = (visionCfg.model || preset.model || '').trim()
  let key = (visionCfg.apiKey || '').trim()
  if (!key && (visionCfg.preset === 'deepseek' || preset.kind === 'anthropic')) key = keyFromDsh() || ''
  return { kind, endpoint, model, key, preset: visionCfg.preset || 'deepseek' }
}

// thinking: 'off' | 'low' | 'default'
function thinkingField(level) {
  if (level === 'off') return { type: 'disabled' }
  if (level === 'low') return { type: 'enabled', budget_tokens: 1024 }
  return undefined
}

function buildAnthropicBody(api, opts) {
  const content = []
  if (opts.image && opts.image.base64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: opts.image.mediaType || 'image/jpeg', data: opts.image.base64 },
    })
  }
  content.push({ type: 'text', text: opts.userText || '看看我的屏幕' })
  const messages = (opts.history || []).concat([{ role: 'user', content }])
  const body = { model: api.model, max_tokens: opts.maxTokens || 500, messages }
  if (opts.system) body.system = opts.system
  const t = thinkingField(opts.thinking)
  if (t && api.kind === 'anthropic') body.thinking = t
  return body
}

function buildOpenAiBody(api, opts) {
  const content = []
  const text = opts.userText || '看看我的屏幕'
  content.push({ type: 'text', text })
  if (opts.image && opts.image.base64) {
    content.push({
      type: 'image_url',
      image_url: { url: 'data:' + (opts.image.mediaType || 'image/jpeg') + ';base64,' + opts.image.base64 },
    })
  }
  const messages = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  for (const m of (opts.history || [])) messages.push(m)
  messages.push({ role: 'user', content })
  const body = { model: api.model, messages, max_tokens: opts.maxTokens || 500 }
  if (opts.thinking === 'off') body.enable_thinking = false   // 部分国内模型认这个
  return body
}

function parseAnthropic(json) {
  const parts = []
  for (const c of (json.content || [])) {
    if (c.type === 'text' && c.text) parts.push(c.text)
  }
  return parts.join('\n').trim()
}

function parseOpenAi(json) {
  const choice = json.choices && json.choices[0]
  if (!choice) return ''
  const msg = choice.message || {}
  if (typeof msg.content === 'string') return msg.content.trim()
  if (Array.isArray(msg.content)) {
    return msg.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim()
  }
  return ''
}

// 主入口：返回 { ok, text, usage, error }
async function ask(visionCfg, opts) {
  const api = resolveApi(visionCfg)
  if (!api.endpoint) return { ok: false, error: '没填 API 地址（endpoint）' }
  if (!api.model) return { ok: false, error: '没填模型名' }
  if (!api.key) return { ok: false, error: '没填 API key' }

  const isAnthropic = api.kind === 'anthropic'
  const body = isAnthropic ? buildAnthropicBody(api, opts) : buildOpenAiBody(api, opts)
  const headers = isAnthropic
    ? { 'content-type': 'application/json', 'x-api-key': api.key, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: 'Bearer ' + api.key }

  const started = Date.now()
  try {
    const res = await fetch(api.endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch (_) {}
    if (!res.ok) {
      const detail = json && json.error ? (json.error.message || JSON.stringify(json.error)) : text.slice(0, 300)
      return { ok: false, error: 'HTTP ' + res.status + '：' + detail, ms: Date.now() - started }
    }
    if (!json) return { ok: false, error: '返回不是 JSON：' + text.slice(0, 200), ms: Date.now() - started }
    const reply = isAnthropic ? parseAnthropic(json) : parseOpenAi(json)
    if (!reply) return { ok: false, error: '模型没返回文字内容', raw: json, ms: Date.now() - started }
    return { ok: true, text: reply, usage: json.usage || null, ms: Date.now() - started, model: api.model }
  } catch (e) {
    const cause = e && e.cause ? ' / ' + e.cause.message : ''
    return { ok: false, error: e.message + cause, ms: Date.now() - started }
  }
}

module.exports = { ask, PRESETS, resolveApi, keyFromDsh }
