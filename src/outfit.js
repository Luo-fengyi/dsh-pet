// 装扮的随机逻辑（主进程与设置窗共用）
// 分类与候选项来自 config.json 的 outfit.categories

// 每一类按 chance 概率挑一件，没挑中就留空（不然每次都会全副武装）
function randomOutfit(cfg, chance) {
  const cats = (cfg.outfit && cfg.outfit.categories) || {}
  const p = typeof chance === 'number' ? chance : 0.7
  const sel = {}
  for (const key of Object.keys(cats)) {
    const items = (cats[key] && cats[key].items) || []
    sel[key] = items.length && Math.random() < p ? items[Math.floor(Math.random() * items.length)] : null
  }
  return sel
}

function emptyOutfit(cfg) {
  const cats = (cfg.outfit && cfg.outfit.categories) || {}
  const sel = {}
  for (const key of Object.keys(cats)) sel[key] = null
  return sel
}

function describe(sel) {
  const picked = Object.keys(sel || {}).map((k) => sel[k]).filter(Boolean)
  return picked.length ? picked.join('、') : '（无）'
}

module.exports = { randomOutfit, emptyOutfit, describe }
