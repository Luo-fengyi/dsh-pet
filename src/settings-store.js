// config.json（可编辑配置，深合并写回）与 secrets.json（API key，独立存放）的读写
const fs = require('node:fs')
const path = require('node:path')

function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base
  if (Array.isArray(patch) || typeof patch !== 'object') return patch
  const out = Object.assign({}, base)
  for (const k of Object.keys(patch)) {
    const v = patch[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(base ? base[k] : undefined, v)
    else out[k] = v
  }
  return out
}

function configPath(root) { return path.join(root, 'config.json') }
function secretsPath(root) { return path.join(root, 'secrets.json') }

function readConfig(root) {
  return JSON.parse(fs.readFileSync(configPath(root), 'utf8'))
}

function writeConfig(root, next) {
  fs.writeFileSync(configPath(root), JSON.stringify(next, null, 2), 'utf8')
  return next
}

function mergeConfig(root, patch) {
  return writeConfig(root, deepMerge(readConfig(root), patch))
}

function readSecrets(root) {
  try { return JSON.parse(fs.readFileSync(secretsPath(root), 'utf8')) } catch (_) { return {} }
}

function writeSecrets(root, next) {
  fs.writeFileSync(secretsPath(root), JSON.stringify(next, null, 2), 'utf8')
  return next
}

// 设置窗用的：把敏感字段摘出来单独存
function publicSettings(root) {
  const cfg = readConfig(root)
  const sec = readSecrets(root)
  const v = cfg.vision || {}
  return {
    vision: {
      enabled: v.enabled !== false,
      preset: v.preset || 'deepseek',
      format: v.format || '',
      endpoint: v.endpoint || '',
      model: v.model || '',
      thinking: v.thinking || 'off',
      maxTokens: v.maxTokens || 400,
      maxWidth: v.maxWidth || 1280,
      intervalMs: v.intervalMs || 60000,
      changeThreshold: typeof v.changeThreshold === 'number' ? v.changeThreshold : 0.02,
      silentRoundsMin: v.silentRoundsMin || 4,
      silentRoundsMax: v.silentRoundsMax || 8,
      lookPrompt: v.lookPrompt || '',
      useForegroundWindow: v.useForegroundWindow !== false,
    },
    chat: {
      enabled: (cfg.chat && cfg.chat.enabled) !== false,
      customPrompt: (cfg.chat && cfg.chat.customPrompt) || '',
      maxTurns: (cfg.chat && cfg.chat.maxTurns) || 12,
      contextLimitTurns: (cfg.chat && cfg.chat.contextLimitTurns) || 20,
      warnWhenLong: !(cfg.chat && cfg.chat.warnWhenLong === false),
      sendScreenWithChat: !(cfg.chat && cfg.chat.sendScreenWithChat === false),
    },
    appearance: {
      bubbleFontSize: (cfg.bubble && cfg.bubble.fontSize) || 13,
      bubbleMaxRatio: (cfg.bubble && cfg.bubble.maxHeightRatio) || 0.58,
      chatFontSize: (cfg.chat && cfg.chat.fontSize) || 12,
    },
    memory: { enabled: !(cfg.memory && cfg.memory.enabled === false) },
    hasKey: !!(sec.apiKey && String(sec.apiKey).trim()),
    keyTail: sec.apiKey ? String(sec.apiKey).slice(-4) : '',
  }
}

function saveSettings(root, patch) {
  const cfgPatch = {}
  for (const section of ['vision', 'chat', 'memory']) {
    if (patch[section]) cfgPatch[section] = Object.assign({}, patch[section])
  }
  // 外观三段映射回 bubble / chat
  if (patch.appearance) {
    const a = patch.appearance
    cfgPatch.bubble = Object.assign({}, cfgPatch.bubble, {
      fontSize: Math.min(30, Math.max(9, Number(a.bubbleFontSize) || 13)),
      maxHeightRatio: Math.min(0.85, Math.max(0.2, Number(a.bubbleMaxRatio) || 0.58)),
    })
    cfgPatch.chat = Object.assign({}, cfgPatch.chat, {
      fontSize: Math.min(24, Math.max(9, Number(a.chatFontSize) || 12)),
    })
  }
  // apiKey 不进 config.json
  if (cfgPatch.vision && cfgPatch.vision.apiKey !== undefined) delete cfgPatch.vision.apiKey
  const nextCfg = mergeConfig(root, cfgPatch)
  if (patch.apiKey !== undefined) {
    const sec = readSecrets(root)
    const key = String(patch.apiKey).trim()
    if (key) sec.apiKey = key
    else delete sec.apiKey
    writeSecrets(root, sec)
  }
  return { config: nextCfg, settings: publicSettings(root) }
}

function apiKey(root) {
  const sec = readSecrets(root)
  return sec.apiKey ? String(sec.apiKey).trim() : ''
}

module.exports = { readConfig, mergeConfig, readSecrets, writeSecrets, publicSettings, saveSettings, apiKey, deepMerge }
