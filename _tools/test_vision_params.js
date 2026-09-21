// 试出「怎么把思考强度降到最低」——不同参数写法的实测
// 用法: node _tools/test_vision_params.js
const fs = require('fs')

const CRED = 'C:/Users/10033/.dsh/.credentials.yaml'
const IMG = 'G:/Work/AI/test01/DS/icon.png'
const URL = 'https://api.deepseek.com/anthropic/v1/messages'

function findKey() {
  const yaml = fs.readFileSync(CRED, 'utf8')
  const m = yaml.match(/DEEPSEEK_API_KEY\s*:\s*["']?(sk-[A-Za-z0-9_\-]+)/)
  return m ? m[1] : null
}

const b64 = fs.readFileSync(IMG).toString('base64')

const variants = [
  ['baseline', {}],
  ['thinking-disabled', { thinking: { type: 'disabled' } }],
  ['reasoning_effort-low', { reasoning_effort: 'low' }],
  ['reasoningEffort-low', { reasoningEffort: 'low' }],
  ['output_config-effort-low', { output_config: { effort: 'low' } }],
]

;(async () => {
  const key = findKey()
  if (!key) { console.log('没找到 key'); process.exit(1) }
  for (const [name, extra] of variants) {
    const body = Object.assign({
      model: 'deepseek-flash',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: '用一句话说这张图里是什么。' },
        ],
      }],
    }, extra)
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let kinds = '?'
      let outTok = '?'
      try {
        const j = JSON.parse(text)
        kinds = (j.content || []).map((c) => c.type).join('+') || j.type || '?'
        outTok = j.usage ? j.usage.output_tokens : '?'
      } catch (_) { kinds = text.replace(/\s+/g, ' ').slice(0, 120) }
      console.log(name.padEnd(24) + ' HTTP ' + res.status + '  blocks=' + kinds + ' out_tokens=' + outTok)
    } catch (e) {
      console.log(name.padEnd(24) + ' ERR ' + e.message)
    }
  }
})()
