// 把 DS 文件夹里的 VTube Studio 模型整理成 DSPet 自包含资源
// 用法: node build_assets.js
// 产出: assets/model/ 下 moc3+贴图+物理+cdi3 + motions/ + exp/ + ds-pet.model3.json + manifest.json
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '..', 'DS')
const OUT = path.join(ROOT, 'assets', 'model')

// 动作文件 → ASCII 名
const MOTION_NAMES = {
  'idle.motion3.json': 'idle',
  'chuipaopao.motion3.json': 'chuipaopao',
  '喷水.motion3.json': 'penshui',
  '开盖.motion3.json': 'kaigai',
  '番茄酱.motion3.json': 'fanqiejiang',
  '自拍.motion3.json': 'zipai',
  '自拍简单.motion3.json': 'zipai_simple',
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function rmDir(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

function main() {
  if (!fs.existsSync(SRC)) throw new Error('找不到源模型目录: ' + SRC)
  rmDir(OUT)
  ensureDir(OUT)
  ensureDir(path.join(OUT, 'motions'))
  ensureDir(path.join(OUT, 'exp'))

  // 1. 主体文件
  const base = ['c_0120.moc3', 'c_0120.physics3.json', 'c_0120.cdi3.json']
  for (const f of base) {
    const from = path.join(SRC, f)
    if (!fs.existsSync(from)) throw new Error('缺少文件: ' + f)
    fs.copyFileSync(from, path.join(OUT, f))
  }

  // 2. 贴图
  const texSrc = path.join(SRC, 'c_0120.2048')
  const texDst = path.join(OUT, 'c_0120.2048')
  ensureDir(texDst)
  const textures = fs.readdirSync(texSrc).filter((f) => f.toLowerCase().endsWith('.png')).sort()
  for (const f of textures) fs.copyFileSync(path.join(texSrc, f), path.join(texDst, f))

  // 3. 动作
  // 注意：VTS 导出的动作 Meta.Loop 全是 true，直接用会被点一下就永久循环
  // （表现是「一直拿道具敲」），所以除待机动作外一律改成播一次
  const motions = {}
  const motionSrc = path.join(SRC, 'motions')
  const copyMotion = (from, to, keepLoop) => {
    const obj = JSON.parse(fs.readFileSync(from, 'utf8'))
    if (obj.Meta && typeof obj.Meta.Loop === 'boolean') obj.Meta.Loop = !!keepLoop
    fs.writeFileSync(to, JSON.stringify(obj, null, 2), 'utf8')
    return obj.Meta && typeof obj.Meta.Duration === 'number' ? obj.Meta.Duration : null
  }
  for (const f of fs.readdirSync(motionSrc).filter((x) => x.endsWith('.motion3.json'))) {
    const ascii = MOTION_NAMES[f]
    if (!ascii) continue
    const keepLoop = ascii === 'idle'
    const duration = copyMotion(path.join(motionSrc, f), path.join(OUT, 'motions', ascii + '.motion3.json'), keepLoop)
    motions[ascii] = { file: 'motions/' + ascii + '.motion3.json', label: f.replace('.motion3.json', ''), loop: keepLoop, duration }
  }
  // aidale：模型作者的「敲一下出包」彩蛋（驱动 Param70 锤子出现）。
  // 不进 Idle 组（循环起来锤子会永驻），单独放 Egg 组供随机彩蛋调用，播一次。
  const aidale = path.join(SRC, 'aidale.motion3.json')
  if (fs.existsSync(aidale)) {
    const duration = copyMotion(aidale, path.join(OUT, 'motions', 'aidale.motion3.json'), false)
    motions['aidale'] = { file: 'motions/aidale.motion3.json', label: 'aidale', loop: false, duration, group: 'Egg', index: 0 }
  }

  // 4. 表情（中文名做 label，文件用编号）
  const exps = []
  const expFiles = fs.readdirSync(SRC)
    .filter((f) => f.endsWith('.exp3.json'))
    .sort((a, b) => a.localeCompare(b, 'zh'))
  expFiles.forEach((f, i) => {
    const idx = String(i + 1).padStart(2, '0')
    const label = f.replace('.exp3.json', '')
    const ascii = 'exp' + idx
    fs.copyFileSync(path.join(SRC, f), path.join(OUT, 'exp', ascii + '.exp3.json'))
    exps.push({ key: ascii, label, file: 'exp/' + ascii + '.exp3.json' })
  })

  // 5. 生成 model3.json（原文件不含 Motions/Expressions，这里补上）
  const model3 = {
    Version: 3,
    FileReferences: {
      Moc: 'c_0120.moc3',
      Textures: textures.map((t) => 'c_0120.2048/' + t),
      Physics: 'c_0120.physics3.json',
      DisplayInfo: 'c_0120.cdi3.json',
      Motions: {
        // 只放官方 idle。aidale 会驱动 Param70「锤子出现」，循环播放等于锤子永驻，
        // 配上 idle 的「锤子旋转」就变成没完没了地敲头（Part162 捶出包）。
        Idle: [
          { File: 'motions/idle.motion3.json', FadeInTime: 0.8, FadeOutTime: 0.8 },
        ],
        Action: ['chuipaopao', 'penshui', 'kaigai', 'fanqiejiang', 'zipai', 'zipai_simple']
          .filter((k) => motions[k])
          .map((k) => ({ File: motions[k].file, FadeInTime: 0.5, FadeOutTime: 0.5 })),
        // 随机彩蛋专用组：只有模型作者那个「敲一下」
        Egg: [{ File: 'motions/aidale.motion3.json', FadeInTime: 0.4, FadeOutTime: 0.8 }],
      },
      Expressions: exps.map((e) => ({ Name: e.key, File: e.file })),
    },
    Groups: [
      { Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] },
      { Target: 'Parameter', Name: 'LipSync', Ids: [] },
    ],
    HitAreas: [{ Id: 'Head', Name: 'Head' }, { Id: 'Body', Name: 'Body' }],
  }
  fs.writeFileSync(path.join(OUT, 'ds-pet.model3.json'), JSON.stringify(model3, null, 2), 'utf8')

  const manifest = {
    model: 'ds-pet.model3.json',
    source: SRC,
    textures: textures.length,
    motions,
    expressions: exps,
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  console.log('motions=' + Object.keys(motions).length + ' expressions=' + exps.length + ' textures=' + textures.length)
  console.log('out=' + OUT)
}

main()
