// 一次性修补 config.json 的装扮分类（避免 edit 工具反复撞上"文件已变"）
// 用法: node _tools/patch_outfit_config.js
const fs = require('node:fs')
const path = require('node:path')

const P = path.resolve(__dirname, '..', 'config.json')
const cfg = JSON.parse(fs.readFileSync(P, 'utf8'))

if (!cfg.outfit || !cfg.outfit.categories) {
  console.error('config.json 里没有 outfit.categories')
  process.exit(1)
}
const cats = cfg.outfit.categories
const log = []

if (cats.hand) {
  cats.hand.label = '手部'
  cats.hand.items = [
    '魔爪',
    { label: '魔爪换色', name: '魔爪变白（会连魔爪一起装上）', also: ['魔爪'] },
    '喵喵手~喵~动画',
  ]
  log.push('hand：删掉「双手比耶」「手机换色」（它们需要手机模式，而手机是动作播放时才出现的，装扮层做不到），'
    + '「魔爪换色」加 also 依赖，选它会自动带上魔爪')
}

if (cats.desk) {
  cats.desk.items = cats.desk.items.filter((it) => (typeof it === 'string' ? it : it && it.label) !== '点菜按下')
  log.push('desk：去掉「点菜按下」（只驱动"手按下"，得有点菜板才看得见）')
}

// 顺手把"当前选中"里已经不存在的项清掉，免得设置窗里显示一个选不中的值
const valid = new Set()
for (const key of Object.keys(cats)) {
  for (const it of cats[key].items || []) valid.add(typeof it === 'string' ? it : it && it.label)
}
for (const key of Object.keys(cfg.outfit.selected || {})) {
  const v = cfg.outfit.selected[key]
  if (v && !valid.has(v)) { cfg.outfit.selected[key] = null; log.push('selected.' + key + ' 清空（' + v + ' 已不在列表里）') }
}

fs.writeFileSync(P, JSON.stringify(cfg, null, 2), 'utf8')
console.log(log.join('\n') || '（无需修补）')
console.log('各分类项数：' + Object.keys(cats).map((k) => (cats[k].label || k) + '(' + (cats[k].items || []).length + ')').join(' '))
