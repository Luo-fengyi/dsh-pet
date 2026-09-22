const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pet', {
  // 基础
  getConfig: () => ipcRenderer.invoke('pet:config'),
  getManifest: () => ipcRenderer.invoke('pet:manifest'),
  getStatus: () => ipcRenderer.invoke('pet:status'),
  onState: (cb) => ipcRenderer.on('pet:state', (_e, payload) => cb(payload)),
  onConfig: (cb) => ipcRenderer.on('pet:config', (_e, payload) => cb(payload)),
  onResize: (cb) => ipcRenderer.on('pet:resize', (_e, payload) => cb(payload)),
  dragBegin: () => ipcRenderer.send('pet:drag-begin'),
  dragMove: () => ipcRenderer.send('pet:drag-move'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  contextMenu: () => ipcRenderer.send('pet:context-menu'),
  quit: () => ipcRenderer.send('pet:quit'),

  // 小助手（看屏幕 / 聊天 / 记忆）
  chatSend: (text) => ipcRenderer.invoke('pet:chat-send', text),
  visionNow: () => ipcRenderer.invoke('pet:vision-now'),
  newSession: () => ipcRenderer.invoke('pet:new-session'),
  getAssistantStatus: () => ipcRenderer.invoke('pet:assistant-status'),
  clearMemory: () => ipcRenderer.invoke('pet:memory-clear'),
  getChatHistory: () => ipcRenderer.invoke('pet:chat-history'),
  onChatReply: (cb) => ipcRenderer.on('pet:chat-reply', (_e, payload) => cb(payload)),
  onAssistantStatus: (cb) => ipcRenderer.on('pet:assistant-status', (_e, payload) => cb(payload)),

  // 装扮
  outfitRandom: () => ipcRenderer.invoke('pet:outfit-random'),
  outfitReset: () => ipcRenderer.invoke('pet:outfit-reset'),
  outfitSet: (sel) => ipcRenderer.invoke('pet:outfit-set', sel),
  onOutfit: (cb) => ipcRenderer.on('pet:outfit', (_e, payload) => cb(payload)),

  // 从右键菜单搬到设置窗的几项
  setSize: (scale) => ipcRenderer.send('pet:set-size', scale),
  setTop: (on) => ipcRenderer.send('pet:set-top', on),
  setBubble: (on) => ipcRenderer.send('pet:set-bubble', on),
  reloadModel: () => ipcRenderer.send('pet:reload-model'),
  openPath: (which) => ipcRenderer.send('pet:open-path', which),

  // 设置窗
  settingsGet: () => ipcRenderer.invoke('pet:settings-get'),
  settingsSave: (patch) => ipcRenderer.invoke('pet:settings-save', patch),
  settingsTest: () => ipcRenderer.invoke('pet:test-connection'),
  openSettings: () => ipcRenderer.send('pet:settings-open'),
})
