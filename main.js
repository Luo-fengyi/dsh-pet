// DS 娘桌宠主进程：透明置顶小窗 + 监听 DSH 会话状态
const { app, BrowserWindow, ipcMain, Menu, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { StatusWatcher } = require('./src/status-watcher')
const { Assistant } = require('./src/assistant')
const store = require('./src/settings-store')
const outfitMod = require('./src/outfit')

const ROOT = __dirname
const CONFIG_PATH = path.join(ROOT, 'config.json')
// 窗口位置/大小/开关这类「运行时状态」单独存，绝不回写 config.json
// （以前退出时会把整个内存配置写回 config.json，用户手工改的内容会被抹掉）
const STATE_PATH = path.join(ROOT, 'window-state.json')

// 调试用：指定独立 userData，避免和正在运行的桌宠抢单实例锁
if (process.env.DSPET_USERDATA) app.setPath('userData', process.env.DSPET_USERDATA)

// 调试运行时不要动用户的 config.json
const DEBUG_RUN = !!(process.env.DSPET_SNAP || process.env.DSPET_DEMO || process.env.DSPET_DRAGTEST ||
  process.env.DSPET_INPUTTEST || process.env.DSPET_CURSORTEST || process.env.DSPET_IDLEWATCH ||
  process.env.DSPET_EGGTEST || process.env.DSPET_LOOKTEST || process.env.DSPET_CHATBOX_TEST || process.env.DSPET_OUTFIT_TEST)

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) } catch (_) { return {} }
}

// 把上次退出时的窗口状态盖到配置上（配置本身只读）
function applyStateToConfig() {
  const st = loadState()
  if (typeof st.x === 'number') cfg.window.x = st.x
  if (typeof st.y === 'number') cfg.window.y = st.y
  if (typeof st.width === 'number') cfg.window.width = st.width
  if (typeof st.height === 'number') cfg.window.height = st.height
  if (typeof st.alwaysOnTop === 'boolean') cfg.window.alwaysOnTop = st.alwaysOnTop
  if (cfg.bubble && typeof st.bubbleEnabled === 'boolean') cfg.bubble.enabled = st.bubbleEnabled
}

function saveState() {
  if (DEBUG_RUN) return
  try {
    const b = win && !win.isDestroyed()
      ? win.getBounds()
      : { x: cfg.window.x, y: cfg.window.y, width: cfg.window.width, height: cfg.window.height }
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      alwaysOnTop: !!cfg.window.alwaysOnTop,
      bubbleEnabled: !!(cfg.bubble && cfg.bubble.enabled),
    }, null, 2), 'utf8')
  } catch (_) {}
}

let cfg = null
let win = null
let watcher = null
let assistant = null
let settingsWin = null
let drag = null // { offsetX, offsetY, w, h }
let saveTimer = null
// 桌宠目标窗口尺寸。Windows 对透明无边框窗口有边框补偿，
// 单纯 setPosition 会每移动一次把窗口撑大几像素（进而触发缩放重算），
// 所以移动时一律用 setBounds 把尺寸钉死。
let design = { w: 320, h: 440 }
// config.json 里写的原始尺寸，作为「小/中/大」的基准，避免连续放大累积
let baseSize = { w: 320, h: 440 }

const LOG_PATH = path.join(ROOT, 'pet.log')

function appendLog(line) {
  try {
    const stamp = new Date().toISOString().slice(11, 19)
    fs.appendFileSync(LOG_PATH, '[' + stamp + ':' + process.pid + '] ' + line + '\n')
  } catch (_) {}
}

function trimLog() {
  try {
    if (!fs.existsSync(LOG_PATH)) return
    const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n')
    if (lines.length > 300) fs.writeFileSync(LOG_PATH, lines.slice(-200).join('\n'))
  } catch (_) {}
}

// 调试用：DSPET_SNAP=<png路径> 启动时，渲染完截图并退出
// DSPET_DEMO=<输出目录> 时按顺序演示各状态并逐个截图，用于验收
function setupDebug() {
  win.webContents.on('console-message', (...args) => {
    try {
      const first = args[1]
      const msg = first && typeof first === 'object' ? first.message : args[2]
      appendLog('[renderer] ' + msg)
    } catch (_) {}
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => appendLog('[fail-load] ' + code + ' ' + desc))

  const demoDir = process.env.DSPET_DEMO
  if (demoDir) {    const steps = [
      { state: 'thinking', tool: null, mood: null },
      { state: 'tool', tool: '终端', mood: null },
      { state: 'waiting', tool: null, mood: null },
      { state: 'done', tool: null, mood: { key: 'happy', label: '开心', expressions: ['开心兴奋'], bubble: '好耶！' } },
      { state: 'error', tool: null, mood: null },
    ]
    let i = 0
    const timer = setInterval(async () => {
      if (i >= steps.length) {
        clearInterval(timer)
        app.quit()
        return
      }
      const step = steps[i]
      pushState(Object.assign({ at: Date.now() }, step))
      const name = step.state
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage()
          fs.writeFileSync(path.join(demoDir, 'demo_' + name + '.png'), image.toPNG())
          appendLog('[demo] ' + name)
        } catch (e) { appendLog('[demo] fail ' + e.message) }
      }, 1600)
      i += 1
    }, 2600)
    return
  }

  // DSPET_SETTINGSTEST=<jpg路径>：打开设置窗，并用截屏方式拍下来（顺带接住设置窗的报错）
  if (process.env.DSPET_SETTINGSTEST) {
    const out = process.env.DSPET_SETTINGSTEST
    setTimeout(async () => {
      openSettings()
      if (settingsWin) {
        settingsWin.webContents.on('console-message', (...args) => {
          try {
            const first = args[1]
            const m = first && typeof first === 'object' ? first.message : args[2]
            appendLog('[settings-ui] ' + m)
          } catch (_) {}
        })
        settingsWin.webContents.on('did-fail-load', (_e, code, desc) => appendLog('[settings-ui] fail-load ' + code + ' ' + desc))
      }
      await new Promise((r) => setTimeout(r, 4000))
      if (settingsWin) appendLog('[settingstest] visible=' + settingsWin.isVisible() + ' bounds=' + JSON.stringify(settingsWin.getBounds()))
      try {
        const shot = await require('./src/screen').grabScreen(1280)
        if (shot) {
          fs.writeFileSync(out, shot.jpeg)
          appendLog('[settingstest] 截图 ' + shot.width + 'x' + shot.height + ' ' + Math.round(shot.bytes / 1024) + 'KB')
        } else appendLog('[settingstest] 截屏为空')
      } catch (e) { appendLog('[settingstest] 失败 ' + e.message) }
      app.quit()
    }, 8000)
    return
  }

  // DSPET_OUTFIT_TEST=<目录> [+ DSPET_OUTFIT_PICKS=装扮1,装扮2]：验证装扮能否叠加、会不会被动作冲掉
  if (process.env.DSPET_OUTFIT_TEST) {
    const outDir = process.env.DSPET_OUTFIT_TEST
    const picks = String(process.env.DSPET_OUTFIT_PICKS || '').split(',').map((s) => s.trim()).filter(Boolean)
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    setTimeout(async () => {
      try {
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(path.join(outDir, 'o0-before.png'), (await win.webContents.capturePage()).toPNG())
        if (picks.length) {
          const r = await win.webContents.executeJavaScript('window.__setOutfit(' + JSON.stringify(picks) + ')')
          appendLog('[outfit] 套用：' + r)
        }
        await sleep(1000)
        fs.writeFileSync(path.join(outDir, 'o1-applied.png'), (await win.webContents.capturePage()).toPNG())
        await sleep(4000)
        fs.writeFileSync(path.join(outDir, 'o2-after4s.png'), (await win.webContents.capturePage()).toPNG())
        appendLog('[outfit] 状态：' + await win.webContents.executeJavaScript('JSON.stringify(window.__outfitInfo ? window.__outfitInfo() : null)'))
        try { await win.webContents.executeJavaScript('window.__eggNow && window.__eggNow()') } catch (_) {}
        await sleep(1500)
        fs.writeFileSync(path.join(outDir, 'o3-afterMotion.png'), (await win.webContents.capturePage()).toPNG())
        // 最后清空装扮，验证旧装扮会不会残留（这是"点恢复默认没反应"的复现点）
        try { await win.webContents.executeJavaScript('window.__setOutfit([])') } catch (_) {}
        await sleep(1000)
        fs.writeFileSync(path.join(outDir, 'o4-cleared.png'), (await win.webContents.capturePage()).toPNG())
      } catch (e) { appendLog('[outfit] 失败 ' + e.message) }
      app.quit()
    }, 9000)
    return
  }

  // DSPET_CHATBOX_TEST=<png路径>：先拍一张（输入框应隐形），再强制显示拍一张
  if (process.env.DSPET_CHATBOX_TEST) {
    const out = process.env.DSPET_CHATBOX_TEST
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    setTimeout(async () => {
      try { fs.writeFileSync(out.replace(/\.png$/, '-idle.png'), (await win.webContents.capturePage()).toPNG()) } catch (_) {}
      try {
        await win.webContents.executeJavaScript("document.getElementById('chatbox').classList.add('active')")
        await sleep(500)
        fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG())
      } catch (_) {}
      appendLog('[chatbox] 两张图已保存')
      app.quit()
    }, 9000)
    return
  }

  // DSPET_LOOKTEST=<png路径>：立刻触发一次「看一眼桌面」，看气泡里有没有话说
  if (process.env.DSPET_LOOKTEST) {
    const out = process.env.DSPET_LOOKTEST
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    setTimeout(async () => {
      const res = assistant ? await assistant.lookNow('manual') : { ok: false, error: '助手尚未初始化' }
      appendLog('[looktest] ' + JSON.stringify(res).slice(0, 400))
      await sleep(2600)
      try { fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG()) } catch (_) {}
      app.quit()
    }, 9000)
    return
  }

  // DSPET_EGGTEST=<png路径>：把彩蛋间隔临时压到 3~5 秒，验证随机敲一下生效
  if (process.env.DSPET_EGGTEST) {
    const out = process.env.DSPET_EGGTEST
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    setTimeout(async () => {
      try { await win.webContents.executeJavaScript('window.__eggTest(3000, 5000)') } catch (e) { appendLog('[egg] arm fail ' + e.message) }
      await new Promise((r) => setTimeout(r, 2500))
      try { appendLog('[egg] groups=' + await win.webContents.executeJavaScript('JSON.stringify(window.__motionGroups ? window.__motionGroups() : null)')) } catch (e) { appendLog('[egg] groups ERR ' + e.message) }
      await sleep(16000)
      try {
        appendLog('[egg] now=' + await win.webContents.executeJavaScript('window.__eggNow()'))
        await sleep(1500)
        fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG())
      } catch (_) {}
      app.quit()
    }, 8000)
    return
  }

  // DSPET_IDLEWATCH=<目录>：什么都不点，只连拍待机画面，看待机动作里有没有道具
  if (process.env.DSPET_IDLEWATCH) {
    const dir = process.env.DSPET_IDLEWATCH
    setTimeout(async () => {
      for (let i = 0; i < 6; i++) {
        try {
          fs.writeFileSync(path.join(dir, 'idle_' + i + '.png'), (await win.webContents.capturePage()).toPNG())
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 1500))
      }
      app.quit()
    }, 8000)
    return
  }

  // DSPET_CURSORTEST=<png路径>：按住不动，让外部脚本移动真实光标，验证窗口是否跟手
  if (process.env.DSPET_CURSORTEST) {
    const out = process.env.DSPET_CURSORTEST
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    setTimeout(async () => {
      appendLog('[cursor] down, bounds=' + JSON.stringify(win.getBounds()))
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 160, y: 300, button: 'left', clickCount: 1 })
      await sleep(14000)
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 160, y: 300, button: 'left', clickCount: 1 })
      await sleep(600)
      appendLog('[cursor] final bounds=' + JSON.stringify(win.getBounds()))
      try { fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG()) } catch (_) {}
      app.quit()
    }, 6000)
    return
  }

  // DSPET_INPUTTEST=<png路径>：用真实输入事件走一遍 拖动 / 单击 / 右键
  if (process.env.DSPET_INPUTTEST) {
    const out = process.env.DSPET_INPUTTEST
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const send = (ev) => win.webContents.sendInputEvent(ev)
    setTimeout(async () => {
      appendLog('[input] start bounds=' + JSON.stringify(win.getBounds()))
      send({ type: 'mouseDown', x: 160, y: 300, button: 'left', clickCount: 1 })
      await sleep(250)
      for (let i = 0; i < 40; i++) {
        // modifiers 必须带 leftButtonDown，否则渲染端 buttons=0 会被判成「鼠标已松开」
        send({ type: 'mouseMove', x: 160 + i * 2, y: 300 + i, button: 'left', modifiers: ['leftButtonDown'] })
        await sleep(25)
      }
      send({ type: 'mouseUp', x: 240, y: 340, button: 'left', clickCount: 1 })
      await sleep(700)
      appendLog('[input] after drag bounds=' + JSON.stringify(win.getBounds()))
      send({ type: 'mouseDown', x: 160, y: 300, button: 'left', clickCount: 1 })
      await sleep(80)
      send({ type: 'mouseUp', x: 160, y: 300, button: 'left', clickCount: 1 })
      await sleep(900)
      try { appendLog('[dump:dur] ' + await win.webContents.executeJavaScript('JSON.stringify(window.__dumpParams ? window.__dumpParams() : {})')) } catch (e) { appendLog('[dump:dur] ERR ' + e.message) }
      await sleep(3600)
      try { appendLog('[dump:after] ' + await win.webContents.executeJavaScript('JSON.stringify(window.__dumpParams ? window.__dumpParams() : {})')) } catch (e) { appendLog('[dump:after] ERR ' + e.message) }
      appendLog('[input] click done bounds=' + JSON.stringify(win.getBounds()))
      send({ type: 'mouseDown', x: 160, y: 300, button: 'right', clickCount: 1 })
      send({ type: 'mouseUp', x: 160, y: 300, button: 'right', clickCount: 1 })
      await sleep(1500)
      try { fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG()) } catch (_) {}
      appendLog('[input] finished')
      app.quit()
    }, 9000)
    return
  }

  // DSPET_DRAGTEST=<png路径>：模拟按住拖动 2 秒，采样缩放状态并截图
  if (process.env.DSPET_DRAGTEST) {
    const out = process.env.DSPET_DRAGTEST
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    setTimeout(async () => {
      const b = win.getBounds()
      const read = async (tag) => {
        try {
          const raw = await win.webContents.executeJavaScript('JSON.stringify(window.__layoutTest ? window.__layoutTest() : {ready:false})')
          const bb = win.getBounds()
          appendLog('[dragtest:' + tag + '] bounds=' + JSON.stringify(bb) + ' ' + raw)
        } catch (e) { appendLog('[dragtest:' + tag + '] ERR ' + e.message) }
      }
      await read('before')
      for (let i = 0; i < 120; i++) {
        // 和拖动逻辑走同一条路径：移动时钉死尺寸
        win.setBounds({
          x: b.x + Math.round(Math.sin(i / 7) * 36),
          y: b.y + Math.round(Math.cos(i / 9) * 12),
          width: design.w,
          height: design.h,
        })
        if (i % 30 === 0) await read('during' + i)
        await sleep(16)
      }
      win.setBounds({ x: b.x, y: b.y, width: design.w, height: design.h })
      await sleep(400)
      await read('after')
      try { fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG()) } catch (_) {}
      app.quit()
    }, 9000)
    return
  }

  const snapPath = process.env.DSPET_SNAP
  if (snapPath) {
    const delay = Number(process.env.DSPET_SNAP_DELAY || 9000)
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage()
        fs.writeFileSync(snapPath, image.toPNG())
        appendLog('[snap] written ' + snapPath)
      } catch (e) {
        appendLog('[snap] failed ' + e.message)
      }
      app.quit()
    }, delay)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) win.show()
  })
}

function defaultPosition(width, height) {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - width - 40,
    y: area.y + area.height - height - 20,
  }
}

function createWindow() {
  const w = cfg.window.width
  const h = cfg.window.height
  design = { w, h }
  let pos = { x: cfg.window.x, y: cfg.window.y }
  if (pos.x === null || pos.y === null || pos.x === undefined) pos = defaultPosition(w, h)
  // 落在屏幕外就拉回右下角
  const area = screen.getPrimaryDisplay().workArea
  if (pos.x < area.x - 50 || pos.x > area.x + area.width - 50 || pos.y < area.y - 50 || pos.y > area.y + area.height - 50) {
    pos = defaultPosition(w, h)
  }

  win = new BrowserWindow({
    width: w,
    height: h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'DS娘桌宠',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  win.setAlwaysOnTop(!!cfg.window.alwaysOnTop, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Windows 上只要被一个全屏窗口盖过一次，topmost 就废了，之后随便什么窗口都能压上来。
  // 所以这里持续刷新层级，并在失焦/被遮挡时立刻重新置顶。
  const keepTop = () => {
    if (!win || win.isDestroyed()) return
    if (cfg.window.alwaysOnTop === false) return
    try { win.setAlwaysOnTop(true, 'screen-saver') } catch (_) {}
  }
  // 刷新间隔可配（window.topRefreshMs，默认 2 秒）；设为 0 则只在失焦时刷新
  const refreshMs = Number(cfg.window.topRefreshMs)
  const topTimer = refreshMs > 0 ? setInterval(keepTop, Math.max(500, refreshMs)) : null
  win.on('blur', keepTop)
  win.on('show', keepTop)
  win.on('closed', () => { if (topTimer) clearInterval(topTimer) })
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'))
  win.once('ready-to-show', () => {
    // 兜底把尺寸钉回设计值，防止创建时被边框补偿撑大
    win.setBounds({ x: pos.x, y: pos.y, width: design.w, height: design.h })
    win.setOpacity(typeof cfg.window.opacity === 'number' ? cfg.window.opacity : 1)
    win.show()
  })
  win.on('closed', () => { win = null })
  win.on('moved', () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveState, 800)
  })
}

function pushState(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('pet:state', payload)
}

function startWatcher() {
  watcher = new StatusWatcher(cfg)
  watcher.on('state', pushState)
  watcher.start()
}

function buildMenu() {
  const template = [
    { label: '看一眼桌面', click: () => { if (assistant) assistant.lookNow('manual') } },
    { label: '随机换装扮', click: () => applyOutfit(outfitMod.randomOutfit(cfg), '随机装扮') },
    { label: '设置…', click: () => openSettings() },
    { type: 'separator' },
    { label: '退出桌宠', click: () => { saveState(); app.quit() } },
  ]
  const menu = Menu.buildFromTemplate(template)
  const t0 = Date.now()
  menu.popup({
    window: win,
    callback: () => appendLog('[menu] closed after ' + (Date.now() - t0) + 'ms'),
  })
  appendLog('[menu] opened')
}

// 换装扮：写盘 + 通知渲染端
function applyOutfit(sel, how) {
  store.mergeConfig(ROOT, { outfit: { selected: sel } })
  cfg.outfit = Object.assign({}, cfg.outfit, { selected: sel })
  if (win && !win.isDestroyed()) win.webContents.send('pet:outfit', sel)
  appendLog('[outfit] ' + how + '：' + outfitMod.describe(sel))
  return sel
}

function applySize(scale) {
  if (!win) return
  const b = win.getBounds()
  const w = Math.round(baseSize.w * scale)
  const h = Math.round(baseSize.h * scale)
  design = { w, h }
  cfg.window.width = w
  cfg.window.height = h
  // 以底边中心为锚点缩放
  const cx = b.x + Math.round(b.width / 2)
  const by = b.y + b.height
  win.setBounds({ x: cx - Math.round(w / 2), y: by - h, width: w, height: h })
  win.webContents.send('pet:resize', { scale })
  saveState()
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return }
  settingsWin = new BrowserWindow({
    width: 620,
    height: 720,
    title: 'DS娘桌宠 · 设置',
    backgroundColor: '#171b21',
    autoHideMenuBar: true,
    center: true,
    show: false,
    // 挂在桌宠窗口下当子窗口：桌宠是置顶的，设置窗跟着就不会被别的窗口压住
    parent: win && !win.isDestroyed() ? win : undefined,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  settingsWin.loadFile(path.join(ROOT, 'settings.html'))
  settingsWin.once('ready-to-show', () => {
    settingsWin.show()
    settingsWin.focus()
    settingsWin.moveTop()   // 免得被最大化的浏览器/视频窗口压在下面
    // 前 2.5 秒强制置顶，保证一定看得见，之后恢复普通层级
    try { settingsWin.setAlwaysOnTop(true, 'floating') } catch (_) {}
    setTimeout(() => { try { settingsWin.setAlwaysOnTop(false) } catch (_) {} }, 2500)
    appendLog('[settings] 窗口已显示 ' + JSON.stringify(settingsWin.getBounds()))
  })
  settingsWin.on('closed', () => { settingsWin = null })
}

app.whenReady().then(() => {
  cfg = loadConfig()
  // 会话目录留空时自动探测（方便别人 clone 下来直接用）
  if (!cfg.watch || !cfg.watch.sessionsRoot) {
    const home = process.env.DSH_HOME || path.join(require('node:os').homedir(), '.dsh')
    cfg.watch = Object.assign({}, cfg.watch, { sessionsRoot: path.join(home, 'sessions') })
  }
  baseSize = { w: cfg.window.width, h: cfg.window.height }

  // 装扮：开着「启动随机」就每次开机随机一套，关掉则沿用上次存下来的
  if (cfg.outfit && cfg.outfit.startupRandom !== false) {
    const sel = outfitMod.randomOutfit(cfg)
    store.mergeConfig(ROOT, { outfit: { selected: sel } })
    cfg.outfit = Object.assign({}, cfg.outfit, { selected: sel })
    appendLog('[outfit] 启动随机装扮：' + outfitMod.describe(sel))
  }
  applyStateToConfig()
  trimLog()
  createWindow()
  if (!process.env.DSPET_DEMO) startWatcher()
  setupDebug()

  ipcMain.handle('pet:config', () => cfg)
  ipcMain.handle('pet:manifest', () => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'model', 'manifest.json'), 'utf8')) } catch (e) { return null }
  })
  ipcMain.handle('pet:status', () => (watcher ? watcher.lastState : null))

  // ---- 小助手：看屏幕 / 聊天 / 记忆 ----
  assistant = new Assistant({
    root: ROOT,
    cfg,
    log: appendLog,
    onReply: (payload) => { if (win && !win.isDestroyed()) win.webContents.send('pet:chat-reply', payload) },
    onStatus: (st) => { if (win && !win.isDestroyed()) win.webContents.send('pet:assistant-status', st) },
  })
  if (!process.env.DSPET_DEMO) assistant.start()

  ipcMain.handle('pet:chat-send', async (_e, text) => {
    if (!assistant) return { ok: false, error: '助手没启动' }
    if (cfg.chat && cfg.chat.enabled === false) return { ok: false, error: '对话功能已在设置里关闭' }
    return assistant.handleUserText(text)
  })
  ipcMain.handle('pet:vision-now', async () => (assistant ? assistant.lookNow('manual') : { ok: false, error: '助手没启动' }))
  ipcMain.handle('pet:new-session', () => (assistant ? assistant.newSession() : null))
  ipcMain.handle('pet:assistant-status', () => (assistant ? assistant.status() : null))
  ipcMain.handle('pet:memory-clear', () => {
    try { fs.writeFileSync(path.join(ROOT, 'memory.txt'), '', 'utf8') } catch (_) {}
    if (assistant) assistant.onStatus(assistant.status())
    return true
  })
  ipcMain.handle('pet:chat-history', () => (assistant ? assistant.chat.readable() : []))

  // ---- 装扮 ----
  ipcMain.handle('pet:outfit-random', () => applyOutfit(outfitMod.randomOutfit(cfg), '随机装扮'))
  ipcMain.handle('pet:outfit-reset', () => applyOutfit(outfitMod.emptyOutfit(cfg), '恢复默认'))
  ipcMain.handle('pet:outfit-set', (_e, sel) => applyOutfit(sel || {}, '手动指定'))

  // ---- 从右键菜单搬到设置窗的几项 ----
  ipcMain.on('pet:set-size', (_e, scale) => applySize(Number(scale) || 1))
  ipcMain.on('pet:set-top', (_e, on) => {
    cfg.window.alwaysOnTop = !!on
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!on, 'screen-saver')
    saveState()
    if (win && !win.isDestroyed()) win.webContents.send('pet:config', cfg)
  })
  ipcMain.on('pet:set-bubble', (_e, on) => {
    cfg.bubble = Object.assign({}, cfg.bubble, { enabled: !!on })
    store.mergeConfig(ROOT, { bubble: { enabled: !!on } })
    if (win && !win.isDestroyed()) win.webContents.send('pet:config', cfg)
  })
  ipcMain.on('pet:reload-model', () => { if (win && !win.isDestroyed()) win.webContents.reload() })
  ipcMain.on('pet:open-path', (_e, which) => {
    const map = { config: CONFIG_PATH, memory: path.join(ROOT, 'memory.txt'), folder: ROOT }
    shell.openPath(map[which] || ROOT)
  })

  // ---- 设置窗 ----
  ipcMain.on('pet:settings-open', () => openSettings())
  ipcMain.handle('pet:settings-get', () => {
    const s = store.publicSettings(ROOT)
    // 附上此刻真实的窗口状态（置顶/气泡是即时生效的，不靠保存）
    s.windowState = {
      alwaysOnTop: win && !win.isDestroyed() ? win.isAlwaysOnTop() : !!cfg.window.alwaysOnTop,
      bubbleEnabled: !!(cfg.bubble && cfg.bubble.enabled),
    }
    return s
  })
  ipcMain.handle('pet:settings-save', (_e, patch) => {
    const out = store.saveSettings(ROOT, patch || {})
    cfg = out.config
    if (assistant) {
      assistant.cfg = cfg
      assistant.stop()
      assistant.start()
    }
    if (win && !win.isDestroyed()) win.webContents.send('pet:config', cfg)
    appendLog('[settings] 已保存')
    return out.settings
  })
  ipcMain.handle('pet:test-connection', async () => {
    const v = Object.assign({}, cfg.vision || {}, { apiKey: store.apiKey(ROOT) })
    const vision = require('./src/vision')
    return vision.ask(v, {
      system: '你是测试助手，只回一句话。',
      userText: '收到请回答：连接正常。',
      thinking: v.thinking || 'off',
      maxTokens: 60,
    })
  })

  ipcMain.on('pet:drag-begin', () => {
    const p = screen.getCursorScreenPoint()
    const b = win.getBounds()
    drag = { offsetX: p.x - b.x, offsetY: p.y - b.y, w: design.w, h: design.h, moves: 0 }
    appendLog('[drag] begin cursor=' + p.x + ',' + p.y + ' bounds=' + JSON.stringify(b))
  })
  ipcMain.on('pet:drag-move', () => {
    if (!drag || !win) return
    const p = screen.getCursorScreenPoint()
    const nx = p.x - drag.offsetX
    const ny = p.y - drag.offsetY
    const b = win.getBounds()
    // 位置没变就别碰窗口：频繁 setBounds 会让 Chromium 丢掉鼠标事件
    if (b.x === nx && b.y === ny && b.width === drag.w && b.height === drag.h) return
    win.setBounds({ x: nx, y: ny, width: drag.w, height: drag.h })
    drag.moves += 1
    if (drag.moves === 1 || drag.moves % 40 === 0) {
      appendLog('[drag] move#' + drag.moves + ' -> ' + JSON.stringify(win.getBounds()))
    }
  })
  ipcMain.on('pet:drag-end', () => {
    appendLog('[drag] end moves=' + (drag ? drag.moves : -1))
    drag = null
    saveState()
  })

  ipcMain.on('pet:context-menu', () => {
    appendLog('[menu] popup requested')
    buildMenu()
  })
  ipcMain.on('pet:quit', () => { saveState(); app.quit() })

  // 调试用：DSPET_QUITAFTER=<毫秒> 到点正常退出（用于验证退出流程）
  const quitAfter = Number(process.env.DSPET_QUITAFTER || 0)
  if (quitAfter > 0) {
    setTimeout(() => { appendLog('[debug] auto quit after ' + quitAfter + 'ms'); app.quit() }, quitAfter)
  }
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  if (watcher) watcher.stop()
  saveState()
})
