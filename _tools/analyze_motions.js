// 分析各动作驱动了哪些参数，找出「锤子」是谁带的
// 用法: node _tools/analyze_motions.js
const fs = require('fs')
const path = require('path')

const M = path.resolve(__dirname, '..', 'assets', 'model')
const cdi = JSON.parse(fs.readFileSync(path.join(M, 'c_0120.cdi3.json'), 'utf8'))
const nameOf = new Map((cdi.Parameters || []).map((p) => [p.Id, p.Name || '']))
const partNames = (cdi.Parts || []).map((p) => p.Id + '=' + (p.Name || ''))

const out = []
out.push('cdi3 参数总数=' + (cdi.Parameters || []).length + ' 部件数=' + (cdi.Parts || []).length)

const sets = {}
const motionDir = path.join(M, 'motions')
for (const f of fs.readdirSync(motionDir).filter((x) => x.endsWith('.json'))) {
  const m = JSON.parse(fs.readFileSync(path.join(motionDir, f), 'utf8'))
  const ids = [...new Set((m.Curves || []).map((c) => c.Id))]
  sets[f.replace('.motion3.json', '')] = new Set(ids)
  out.push(f.padEnd(28) + ' 曲线=' + String((m.Curves || []).length).padStart(4) + ' 参数=' + String(ids.length).padStart(3) +
    ' loop=' + m.Meta.Loop + ' dur=' + m.Meta.Duration)
}

function diff(aName, bName) {
  const a = sets[aName]
  const b = sets[bName]
  if (!a || !b) return
  const onlyA = [...a].filter((x) => !b.has(x))
  const onlyB = [...b].filter((x) => !a.has(x))
  out.push('--- 只在 ' + aName + ' 里 ---')
  for (const id of onlyA) out.push('  ' + id + ' = ' + (nameOf.get(id) || '?'))
  out.push('--- 只在 ' + bName + ' 里 ---')
  for (const id of onlyB) out.push('  ' + id + ' = ' + (nameOf.get(id) || '?'))
}

diff('idle', 'aidale')
diff('idle', 'chuipaopao')
diff('idle', 'zipai_simple')

out.push('--- 参数里可疑（道具/锤/棒等）---')
for (const p of (cdi.Parameters || [])) {
  const s = (p.Id || '') + ' ' + (p.Name || '')
  if (/锤|棒|道具|魔法|prop|item|stick|hammer|wand|tool/i.test(s)) out.push('  ' + p.Id + ' = ' + (p.Name || ''))
}
out.push('--- 部件名（前 60）---')
out.push('  ' + partNames.slice(0, 60).join(' | '))

fs.writeFileSync(path.join(__dirname, 'motion_analysis.txt'), out.join('\n'), 'utf8')
console.log(out.join('\n'))
