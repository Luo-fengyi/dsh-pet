// 监听 DSH 会话日志（session.v3.jsonl.zstd），把「DSH 现在在干嘛」翻译成桌宠状态
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { readTailLines } = require('./zstd-frame')
const { analyze, extractAssistantText } = require('./mood')

const SESSION_FILE_RE = /^session(\.v3)?\.jsonl\.zstd$/

// 工具名 → 中文（气泡里显示）
const TOOL_LABELS = {
  pwsh: '终端',
  read: '看文件',
  write: '写文件',
  edit: '改文件',
  glob: '找文件',
  grep: '搜代码',
  subagent: '派小弟',
  subagent_fork: '派小弟',
  workflow: '跑流程',
  ask_user_question: '问你问题',
  web_search: '上网查',
  web_fetch: '看网页',
  generate_image: '画画',
  edit_image: '改图',
  todo_write: '列清单',
  memory_list: '翻记忆',
  cordis_define: '写插件',
  cordis_run: '跑插件',
  skill: '翻技能书',
  present: '交作业',
}

class StatusWatcher extends EventEmitter {
  constructor(config) {
    super()
    this.config = config
    this.current = null // { file, mtimeMs, sessionId }
    this.lastState = null
    this.lastMood = null
    this.seqOfLastMood = 0
    this.timer = null
    this.lastBubbleAt = 0
  }

  start() {
    this.tick()
    this.timer = setInterval(() => this.tick(), this.config.watch.pollMs || 700)
    if (this.timer.unref) this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // 找出最近活跃的会话文件
  findActiveSession() {
    const root = this.config.watch.sessionsRoot
    let best = null
    let dirs = []
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch (_) { return null }
    for (const d of dirs) {
      const projDir = path.join(root, d.name)
      let sessions = []
      try { sessions = fs.readdirSync(projDir, { withFileTypes: true }).filter((x) => x.isDirectory()) } catch (_) { continue }
      for (const s of sessions) {
        const sessionDir = path.join(projDir, s.name)
        let files = []
        try { files = fs.readdirSync(sessionDir) } catch (_) { continue }
        for (const f of files) {
          if (!SESSION_FILE_RE.test(f)) continue
          const full = path.join(sessionDir, f)
          let st
          try { st = fs.statSync(full) } catch (_) { continue }
          if (!best || st.mtimeMs > best.mtimeMs) {
            best = { file: full, mtimeMs: st.mtimeMs, sessionId: s.name, project: d.name, size: st.size }
          }
        }
      }
    }
    return best
  }

  tick() {
    const active = this.findActiveSession()
    if (!active) {
      this.push({ state: 'idle', reason: 'no-session' })
      return
    }
    const switched = !this.current || this.current.file !== active.file
    this.current = active
    const age = Date.now() - active.mtimeMs

    if (!switched && age > (this.config.watch.idleAfterMs || 25000)) {
      // 文件长时间没动，说明这轮早就结束了
      this.push({ state: 'idle', reason: 'stale', sessionId: active.sessionId })
      return
    }

    let parsed
    try {
      parsed = readTailLines(active.file, 512 * 1024)
    } catch (e) {
      this.push({ state: 'idle', reason: 'read-error:' + e.message })
      return
    }

    const events = []
    for (const line of parsed.text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try { events.push(JSON.parse(t)) } catch (_) { /* 半行跳过 */ }
    }
    if (!events.length) {
      this.push({ state: 'idle', reason: 'empty', sessionId: active.sessionId })
      return
    }
    const result = this.derive(events, age, switched)
    result.sessionId = active.sessionId
    result.project = active.project
    result.ageMs = age
    this.push(result)
  }

  // 事件尾部 → 状态
  derive(events, ageMs, switched) {
    let state = 'idle'
    let tool = null
    let turn = 0
    let lastMood = this.lastMood
    let moodSeq = this.seqOfLastMood
    let lastEndReason = null
    const pendingTools = new Map()

    const tail = events.slice(-400)
    for (const ev of tail) {
      const type = ev.type
      const data = ev.data || {}
      const seq = typeof ev.seq === 'number' ? ev.seq : 0
      if (typeof data.turn === 'number') turn = data.turn
      switch (type) {
        case 'user/message':
        case 'agent/inbox/spliced':
          state = 'listening'
          tool = null
          break
        case 'turn/start':
          state = 'thinking'
          tool = null
          break
        case 'step/start':
          state = 'thinking'
          tool = null
          break
        case 'tool/call':
          state = 'tool'
          tool = TOOL_LABELS[data.name] || data.name || '工具'
          if (data.callId) pendingTools.set(data.callId, data.name)
          break
        case 'tool/result': {
          const id = data.message && data.message.source && data.message.source.callId
          if (id) pendingTools.delete(id)
          const txt = JSON.stringify(data).slice(0, 4000)
          state = /\[exit code: (?!0\])/.test(txt) || /"isError":true/.test(txt) ? 'error' : 'thinking'
          tool = null
          break
        }
        case 'approval/asked':
          state = 'waiting'
          tool = null
          break
        case 'approval/decided':
          state = 'thinking'
          break
        case 'command/run':
          state = 'tool'
          tool = '斜杠命令'
          break
        case 'command/done':
          state = 'thinking'
          tool = null
          break
        case 'assistant/message': {
          const text = extractAssistantText(data.message)
          const hasToolCall = Array.isArray(data.message && data.message.content) &&
            data.message.content.some((c) => c && c.type === 'tool-call')
          if (text) {
            state = 'replying'
            if (seq >= moodSeq) {
              const mood = analyze(text, this.config.moods)
              if (mood) { lastMood = mood; moodSeq = seq }
            }
          } else if (hasToolCall) {
            state = 'tool'
            tool = tool || '工具'
          }
          break
        }
        case 'turn/end': {
          const kind = data.reason && data.reason.kind
          lastEndReason = kind
          state = kind === 'completed' ? 'done' : (kind === 'aborted' ? 'idle' : 'error')
          tool = null
          break
        }
        default:
          break
      }
    }

    // 文件很久没动而最后事件不是 turn/end：多半是被中断了
    if (ageMs > (this.config.watch.idleAfterMs || 25000) && state !== 'done' && state !== 'idle') {
      state = 'idle'
    }

    // 一轮刚结束：把情绪附在完成状态上
    const mood = state === 'done' || state === 'replying' ? lastMood : null

    return { state, tool, turn, mood, endReason: lastEndReason, switched: !!switched, lastEventType: tail.length ? tail[tail.length - 1].type : null }
  }

  push(next) {
    const prev = this.lastState
    const changed = !prev || prev.state !== next.state || prev.tool !== next.tool || (next.mood && (!prev.mood || prev.mood.key !== next.mood.key))
    if (!changed) return
    if (next.mood) this.lastMood = next.mood
    const payload = Object.assign({}, next, { at: Date.now() })
    this.lastState = payload
    this.emit('state', payload)
  }
}

module.exports = { StatusWatcher, TOOL_LABELS }
