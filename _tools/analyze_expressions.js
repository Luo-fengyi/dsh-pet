// 分析每个表情（exp3）驱动了哪些参数，并借助 cdi3.json 翻成中文名
// 用途：区分「装扮类」（驱动部件/道具）与「脸部表情类」（驱动眼睛/眉毛/嘴/脸）
// 用法: node _tools/analyze_expressions.js
const fs = require('node:fs')
const path = require('node:path')

const DS = path.resolve(__dirname, '..', '..', 'DS')
const OUT = path.join(__dirname, 'expressions_analysis.txt')

// cdi3 里参数 Id -> 中文名
let nameOf = new Map()
let partOf = new Map()
try {
  const cdi = JSON.parse(fs.readFileSync(path.join(DS, 'c_0120.cdi3.json'), 'utf8'))
  for (const p of cdi.Parameters || []) nameOf.set(p.Id, p.Name || '')
  for (const p of cdi.Parts || []) partOf.set(p.Id, p.Name || '')
} catch (e) {
  console.log('读 cdi3 失败：' + e.message)
}

// 判定参数属于哪一类
function classifyParam(id, name) {
  const s = (id + ' ' + name)
  if (/ParamEye|ParamBrow|ParamMouth|ParamCheek|ParamBreath|眼|眉|嘴|脸/.test(s)) return 'face'
  if (/ParamAngle|ParamBodyAngle|Param13|Param14|体|角度/.test(s)) return 'pose'
  if (/paopao|泡泡/.test(s)) return 'bubble'
  if (/j\d|chui|喷|道具|物|桌|phone|手机|锤|包|星/.test(s)) return 'prop'
  return 'other'
}

const files = fs.readdirSync(DS).filter((f) => f.endsWith('.exp3.json')).sort((a, b) => a.localeCompare(b, 'zh'))
const lines = []
lines.push('表情数=' + files.length)
lines.push('')
const buckets = { face: [], prop: [], bubble: [], pose: [], other: [] }

for (const f of files) {
  const label = f.replace('.exp3.json', '')
  let json
  try { json = JSON.parse(fs.readFileSync(path.join(DS, f), 'utf8')) } catch (e) { lines.push(label + ' 解析失败'); continue }
  const params = json.Parameters || []
  const tags = {}
  const detail = []
  for (const p of params) {
    const id = p.Id
    const nm = nameOf.get(id) || ''
    const kind = classifyParam(id, nm)
    tags[kind] = (tags[kind] || 0) + 1
    detail.push(id + (nm ? '(' + nm + ')' : ''))
  }
  const kinds = Object.keys(tags).join('+')
  lines.push(label.padEnd(16) + ' 参数' + String(params.length).padStart(3) + ' [' + kinds + ']  ' + detail.slice(0, 6).join(' '))
  // 归类：只要含 prop/bubble/other 就偏装扮
  const main = tags.prop ? 'prop' : tags.bubble ? 'bubble' : tags.face ? 'face' : tags.pose ? 'pose' : 'other'
  buckets[main].push(label)
}

lines.push('')
lines.push('=== 初步分类 ===')
for (const k of Object.keys(buckets)) {
  lines.push('[' + k + '] ' + buckets[k].length + ' 个：' + buckets[k].join('、'))
}

fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
