// 状态机自测：真实会话文件 + 合成事件序列
// 用法: node _tools/test_status.js
const fs = require('node:fs')
const path = require('node:path')
const { StatusWatcher } = require('../src/status-watcher')
const { readTailLines } = require('../src/zstd-frame')

const ROOT = path.resolve(__dirname, '..')
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))

const out = []
const w = new StatusWatcher(cfg)

function run(name, events, ageMs) {
  const r = w.derive(events, ageMs === undefined ? 500 : ageMs, false)
  out.push(name.padEnd(22) + ' -> state=' + r.state + (r.tool ? ' tool=' + r.tool : '') + (r.mood ? ' mood=' + r.mood.key : ''))
}

const E = (type, data) => ({ type, seq: Math.random(), data: data || {} })

run('空事件', [])
run('用户发消息', [E('user/message', {}), E('turn/start', { turn: 1 })])
run('思考中(step)', [E('turn/start', {}), E('step/start', {})])
run('工具执行', [E('turn/start', {}), E('step/start', {}), E('tool/call', { name: 'pwsh', callId: 'a' })])
run('工具完成→思考', [E('tool/call', { name: 'read', callId: 'a' }), E('tool/result', { message: { source: { callId: 'a' }, content: [{ text: 'ok' }] } })])
run('工具报错', [E('tool/call', { name: 'pwsh', callId: 'a' }), E('tool/result', { message: { source: { callId: 'a' }, content: [{ text: '[exit code: 1]' }] } })])
run('等待审批', [E('turn/start', {}), E('tool/call', { name: 'write', callId: 'a' }), E('approval/asked', {})])
run('正在回复', [E('turn/start', {}), E('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: '好，我来处理' }] }, turn: 1, step: 1 })])
run('回复含开心情绪', [E('assistant/message', { seq: 99, message: { content: [{ type: 'text', text: '已经全部完成，验证通过 ✅' }] } })])
run('回复含难过情绪', [E('assistant/message', { seq: 100, message: { content: [{ type: 'text', text: '抱歉，这个操作失败了' }] } })])
run('回复含疑惑情绪', [E('assistant/message', { seq: 101, message: { content: [{ type: 'text', text: '这里不确定，需要确认一下你的意思？' }] } })])
run('完成', [E('turn/start', {}), E('turn/end', { reason: { kind: 'completed' } })])
run('中断', [E('turn/start', {}), E('turn/end', { reason: { kind: 'aborted' } })])
run('文件过期但状态未收尾', [E('turn/start', {}), E('step/start', {})], 60000)

// 真实文件：自动找最近活跃的会话（也可用 DSPET_SESSION 指定）
const active = w.findActiveSession()
const real = process.env.DSPET_SESSION || (active ? active.file : '')
if (real && fs.existsSync(real)) {
  const parsed = readTailLines(real, 512 * 1024)
  const events = parsed.text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
  out.push('真实文件: frames=' + parsed.frames + ' events=' + events.length)
  const r = w.derive(events, 1000, true)
  out.push('真实状态 -> state=' + r.state + (r.tool ? ' tool=' + r.tool : '') + ' turn=' + r.turn + ' lastEvent=' + r.lastEventType + (r.mood ? ' mood=' + r.mood.key : ''))
  const active = w.findActiveSession()
  out.push('活跃会话 -> ' + (active ? active.sessionId + ' (' + active.project + ', ' + Math.round((Date.now() - active.mtimeMs) / 1000) + 's 前更新)' : '无'))
} else {
  out.push('真实文件不存在: ' + real)
}

const dest = path.join(ROOT, '_tools', 'status_test_result.txt')
fs.writeFileSync(dest, out.join('\n'), 'utf8')
console.log(out.join('\n'))
