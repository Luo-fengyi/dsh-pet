// 纯 Node 下测试 vision.js 与 chat.js（不涉及 Electron）
// 用法: node _tools/test_assistant.js
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const vision = require(path.join(ROOT, 'src', 'vision'))
const { Chat } = require(path.join(ROOT, 'src', 'chat'))

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))
const out = []
const say = (s) => { out.push(s); console.log(s) }

async function main() {
  // 1) 预设解析
  const api = vision.resolveApi({ preset: 'deepseek' })
  say('resolveApi(deepseek) -> kind=' + api.kind + ' model=' + api.model + ' 有key=' + !!api.key + ' endpoint=' + api.endpoint.slice(0, 45) + '…')
  const api2 = vision.resolveApi({ preset: 'custom', endpoint: 'https://x/v1/chat/completions', model: 'm', apiKey: 'k' })
  say('resolveApi(custom) -> kind=' + api2.kind + ' 有key=' + !!api2.key)

  // 2) 真的调一次（带图）——找不到示例图就跳过
  const imgPath = path.join(ROOT, '..', 'DS', 'icon.png')
  if (fs.existsSync(imgPath)) {
    const img = fs.readFileSync(imgPath)
    const res = await vision.ask({ preset: 'deepseek', thinking: 'off', maxTokens: 120 }, {
      system: '你是测试助手，只回一句话。',
      userText: '这张图是什么？一句话。',
      image: { base64: img.toString('base64'), mediaType: 'image/png' },
      thinking: 'off',
      maxTokens: 120,
    })
    say('vision.ask -> ok=' + res.ok + (res.ok ? (' ms=' + res.ms + ' usage=' + JSON.stringify(res.usage)) : (' err=' + res.error)))
    if (res.ok) say('  回复：' + res.text.replace(/\s+/g, ' ').slice(0, 120))
  } else {
    say('跳过看图测试（没有 ' + imgPath + '，可传图片路径：node _tools/test_assistant.js <图片>）')
  }

  // 3) 记忆与提示词
  const chat = new Chat(ROOT, cfg)
  const rolled = chat.maybeRollSession()
  say('maybeRollSession -> rolled=' + rolled.rolled + ' session=' + rolled.sessionId)
  chat.push('user', '你好')
  chat.push('assistant', '嗨')
  say('轮数=' + chat.turnCount() + ' 是否过长=' + chat.isTooLong())
  const split = chat.splitMemory('好的我知道啦\n[记忆] 用户喜欢在深夜写代码')
  say('splitMemory -> text="' + split.text + '" memories=' + JSON.stringify(split.memories))
  const prompt = chat.systemPrompt()
  say('systemPrompt 长度=' + prompt.length + ' 含内置人设=' + prompt.includes('DS娘'))
  const before = chat.loadMemory()
  say('当前记忆长度=' + before.length + '（内容：' + before.slice(0, 60) + '）')

  fs.writeFileSync(path.join(__dirname, 'assistant_test_result.txt'), out.join('\n'), 'utf8')
}

main().catch((e) => { console.log('ERR ' + e.message) })
