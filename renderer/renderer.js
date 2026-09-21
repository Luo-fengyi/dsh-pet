// DS 娘桌宠渲染进程：Live2D 显示 + 状态表情 + 拖动交互
/* global PIXI, Live2DCubismCore */

const MODEL_URL = '../assets/model/ds-pet.model3.json'
const MANIFEST_URL = '../assets/model/manifest.json'

const el = {
  canvas: document.getElementById('stage'),
  bubble: document.getElementById('bubble'),
  bubbleText: document.getElementById('bubble-text'),
  hint: document.getElementById('hint'),
  chatBox: document.getElementById('chatbox'),
  chatInput: document.getElementById('chat-input'),
  chatSend: document.getElementById('chat-send'),
}

let cfg = null
let manifest = null
let pixiApp = null
let model = null
let labelToKey = new Map() // 中文表情名 -> exp01
let keyToLabel = new Map()
let motionNames = [] // Action 组里的动作顺序（ASCII 名）
let lastW = 0
let lastH = 0
let currentState = null
let bubbleTimer = null
let idleTimer = null
let motionResetTimer = null
let lastBubble = ''
let lastBubbleAt = 0

function showHint(msg) {
  el.hint.textContent = msg
  el.hint.classList.remove('hidden')
}

function showBubble(text, ms) {
  if (!text) return
  if (cfg && cfg.bubble && cfg.bubble.enabled === false) return
  const now = Date.now()
  let say = String(text)
  if (say.length > 400) say = say.slice(0, 400) + '…'
  if (say === lastBubble && now - lastBubbleAt < 1500) return
  lastBubble = say
  lastBubbleAt = now
  el.bubbleText.textContent = say
  el.bubble.classList.remove('hidden')
  el.bubble.classList.add('show')
  if (bubbleTimer) clearTimeout(bubbleTimer)
  // 内容越长停得越久：每 10 个字约 1 秒，最短 6 秒，最长 40 秒
  const byLength = Math.round(say.length * 110)
  const life = ms || Math.min(40000, Math.max(6000, byLength))
  bubbleTimer = setTimeout(() => {
    el.bubble.classList.remove('show')
    setTimeout(() => el.bubble.classList.add('hidden'), 240)
  }, life)
}

function expressionKey(label) {
  if (!label) return null
  if (keyToLabel.has(label)) return label // 已经是 expXX
  return labelToKey.get(label) || null
}

function playExpression(labels) {
  if (!model || !Array.isArray(labels) || !labels.length) return
  const key = expressionKey(labels[Math.floor(Math.random() * labels.length)])
  if (!key) return
  try { model.expression(key) } catch (e) { /* 表情缺失就忽略 */ }
}

// 这些动作/表情会把「道具」参数设成显示，而 Cubism 的表达式每帧只会覆盖
// 它自己带的参数，所以必须：先停掉表情 → 再把参数复位 → 最后恢复当前状态的表情。
// 否则点一下之后模型会一直举着道具（看着就像一直拿锤子敲）。
function stopExpressions() {
  try {
    const mm = model && model.internalModel && model.internalModel.motionManager
    if (mm && mm.expressionManager && typeof mm.expressionManager.stopAllMotions === 'function') {
      mm.expressionManager.stopAllMotions()
    }
  } catch (e) {
    console.log('[pet] stopExpressions fail ' + (e && e.message))
  }
}

function resetParameters() {
  if (!model) return
  try {
    const core = model.internalModel.coreModel
    const count = core.getParameterCount()
    for (let i = 0; i < count; i++) {
      core.setParameterValueByIndex(i, core.getParameterDefaultValue(i), 1)
    }
  } catch (e) {
    console.log('[pet] resetParameters fail ' + (e && e.message))
  }
}

// 当前状态该用什么表情（复位后要把状态表情重新贴回去）
function currentExpressionLabels() {
  if (!cfg || !currentState) return []
  const def = (cfg.states && cfg.states[currentState.state]) || null
  const mood = currentState.mood
  if (mood && (currentState.state === 'done' || currentState.state === 'replying') && mood.expressions && mood.expressions.length) {
    return mood.expressions
  }
  return def && def.expressions ? def.expressions : []
}

function playMotion(name) {
  if (!model || !name) return
  const def = (manifest && manifest.motions && manifest.motions[name]) || null
  let group = 'Action'
  let idx = -1
  if (def && def.group) {
    group = def.group
    idx = def.index || 0
  } else {
    idx = motionNames.indexOf(name)
  }
  if (idx < 0) {
    console.log('[pet] motion skip ' + name + '（manifest 里没有 group/index，也不在 Action 组）')
    return
  }
  try {
    const played = model.motion(group, idx, PIXI.live2d.MotionPriority.NORMAL)
    if (played && typeof played.catch === 'function') {
      played.catch((e) => console.log('[pet] motion fail ' + name + '/' + group + '#' + idx + ' : ' + (e && e.message ? e.message : e)))
    }
    const durMs = Math.round(((def && def.duration) || 2) * 1000) + 250
    if (motionResetTimer) clearTimeout(motionResetTimer)
    motionResetTimer = setTimeout(() => {
      stopExpressions()
      resetParameters()
      try { model.motion('Idle', 0, PIXI.live2d.MotionPriority.IDLE) } catch (_) {}
      // 道具清掉后，把当前状态的表情重新贴回去
      const labels = currentExpressionLabels()
      if (labels.length) setTimeout(() => playExpression(labels), 80)
      console.log('[pet] motion reset after ' + name + ' labels=' + labels.join('|'))
    }, durMs)
  } catch (e) { /* 忽略 */ }
}

// ---- 空闲彩蛋：随机敲一下（模型作者那个「敲出包」），最短间隔由 config.json 控制 ----
let eggTimer = null

function scheduleEasterEgg() {
  const egg = (cfg && cfg.easterEgg) || {}
  if (eggTimer) { clearTimeout(eggTimer); eggTimer = null }
  if (egg.enabled === false) return
  const min = Math.max(0, egg.minIntervalMs || 60000)
  const max = Math.max(min, egg.maxIntervalMs || 180000)
  const delay = min + Math.random() * (max - min)
  eggTimer = setTimeout(() => {
    const st = (currentState && currentState.state) || 'idle'
    if (!egg.onlyWhenIdle || st === 'idle') {
      console.log('[pet] easter egg knock after ' + Math.round(delay / 1000) + 's')
      playMotion(egg.motion || 'aidale')
    } else {
      console.log('[pet] easter egg skipped state=' + st)
    }
    scheduleEasterEgg()
  }, delay)
}

// 排查用
window.__motionGroups = () => {
  try {
    const mm = model.internalModel.motionManager
    const defs = mm.definitions || {}
    return Object.keys(defs).map((g) => g + ':' + (defs[g] ? defs[g].length : 0))
  } catch (e) { return ['ERR ' + e.message] }
}
window.__eggTest = (minMs, maxMs) => {
  cfg.easterEgg = Object.assign({}, cfg.easterEgg, { enabled: true, minIntervalMs: minMs, maxIntervalMs: maxMs, onlyWhenIdle: false })
  scheduleEasterEgg()
  return true
}
window.__eggNow = async () => {
  playMotion((cfg.easterEgg && cfg.easterEgg.motion) || 'aidale')
  return 'called'
}

// 排查用：列出「当前值 ≠ 默认值」的参数和未完全透明的部件，找出道具是谁在控制
window.__dumpParams = () => {
  if (!model) return { ready: false }
  const core = model.internalModel.coreModel
  const methods = {
    getParameterCount: typeof core.getParameterCount,
    getParameterDefaultValue: typeof core.getParameterDefaultValue,
    getParameterValueByIndex: typeof core.getParameterValueByIndex,
    setParameterValueByIndex: typeof core.setParameterValueByIndex,
    getPartCount: typeof core.getPartCount,
    getPartOpacityByIndex: typeof core.getPartOpacityByIndex,
    setPartOpacityByIndex: typeof core.setPartOpacityByIndex,
    saveParameters: typeof core.saveParameters,
    loadParameters: typeof core.loadParameters,
  }
  const params = []
  let count = 0
  try {
    count = core.getParameterCount() || 0
    for (let i = 0; i < count; i++) {
      const id = core.getParameterId ? core.getParameterId(i) : String(i)
      const cur = core.getParameterValueByIndex(i)
      const def = core.getParameterDefaultValue(i)
      if (Math.abs(cur - def) > 0.002) params.push({ id, cur: Number(cur.toFixed(3)), def: Number(def.toFixed(3)) })
    }
  } catch (e) { params.push({ err: String(e && e.message) }) }
  const parts = []
  try {
    const pn = core.getPartCount ? core.getPartCount() : 0
    for (let i = 0; i < pn; i++) {
      const op = core.getPartOpacityByIndex(i)
      if (op < 0.999) parts.push({ i, op: Number(op.toFixed(3)) })
    }
  } catch (e) { parts.push({ err: String(e && e.message) }) }
  return { ready: true, count, methods, params: params.slice(0, 40), paramTotal: params.length, parts: parts.slice(0, 30), partTotal: parts.length }
}

// 外观：字号与气泡最大高度都由 config 控制
function applyAppearance() {
  if (!cfg) return
  const b = cfg.bubble || {}
  const c = cfg.chat || {}
  const bubbleFs = Number(b.fontSize) || 13
  el.bubble.style.fontSize = bubbleFs + 'px'
  const chatFs = Number(c.fontSize) || 12
  el.chatInput.style.fontSize = chatFs + 'px'
  el.chatSend.style.fontSize = Math.max(11, chatFs + 1) + 'px'
  const ratio = Math.min(0.85, Math.max(0.2, Number(b.maxHeightRatio) || 0.58))
  document.documentElement.style.setProperty('--bubble-max-h', Math.round(window.innerHeight * ratio) + 'px')
}

function layout(force) {
  if (!model || !pixiApp) return
  window.__layoutCalls = (window.__layoutCalls || 0) + 1
  const w = window.innerWidth
  const h = window.innerHeight
  // 窗口尺寸没变就什么都不做：拖动时 Electron 会反复触发 resize，
  // 以前每次重算会让模型越缩越大，这里彻底堵死
  if (!force && w === lastW && h === lastH) return
  window.__layoutApplied = (window.__layoutApplied || 0) + 1
  lastW = w
  lastH = h
  pixiApp.renderer.resize(w, h)
  // 用模型自身画布尺寸算缩放（不随动作/眨眼改变包围盒）
  const baseW = (model.internalModel && model.internalModel.width) || model.width
  const baseH = (model.internalModel && model.internalModel.height) || model.height
  model.scale.set(1)
  const scale = Math.min((h * 0.98) / baseH, w / baseW)
  model.scale.set(scale)
  model.x = (w - baseW * scale) / 2
  model.y = h - baseH * scale
  applyAppearance()
}

// 排查用：返回当前实际缩放状态
window.__layoutTest = () => {
  if (!model || !pixiApp) return { ready: false }
  const baseW = (model.internalModel && model.internalModel.width) || model.width
  const baseH = (model.internalModel && model.internalModel.height) || model.height
  return {
    ready: true,
    winW: window.innerWidth,
    winH: window.innerHeight,
    rendererW: pixiApp.renderer.width,
    base: [Math.round(baseW), Math.round(baseH)],
    scale: Number(model.scale.y.toFixed(4)),
    modelH: Math.round(model.height),
    renderedH: Math.round(baseH * model.scale.y),
    layoutCalls: window.__layoutCalls || 0,
    layoutApplied: window.__layoutApplied || 0,
  }
}

// 状态 → 表情/动作/气泡
function applyState(payload) {
  if (!payload || !cfg) return
  const stateKey = payload.state || 'idle'
  const def = (cfg.states && cfg.states[stateKey]) || null
  const mood = payload.mood || null

  const changed = !currentState || currentState.state !== stateKey || (currentState.tool || '') !== (payload.tool || '') ||
    ((currentState.mood && currentState.mood.key) || '') !== ((mood && mood.key) || '')
  if (!changed) return
  currentState = payload

  let labels = def && def.expressions ? def.expressions.slice() : []
  let bubble = def && def.bubble ? def.bubble : ''

  if (mood && (stateKey === 'done' || stateKey === 'replying')) {
    if (mood.expressions && mood.expressions.length) labels = mood.expressions.slice()
    if (mood.bubble) bubble = mood.bubble
  }

  if (bubble.indexOf('{tool}') >= 0) bubble = bubble.replace('{tool}', payload.tool || '工具')

  playExpression(labels)
  if (def && def.motion) playMotion(def.motion)
  if (bubble) showBubble(bubble)
}

function randomPick(arr) {
  if (!arr || !arr.length) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

function onTap() {
  if (!cfg) return
  const it = cfg.interact || {}
  playExpression(it.clickExpressions || [])
  showBubble(randomPick(it.clickBubbles) || '嗯？')
  const m = randomPick(it.clickMotions)
  if (m) playMotion(m)
}

async function boot() {
  if (typeof PIXI === 'undefined' || !PIXI.live2d) {
    showHint('Live2D 库没加载成功（vendor 目录缺少文件？）')
    return
  }
  if (typeof Live2DCubismCore === 'undefined') {
    showHint('Cubism Core 没加载成功（vendor/live2dcubismcore.min.js）')
    return
  }

  cfg = await window.pet.getConfig()
  try {
    const res = await fetch(MANIFEST_URL)
    manifest = await res.json()
  } catch (e) {
    manifest = null
  }
  if (manifest) {
    for (const e of manifest.expressions || []) {
      labelToKey.set(e.label, e.key)
      keyToLabel.set(e.key, e.label)
    }
    motionNames = Object.keys(manifest.motions || {}).filter((k) => k !== 'idle' && k !== 'aidale')
  }

  pixiApp = new PIXI.Application({
    view: el.canvas,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  })

  try {
    model = await PIXI.live2d.Live2DModel.from(MODEL_URL, {
      autoInteract: false,
      motionPreload: PIXI.live2d.MotionPreloadStrategy.IDLE,
    })
  } catch (e) {
    showHint('模型加载失败：' + (e && e.message ? e.message : e))
    return
  }

  pixiApp.stage.addChild(model)
  layout(true)
  window.addEventListener('resize', () => layout())

  if (model.internalModel && model.internalModel.motionManager) {
    try { model.internalModel.motionManager.groups.idle = 'Idle' } catch (_) {}
  }

  const last = await window.pet.getStatus()
  applyState(last || { state: 'idle' })
  showBubble('DS 娘上线～', 2600)

  window.pet.onState((payload) => applyState(payload))
  window.pet.onConfig((next) => { cfg = next; applyAppearance() })
  window.pet.onResize(() => setTimeout(() => layout(true), 60))

  // 待机时偶尔眨眼/小动作：库自带 Idle 循环，这里只在很久没状态时把表情收回
  idleTimer = setInterval(() => {
    if (!currentState || Date.now() - (currentState.at || 0) > 120000) {
      if (currentState && currentState.state !== 'idle') applyState({ state: 'idle', at: Date.now() })
    }
  }, 30000)

  scheduleEasterEgg()
  setupChat()
}

// ---- 回复框：跟桌宠自己聊 ----
function setChatBusy(busy) {
  el.chatInput.disabled = !!busy
  el.chatSend.disabled = !!busy
  el.chatInput.placeholder = busy ? '正在想…' : '跟我说点什么…'
}

async function sendChat() {
  const text = el.chatInput.value.trim()
  if (!text) return
  el.chatInput.value = ''
  el.chatBox.classList.add('active')
  setChatBusy(true)
  showBubble('嗯…让我想想', 8000)
  try {
    const res = await window.pet.chatSend(text)
    if (!res || !res.ok) showBubble('唔…' + ((res && res.error) || '出错了'), 6000)
    // 成功时回复会走 onChatReply，这里不重复显示
  } catch (e) {
    showBubble('调用失败：' + (e && e.message ? e.message : e), 6000)
  } finally {
    setChatBusy(false)
    el.chatInput.focus()
  }
}

function applyChatReply(payload) {
  if (!payload) return
  if (!payload.ok) {
    showBubble('（' + (payload.error || '调用失败') + '）', 6000)
    return
  }
  if (payload.text) showBubble(payload.text, 10000)
  if (payload.mood && payload.mood.expressions && payload.mood.expressions.length) {
    playExpression(payload.mood.expressions)
  }
  if (payload.remembered && payload.remembered.length) {
    console.log('[pet] 记住了 ' + payload.remembered.join(' | '))
  }
  if (payload.tooLong) {
    setTimeout(() => showBubble('咱俩聊得有点长了，右键 →「新开会话」可以清一清～', 6000), 2500)
  }
}

function setupChat() {
  el.chatSend.addEventListener('click', sendChat)
  el.chatInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); sendChat() }
  })
  el.chatInput.addEventListener('focus', () => el.chatBox.classList.add('active'))
  el.chatInput.addEventListener('blur', () => el.chatBox.classList.remove('active'))
  window.pet.onChatReply(applyChatReply)
  window.pet.onAssistantStatus((st) => {
    if (st && st.busy) setChatBusy(true)
    else setChatBusy(false)
  })
}

// ---- 交互：拖动 / 点击 / 右键 ----
let pressing = false
let dragTimer = null
let pressAt = null
let moved = false
let pressStartAt = 0
let dragTicks = 0
let noButtonSince = 0

function beginPress(ev) {
  if (ev.button !== 0) return
  // 回复框里的操作不算拖动
  if (ev.target && ev.target.closest && ev.target.closest('#chatbox')) return
  pressing = true
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null } // 上一轮没收尾的定时器先清掉
  moved = false
  dragTicks = 0
  pressAt = { x: ev.screenX, y: ev.screenY }
  pressStartAt = Date.now()
  console.log('[pet] down ' + ev.screenX + ',' + ev.screenY)
  window.pet.dragBegin()
  dragTimer = setInterval(() => {
    if (!pressing) { clearInterval(dragTimer); dragTimer = null; return }
    // 兜底：鼠标其实早就松了（窗口移动会吞掉 mouseup）就自己收尾
    if (Date.now() - pressStartAt > 30000) { console.log('[pet] drag timeout self-heal'); finishPress(false); return }
    dragTicks += 1
    window.pet.dragMove()
  }, 16)
  document.body.classList.add('dragging')
}

function movePress(ev) {
  if (!pressing || !pressAt) return
  // 鼠标键其实已经松开、但 mouseup 丢了：连续 0.5 秒都报 0 才自愈，
  // 单次误报（窗口移动时 Chromium 偶尔会这么发）不至于把拖动打断
  if (ev.buttons === 0) {
    if (!noButtonSince) noButtonSince = Date.now()
    else if (Date.now() - noButtonSince > 500) { console.log('[pet] self-heal buttons=0'); finishPress(false); return }
  } else {
    noButtonSince = 0
  }
  if (Math.abs(ev.screenX - pressAt.x) > 4 || Math.abs(ev.screenY - pressAt.y) > 4) moved = true
}

function finishPress(tap) {
  if (!pressing) return
  pressing = false
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
  window.pet.dragEnd()
  document.body.classList.remove('dragging')
  console.log('[pet] up moved=' + moved + ' ticks=' + dragTicks)
  if (tap && !moved) onTap()
}

window.addEventListener('mousedown', beginPress)
window.addEventListener('mousemove', movePress)
window.addEventListener('mouseup', () => finishPress(true))
// 不用 blur 结束拖动：窗口移动时会误触发失焦，拖动会「一碰就断」
window.addEventListener('contextmenu', (ev) => {
  ev.preventDefault()
  console.log('[pet] contextmenu')
  window.pet.contextMenu()
})

boot().catch((e) => showHint('启动失败：' + (e && e.message ? e.message : e)))
