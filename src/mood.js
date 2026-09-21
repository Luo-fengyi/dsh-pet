// 把 DSH 的回复文字粗略判成情绪，用于挑表情（纯本地关键词，不花钱、不联网）
function analyze(text, moods) {
  const src = String(text || '')
  if (!src.trim()) return null
  const hits = []
  for (const key of Object.keys(moods || {})) {
    const def = moods[key]
    const words = def.keywords || []
    let score = 0
    for (const w of words) {
      if (!w) continue
      const idx = src.indexOf(w)
      if (idx >= 0) score += 1 + Math.max(0, 3 - Math.floor(idx / 200)) // 越靠前越算数
    }
    if (score > 0) hits.push({ key, score, def })
  }
  if (!hits.length) return null
  hits.sort((a, b) => b.score - a.score)
  const top = hits[0]
  return { key: top.key, label: top.def.label || top.key, expressions: top.def.expressions || [], bubble: top.def.bubble || '' }
}

// 从事件里的 assistant 消息里挑出纯文本部分（丢掉 reasoning 思考过程）
function extractAssistantText(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
}

module.exports = { analyze, extractAssistantText }
