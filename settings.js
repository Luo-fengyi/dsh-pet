// 设置窗逻辑（标签页 / 表单 / 测试连接 / 历史记录）
const $ = (id) => document.getElementById(id)
const msg = $('msg')

function say(text, kind) {
  msg.textContent = text
  msg.className = kind || ''
}

// 标签页
for (const btn of document.querySelectorAll('nav.tabs button')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('nav.tabs button')) b.classList.remove('active')
    for (const p of document.querySelectorAll('.panel')) p.classList.remove('active')
    btn.classList.add('active')
    const panel = $('panel-' + btn.dataset.tab)
    if (panel) panel.classList.add('active')
    if (btn.dataset.tab === 'history') loadHistory()
  })
}

function fill(s) {
  const v = s.vision || {}
  const c = s.chat || {}
  const m = s.memory || {}
  const a = s.appearance || {}

  $('preset').value = v.preset || 'deepseek'
  $('format').value = v.format || ''
  $('endpoint').value = v.endpoint || ''
  $('model').value = v.model || ''
  $('apiKey').value = ''
  $('keyHint').textContent = s.hasKey
    ? ('已保存一份 key（末尾 ' + s.keyTail + '）；留空保存 = 保持原样，填新的 = 覆盖')
    : '没填 key 时，DeepSeek 预设会自动复用 DSH 的凭据'
  $('thinking').value = v.thinking || 'off'

  $('vEnabled').checked = v.enabled !== false
  $('intervalSec').value = Math.round((v.intervalMs || 60000) / 1000)
  $('threshold').value = v.changeThreshold
  $('silentMin').value = v.silentRoundsMin || 4
  $('silentMax').value = v.silentRoundsMax || 8
  $('maxWidth').value = v.maxWidth || 1280
  $('useForeground').checked = v.useForegroundWindow !== false
  $('lookPrompt').value = v.lookPrompt || ''

  $('cEnabled').checked = c.enabled !== false
  $('customPrompt').value = c.customPrompt || ''
  $('maxTurns').value = c.maxTurns || 12
  $('limitTurns').value = c.contextLimitTurns || 20
  $('warnLong').checked = c.warnWhenLong !== false
  $('withScreen').checked = c.sendScreenWithChat !== false
  $('mEnabled').checked = m.enabled !== false

  $('bubbleFontSize').value = a.bubbleFontSize || 13
  $('bubbleMaxRatio').value = a.bubbleMaxRatio || 0.58
  $('chatFontSize').value = a.chatFontSize || 12
}

function collect() {
  const num = (id, fallback) => {
    const n = Number($(id).value)
    return Number.isFinite(n) ? n : fallback
  }
  return {
    vision: {
      enabled: $('vEnabled').checked,
      preset: $('preset').value,
      format: $('format').value,
      endpoint: $('endpoint').value.trim(),
      model: $('model').value.trim(),
      thinking: $('thinking').value,
      intervalMs: Math.max(10, num('intervalSec', 60)) * 1000,
      changeThreshold: Math.min(1, Math.max(0, num('threshold', 0.02))),
      silentRoundsMin: Math.max(1, num('silentMin', 4)),
      silentRoundsMax: Math.max(1, num('silentMax', 8)),
      maxWidth: Math.min(1920, Math.max(480, num('maxWidth', 1280))),
      useForegroundWindow: $('useForeground').checked,
      lookPrompt: $('lookPrompt').value.trim(),
    },
    chat: {
      enabled: $('cEnabled').checked,
      customPrompt: $('customPrompt').value,
      maxTurns: Math.max(1, num('maxTurns', 12)),
      contextLimitTurns: Math.max(2, num('limitTurns', 20)),
      warnWhenLong: $('warnLong').checked,
      sendScreenWithChat: $('withScreen').checked,
    },
    memory: { enabled: $('mEnabled').checked },
    appearance: {
      bubbleFontSize: num('bubbleFontSize', 13),
      bubbleMaxRatio: num('bubbleMaxRatio', 0.58),
      chatFontSize: num('chatFontSize', 12),
    },
  }
}

async function refreshMemory() {
  try {
    const st = await window.pet.getAssistantStatus()
    $('memoryView').textContent = st && st.memory ? st.memory : '（空）'
  } catch (_) {
    $('memoryView').textContent = '（读不到）'
  }
}

function timeText(at) {
  if (!at) return ''
  const d = new Date(at)
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

async function loadHistory() {
  const list = $('historyList')
  try {
    const items = await window.pet.getChatHistory()
    if (!items || !items.length) {
      list.innerHTML = '<div class="empty">还没有聊过</div>'
      return
    }
    list.innerHTML = ''
    for (const it of items.slice(-200)) {
      const div = document.createElement('div')
      div.className = 'msg ' + (it.role === 'user' ? 'me' : 'her')
      div.textContent = it.text
      const t = document.createElement('span')
      t.className = 'time'
      t.textContent = (it.role === 'user' ? '我 ' : 'DS娘 ') + timeText(it.at)
      div.appendChild(t)
      list.appendChild(div)
    }
    list.scrollTop = list.scrollHeight
  } catch (e) {
    list.innerHTML = '<div class="empty">读历史失败：' + (e && e.message ? e.message : e) + '</div>'
  }
}

$('save').addEventListener('click', async () => {
  $('save').disabled = true
  say('保存中…', 'busy')
  try {
    const patch = collect()
    const key = $('apiKey').value.trim()
    if (key) patch.apiKey = key
    const next = await window.pet.settingsSave(patch)
    fill(next)
    say('已保存，桌宠立刻生效', 'ok')
    refreshMemory()
  } catch (e) {
    say('保存失败：' + (e && e.message ? e.message : e), 'err')
  } finally {
    $('save').disabled = false
  }
})

$('test').addEventListener('click', async () => {
  $('test').disabled = true
  say('正在测试连接…', 'busy')
  try {
    const res = await window.pet.settingsTest()
    if (res && res.ok) say('连接正常：' + String(res.text).slice(0, 60), 'ok')
    else say('连接失败：' + ((res && res.error) || '未知错误'), 'err')
  } catch (e) {
    say('测试出错：' + (e && e.message ? e.message : e), 'err')
  } finally {
    $('test').disabled = false
  }
})

$('clearMemory').addEventListener('click', async () => {
  await window.pet.clearMemory()
  say('记忆已清空', 'ok')
  refreshMemory()
})

$('refreshHistory').addEventListener('click', () => loadHistory())

$('clearHistory').addEventListener('click', async () => {
  await window.pet.newSession()
  say('已新开会话（历史清空）', 'ok')
  loadHistory()
})

;(async () => {
  try {
    const s = await window.pet.settingsGet()
    fill(s)
    refreshMemory()
    console.log('[settings] 配置已载入 preset=' + (s.vision && s.vision.preset) + ' 有key=' + s.hasKey)
  } catch (e) {
    say('读取配置失败：' + (e && e.message ? e.message : e), 'err')
    console.log('[settings] 载入失败 ' + (e && e.message))
  }
})()
