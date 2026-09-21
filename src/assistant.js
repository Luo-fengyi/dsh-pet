// 桌宠的小助手：定时看屏幕 + 跟用户聊天 + 维护长期记忆
const { grabScreen, diffScore } = require('./screen')
const vision = require('./vision')
const store = require('./settings-store')
const { getForeground } = require('./foreground')
const { Chat } = require('./chat')
const { analyze } = require('./mood')

class Assistant {
  constructor(options) {
    this.root = options.root
    this.cfg = options.cfg
    this.onReply = options.onReply || (() => {})
    this.onStatus = options.onStatus || (() => {})
    this.log = options.log || (() => {})
    this.chat = new Chat(this.root, this.cfg)
    this.timer = null
    this.busy = false
    this.lastShot = null
    this.lastFingerprint = null
    this.silentLeft = 0
    this.lastError = null
    this.lastReplyAt = 0
    this.stats = { looks: 0, replies: 0, skips: 0, errors: 0 }
  }

  start() {
    const rolled = this.chat.maybeRollSession()
    this.log('[assistant] 会话 ' + this.chat.state.sessionId + (rolled.rolled ? '（开机后首次启动，新开）' : '（接着上次）'))
    if (this.timer) clearInterval(this.timer)
    const interval = Math.max(10000, (this.cfg.vision && this.cfg.vision.intervalMs) || 60000)
    this.timer = setInterval(() => this.tick().catch((e) => this.log('[assistant] tick 出错 ' + e.message)), interval)
    if (this.timer.unref) this.timer.unref()
    // 启动 15 秒后先看一次
    setTimeout(() => this.tick().catch(() => {}), 15000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // 把「用户当前在用什么窗口」拼进提问里，让她的评论贴着用户正在干的事
  async foregroundHint() {
    if (this.cfg.vision && this.cfg.vision.useForegroundWindow === false) return ''
    try {
      const fg = await getForeground()
      const name = (fg && (fg.title || fg.proc)) || ''
      if (!name) return ''
      const proc = fg.proc && fg.proc !== name ? '（进程 ' + fg.proc + '）' : ''
      this.log('[assistant] 前台窗口：' + name)
      return '\n（补充：用户此刻的前台窗口是「' + name + '」' + proc + '。可以顺着这个聊，但别照念窗口标题。）'
    } catch (_) {
      return ''
    }
  }

  // 组装调用参数：key 存在 secrets.json，不进 config.json
  apiConfig() {
    const v = this.cfg.vision || {}
    const key = String(v.apiKey || '').trim() || store.apiKey(this.root)
    return Object.assign({}, v, { apiKey: key })
  }

  status() {
    return {
      sessionId: this.chat.state.sessionId,
      turns: this.chat.turnCount(),
      tooLong: this.chat.isTooLong(),
      memory: this.chat.loadMemory().slice(0, 200),
      stats: this.stats,
      lastError: this.lastError,
      busy: this.busy,
      lastReplyAt: this.lastReplyAt,
      silentLeft: this.silentLeft,
    }
  }

  randInt(min, max) {
    const a = Math.max(1, Math.round(min || 4))
    const b = Math.max(a, Math.round(max || 8))
    return a + Math.floor(Math.random() * (b - a + 1))
  }

  // 每 intervalMs 采一次屏
  async tick() {
    const v = this.cfg.vision || {}
    if (v.enabled === false || this.busy) return
    if (this.silentLeft > 0) {
      this.silentLeft -= 1
      this.stats.skips += 1
      this.onStatus(this.status())
      return
    }
    const shot = await grabScreen(v.maxWidth || 1280)
    if (!shot) return
    const score = this.lastFingerprint ? diffScore(this.lastFingerprint, shot.fingerprint) : 1
    this.lastShot = shot
    const threshold = typeof v.changeThreshold === 'number' ? v.changeThreshold : 0.02
    if (score < threshold) {
      this.lastFingerprint = shot.fingerprint
      this.silentLeft = this.randInt(v.silentRoundsMin, v.silentRoundsMax)
      this.stats.skips += 1
      this.log('[assistant] 画面没变化（' + score.toFixed(4) + '），静默 ' + this.silentLeft + ' 轮')
      this.onStatus(this.status())
      return
    }
    this.lastFingerprint = shot.fingerprint
    this.log('[assistant] 画面变化 ' + score.toFixed(4) + '，交给模型看')
    await this.lookNow('auto')
  }

  // 手动/定时触发的「看一眼」
  async lookNow(reason) {
    if (this.busy) return { ok: false, error: '正在忙' }
    const v = this.cfg.vision || {}
    if (v.enabled === false && reason === 'auto') return { ok: false, error: '看屏幕功能已关闭' }
    this.busy = true
    this.onStatus(this.status())
    try {
      const shot = this.lastShot || await grabScreen(v.maxWidth || 1280)
      if (!shot) return { ok: false, error: '截屏失败' }
      this.lastShot = shot
      this.stats.looks += 1
      const hint = await this.foregroundHint()
      const res = await vision.ask(this.apiConfig(), {
        system: this.chat.systemPrompt(),
        history: (this.cfg.chat && this.cfg.chat.maxTurns ? this.chat.history() : []),
        userText: (v.lookPrompt || '看看我的屏幕，用一两句话随口说点什么。') + hint,
        image: { base64: shot.base64, mediaType: 'image/jpeg' },
        thinking: v.thinking || 'off',
        maxTokens: v.maxTokens || 400,
      })
      const out = this.handleResult(res, 'look')
      return out
    } catch (e) {
      this.lastError = e.message
      this.stats.errors += 1
      return { ok: false, error: e.message }
    } finally {
      this.busy = false
      this.onStatus(this.status())
    }
  }

  // 用户在回复框里发言
  async handleUserText(text) {
    const msg = String(text || '').trim()
    if (!msg) return { ok: false, error: '空消息' }
    if (this.busy) return { ok: false, error: '正在想，稍等' }
    const v = this.cfg.vision || {}
    this.busy = true
    this.onStatus(this.status())
    try {
      const wantScreen = this.cfg.chat ? this.cfg.chat.sendScreenWithChat !== false : true
      let shot = this.lastShot
      if (wantScreen && !shot) {
        shot = await grabScreen(v.maxWidth || 1280)
        if (shot) this.lastShot = shot
      }
      const history = (this.cfg.chat && this.cfg.chat.maxTurns ? this.chat.history() : [])
      this.chat.push('user', msg)
      const hint = wantScreen ? await this.foregroundHint() : ''
      const res = await vision.ask(this.apiConfig(), {
        system: this.chat.systemPrompt(),
        history,
        userText: msg + hint,
        image: wantScreen && shot ? { base64: shot.base64, mediaType: 'image/jpeg' } : null,
        thinking: v.thinking || 'off',
        maxTokens: v.maxTokens || 400,
      })
      return this.handleResult(res, 'chat')
    } catch (e) {
      this.lastError = e.message
      this.stats.errors += 1
      return { ok: false, error: e.message }
    } finally {
      this.busy = false
      this.onStatus(this.status())
    }
  }

  handleResult(res, source) {
    if (!res.ok) {
      this.lastError = res.error
      this.stats.errors += 1
      this.log('[assistant] 调用失败：' + res.error)
      this.onReply({ ok: false, error: res.error, source })
      return { ok: false, error: res.error }
    }
    this.lastError = null
    this.stats.replies += 1
    this.lastReplyAt = Date.now()
    const split = this.chat.splitMemory(res.text)
    const remembered = []
    if (this.cfg.memory && this.cfg.memory.enabled !== false) {
      for (const line of split.memories) {
        if (this.chat.appendMemory(line)) remembered.push(line)
      }
      if (remembered.length) this.log('[assistant] 记下了：' + remembered.join(' | '))
    }
    const mood = analyze(split.text, this.cfg.moods)
    this.chat.push('assistant', split.text)
    this.onReply({
      ok: true,
      text: split.text,
      source,
      mood,
      remembered,
      tooLong: this.chat.isTooLong() && !!(this.cfg.chat && this.cfg.chat.warnWhenLong),
      usage: res.usage || null,
      ms: res.ms || 0,
    })
    return { ok: true, text: split.text }
  }

  newSession() {
    this.chat.newSession()
    this.log('[assistant] 手动新开会话 ' + this.chat.state.sessionId)
    this.onStatus(this.status())
    return this.chat.state.sessionId
  }
}

module.exports = { Assistant }
