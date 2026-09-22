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
let currentScale = 0   // 0 表示"还不知道"，这时回落到 config 里的 window.scale
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

// 一屏能放多少字。
// 注意：别用"塞进 DOM 再量 scrollHeight"那招——这套气泡是绝对定位 + transform 居中，
// clientHeight 量出来不准，二分出来的结果会小到离谱（实测分成了 17 页、每页 8 个字）。
// 这里按实测反推的经验系数估：中文连标点大约占 1.6 个字号的宽度/行高。
function fitChars(text) {
  const b = (cfg && cfg.bubble) || {}
  const s = Math.max(0.5, Math.min(2.5, currentScale || (cfg.window && cfg.window.scale) || 1))
  const eff = Math.max(0.7, Math.min(1.15, Math.pow(s, 0.7)))
  const fs = Math.max(9, (Number(b.fontSize) || 13) * eff)
  const ratio = Math.min(0.88, Math.max(0.2, (Number(b.maxHeightRatio) || 0.58) * (s < 0.85 ? 1.35 : 1)))
  const bubbleW = window.innerWidth * 0.92 - 26
  const bubbleH = window.innerHeight * ratio - 18
  const perLine = Math.max(6, Math.floor(bubbleW / (fs * 1.6)))
  const lines = Math.max(2, Math.floor(bubbleH / (fs * 1.6)))
  const cap = Math.floor(perLine * lines * 0.9)   // 再留一成余量，宁可分页也别截字
  return Math.max(20, Math.min(text.length, cap))
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

  const b = (cfg && cfg.bubble) || {}
  const perChar = Number(b.msPerChar) > 0 ? Number(b.msPerChar) : 200
  const minMs = Number(b.minMs) > 0 ? Number(b.minMs) : 6000
  const maxMs = Number(b.maxMs) > 0 ? Number(b.maxMs) : 40000

  // 一屏放不下就切几屏轮着播，保证能读完（页码会标出来）
  const cap = fitChars(say)
  const pages = []
  if (say.length > cap * 1.1) {
    for (let i = 0; i < say.length; i += cap) pages.push(say.slice(i, i + cap))
  } else {
    pages.push(say)
  }

  el.bubble.classList.remove('hidden')
  el.bubble.classList.add('show')
  if (bubbleTimer) clearTimeout(bubbleTimer)

  let idx = 0
  const showPage = () => {
    const page = pages[idx]
    el.bubbleText.textContent = pages.length > 1
      ? page + '\n（' + (idx + 1) + '/' + pages.length + '）'
      : page
    const life = ms || Math.min(maxMs, Math.max(minMs, Math.round(page.length * perChar)))
    idx += 1
    bubbleTimer = setTimeout(() => {
      if (idx < pages.length) { showPage(); return }
      el.bubble.classList.remove('show')
      setTimeout(() => el.bubble.classList.add('hidden'), 240)
    }, life)
  }
  showPage()
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
  // 窗口缩小时字也跟着缩（非线性、带下限），否则一行放不下几个字、长回复读不完
  const s = Math.max(0.5, Math.min(2.5, currentScale || (cfg.window && cfg.window.scale) || 1))
  const eff = Math.max(0.7, Math.min(1.15, Math.pow(s, 0.7)))
  const bubbleFs = Math.max(9, Math.round((Number(b.fontSize) || 13) * eff))
  el.bubble.style.fontSize = bubbleFs + 'px'
  const chatFs = Math.max(9, Math.round((Number(c.fontSize) || 12) * Math.max(0.85, eff)))
  el.chatInput.style.fontSize = chatFs + 'px'
  el.chatSend.style.fontSize = Math.max(11, chatFs + 1) + 'px'
  // 窗口越小，气泡越要占满纵向空间，不然显示不下
  const baseRatio = Number(b.maxHeightRatio) || 0.58
  const ratio = Math.min(0.88, Math.max(0.2, s < 0.85 ? baseRatio * 1.35 : baseRatio))
  document.documentElement.style.setProperty('--bubble-max-h', Math.round(window.innerHeight * ratio) + 'px')
}

// ---- 装扮层：按分类选好的装扮（头饰/眼镜/道具…）持续生效 ----
// Cubism 一次只能应用一个表情，所以装扮不走 expression，而是把选中的 exp3 参数
// 合并起来，每帧覆盖写一遍，这样不会被动作或表情冲掉。
let outfitDefs = []
let outfitLabels = []

// 把上次装扮写过的参数恢复成默认值。
// 必须做：装扮是每帧覆盖写参数的，光清空 outfitDefs 只是停止写入，
// 参数还停在装扮值上 → 表现就是"取消装扮没反应""换了眼镜结果两副一起戴"。
function resetOutfitParams() {
  if (!model || !outfitDefs.length) return
  try {
    const core = model.internalModel.coreModel
    for (const d of outfitDefs) {
      const idx = core.getParameterIndex ? core.getParameterIndex(d.id) : -1
      if (idx >= 0) core.setParameterValueByIndex(idx, core.getParameterDefaultValue(idx), 1)
    }
  } catch (e) {
    console.log('[pet] 复位装扮参数失败：' + (e && e.message))
  }
}

async function loadOutfit() {
  resetOutfitParams()
  outfitDefs = []
  outfitLabels = []
  const o = (cfg && cfg.outfit) || {}
  const cats = o.categories || {}
  const sel = o.selected || {}
  // 收集要装的项，并把它声明的依赖（also）一起带上——
  // 有些项单独装看不见效果，比如「魔爪换色」是给魔爪换颜色，得先有魔爪
  const wanted = []
  const push = (label) => { if (label && wanted.indexOf(label) < 0) wanted.push(label) }
  for (const key of Object.keys(cats)) {
    const label = sel[key]
    if (!label) continue
    push(label)
    const items = cats[key].items || []
    for (const it of items) {
      if (typeof it === 'string') continue
      if (it && it.label === label && Array.isArray(it.also)) {
        for (const extra of it.also) push(extra)
      }
    }
  }
  const picks = wanted
  for (const label of picks) {
    const e = (manifest && manifest.expressions || []).find((x) => x.label === label)
    if (!e) continue
    try {
      const res = await fetch('../assets/model/' + e.file)
      const json = await res.json()
      for (const p of json.Parameters || []) {
        if (!p || !p.Id) continue
        outfitDefs.push({ id: p.Id, value: p.Value })
      }
      outfitLabels.push(label)
    } catch (err) {
      console.log('[pet] 装扮载入失败 ' + label + '：' + (err && err.message))
    }
  }
  console.log('[pet] 装扮：' + (outfitLabels.join('、') || '（无）') + '，参数 ' + outfitDefs.length + ' 条')
}

function applyOutfitParams() {
  if (!outfitDefs.length || !model) return
  try {
    const core = model.internalModel.coreModel
    for (const d of outfitDefs) {
      const idx = core.getParameterIndex ? core.getParameterIndex(d.id) : -1
      if (idx >= 0) core.setParameterValueByIndex(idx, d.value, 1)
    }
  } catch (_) {}
}

// 调试/随机装扮用：直接传一组装扮名
window.__setOutfit = async (labels) => {
  if (!cfg) return 'cfg 未就绪'
  const cats = (cfg.outfit && cfg.outfit.categories) || {}
  const sel = {}
  for (const key of Object.keys(cats)) sel[key] = null
  for (const label of labels || []) {
    for (const key of Object.keys(cats)) {
      // items 里可能是字符串，也可能是 { label, name } 对象
      const items = (cats[key].items || []).map((it) => (typeof it === 'string' ? it : (it && it.label) || ''))
      if (items.indexOf(label) >= 0) sel[key] = label
    }
  }
  cfg.outfit = Object.assign({}, cfg.outfit, { selected: sel })
  await loadOutfit()
  return outfitLabels.join('、')
}
window.__outfitInfo = () => ({ labels: outfitLabels, params: outfitDefs.length })

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

  // 装扮：先载入选中的装扮参数，再挂到每帧循环上持续生效
  await loadOutfit()
  pixiApp.ticker.add(applyOutfitParams)

  if (model.internalModel && model.internalModel.motionManager) {
    try { model.internalModel.motionManager.groups.idle = 'Idle' } catch (_) {}
  }

  const last = await window.pet.getStatus()
  applyState(last || { state: 'idle' })
  showBubble('DS 娘上线～', 2600)

  window.pet.onState((payload) => applyState(payload))
  window.pet.onConfig((next) => { cfg = next; applyAppearance(); loadOutfit() })
  window.pet.onResize((payload) => {
    if (payload && payload.scale) currentScale = payload.scale
    setTimeout(() => layout(true), 60)
  })

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
  // 主进程换了装扮（随机的 / 设置窗改的）→ 重新载入
  window.pet.onOutfit(async (sel) => {
    cfg.outfit = Object.assign({}, cfg.outfit, { selected: sel })
    await loadOutfit()
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

// ---- 透明区域鼠标穿透 ----
// 只有「角色本体所在矩形」和「回复框」接收鼠标，其余透明部分放行给下面的窗口，
// 免得窗口里大片空白也吃掉点击
let lastInside = null

function pointInModel(x, y) {
  if (!model) return false
  try {
    const b = model.getBounds()
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
  } catch (_) {
    return false
  }
}

function updateMouseThrough(ev) {
  if (pressing) return   // 拖动过程中别切换，否则 mouseup 会丢
  let inside = pointInModel(ev.clientX, ev.clientY)
  if (!inside && el.chatBox) {
    const r = el.chatBox.getBoundingClientRect()
    if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) inside = true
  }
  if (inside !== lastInside) {
    lastInside = inside
    window.pet.mouseThrough(!inside)
  }
}

window.addEventListener('mousedown', beginPress)
window.addEventListener('mousemove', movePress)
window.addEventListener('mousemove', updateMouseThrough)
window.addEventListener('mouseup', () => finishPress(true))
// 不用 blur 结束拖动：窗口移动时会误触发失焦，拖动会「一碰就断」
window.addEventListener('contextmenu', (ev) => {
  ev.preventDefault()
  console.log('[pet] contextmenu')
  window.pet.contextMenu()
})

boot().catch((e) => showHint('启动失败：' + (e && e.message ? e.message : e)))
