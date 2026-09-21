// 用 token 调 GitHub API：建仓库 + 设置话题标签
// 用法: $env:GH_TOKEN='ghp_xxx'; node --use-env-proxy _tools/gh_api.js
const token = process.env.GH_TOKEN
if (!token) { console.error('缺少 GH_TOKEN 环境变量'); process.exit(1) }

const USER = process.env.GH_USER || 'Luo-fengyi'
const REPO = process.env.GH_REPO || 'dsh-pet'

async function api(path, opts) {
  const res = await fetch('https://api.github.com' + path, Object.assign({}, opts, {
    headers: Object.assign({
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-pet',
      'content-type': 'application/json',
    }, (opts && opts.headers) || {}),
  }))
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  return { status: res.status, json, text }
}

;(async () => {
  // 0. token 是谁的、有没有 repo 权限
  const me = await api('/user')
  console.log('token 归属: ' + (me.json ? me.json.login : '?') + '  (HTTP ' + me.status + ')')
  if (!me.json || !me.json.login) { console.log(me.text.slice(0, 300)); process.exit(1) }
  const scopes = me.json ? '' : ''
  void scopes

  // 1. 建仓库
  console.log('创建仓库 ' + USER + '/' + REPO + ' …')
  const created = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: REPO,
      description: 'DS娘桌宠：Live2D 桌面宠物，跟随 DSH 会话状态变脸，能看屏幕、聊天、长期记忆',
      private: false,
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    }),
  })
  if (created.status === 201) {
    console.log('建好了: ' + created.json.html_url)
  } else if (created.status === 422) {
    console.log('仓库已存在，跳过创建（HTTP 422）')
  } else {
    console.log('创建失败 HTTP ' + created.status + '：' + created.text.slice(0, 300))
    process.exit(1)
  }

  // 2. 设话题标签（搜索友好）
  const topics = await api('/repos/' + USER + '/' + REPO + '/topics', {
    method: 'PUT',
    body: JSON.stringify({ names: ['electron', 'live2d', 'desktop-pet', 'deepseek-harness', 'cubism', 'windows'] }),
  })
  console.log('话题标签: HTTP ' + topics.status + (topics.json && topics.json.names ? ' -> ' + topics.json.names.join(', ') : ''))

  // 3. 仓库现状
  const info = await api('/repos/' + USER + '/' + REPO)
  if (info.json) {
    console.log('仓库: ' + info.json.full_name + '  默认分支=' + (info.json.default_branch || '（还没推）') +
      '  公开=' + (!info.json.private) + '  大小=' + info.json.size + 'KB')
  }
})()
