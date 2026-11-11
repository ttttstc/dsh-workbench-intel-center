/**
 * 情报卡片的数据模型与校验。
 *
 * 服务端与测试共用：所有写入磁盘的数据先过这里，模型/Agent 写坏格式时给出明确中文错误，
 * 不把脏数据落库。客户端提交的字段一律截断到上限，避免一条超长文本撑爆界面或文件。
 */

export const MAX_CARDS = 500
export const MAX_FEED_ITEMS = 500
export const MAX_SUMMARY = 6
export const MAX_FACTS = 12
export const MAX_LIST = 8
export const MAX_SOURCES = 6
export const MAX_NOTE = 2000
export const MAX_TEXT = 400

export const STATUSES = ['confirmed', 'pending']
export const FLAGS = ['none', 'watch', 'shortlist', 'used', 'dropped']

/**
 * 三份外部榜单（linux.do / X / 羊毛雷达）由抓取任务与 Agent 写，卡片与主题由用户写。
 * 两边的写入通道不同（界面 POST 整份状态 vs. Agent 直接改文件），所以谁拥有哪个字段要写死在这里。
 */
export const FEED_KEYS = ['linuxdo', 'x', 'radar']

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'ValidationError'
    this.status = status
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function text(value, limit = MAX_TEXT) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit)
}

function textList(value, limit, itemLimit = MAX_TEXT) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    const next = text(item, itemLimit)
    if (next) out.push(next)
    if (out.length >= limit) break
  }
  return out
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

function normalizeSource(raw) {
  if (typeof raw === 'string') {
    const url = text(raw, 600)
    return url ? { title: '', url } : null
  }
  if (!isPlainObject(raw)) return null
  const url = text(raw.url, 600)
  const title = text(raw.title, 160)
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) return null
  return { title, url }
}

function normalizeFact(raw, index) {
  if (!isPlainObject(raw)) return null
  const label = text(raw.label, 80)
  const value = text(raw.value, 240)
  if (!label && !value) return null
  return { label: label || `要点 ${index + 1}`, value }
}

function normalizeCard(raw, index) {
  if (!isPlainObject(raw)) throw new ValidationError(`第 ${index + 1} 张卡片不是对象。`)
  const title = text(raw.title, 200)
  if (!title) throw new ValidationError(`第 ${index + 1} 张卡片缺少标题。`)

  const scoreRaw = Number(raw.score)
  const score = Number.isFinite(scoreRaw) ? Math.min(5, Math.max(1, Math.round(scoreRaw))) : 3

  const status = STATUSES.includes(raw.status) ? raw.status : 'pending'
  const flag = FLAGS.includes(raw.flag) ? raw.flag : 'none'

  const facts = []
  if (Array.isArray(raw.facts)) {
    for (const [i, item] of raw.facts.entries()) {
      const fact = normalizeFact(item, i)
      if (fact) facts.push(fact)
      if (facts.length >= MAX_FACTS) break
    }
  }

  const sources = []
  if (Array.isArray(raw.sources)) {
    for (const item of raw.sources) {
      const source = normalizeSource(item)
      if (source) sources.push(source)
      if (sources.length >= MAX_SOURCES) break
    }
  }

  const verifiedAt = isDate(text(raw.verifiedAt, 10)) ? text(raw.verifiedAt, 10) : ''

  return {
    id: text(raw.id, 64),
    title,
    category: text(raw.category, 40) || '未分类',
    tags: textList(raw.tags, 8, 24),
    priority: raw.priority === 'high' ? 'high' : 'normal',
    summary: textList(raw.summary, MAX_SUMMARY),
    facts,
    pros: textList(raw.pros, MAX_LIST),
    cons: textList(raw.cons, MAX_LIST),
    score,
    scoreReason: text(raw.scoreReason, 240),
    status,
    verifiedAt,
    sources,
    note: text(raw.note, MAX_NOTE),
    flag,
    nextAction: text(raw.nextAction, 300),
    signup: text(raw.signup, 160),
    updatedAt: text(raw.updatedAt, 40)
  }
}

function normalizeTopic(raw, index) {
  if (!isPlainObject(raw)) return null
  const title = text(raw.title, 120)
  if (!title) return null
  return {
    id: text(raw.id, 64) || `topic-${index + 1}`,
    title,
    note: text(raw.note, 300)
  }
}

/** 外部榜单（linux.do 站内 / X）：由 AI 会话或抓取脚本写回，展示层只认这个结构。 */
function normalizeFeedItem(raw, index, prefix) {
  if (!isPlainObject(raw)) return null
  const title = text(raw.title, 400)
  if (!title) return null
  const url = text(raw.url, 600)
  const count = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
    const raw = String(value ?? '').trim()
    if (!raw) return 0
    const m = raw.match(/^([\d.,]+)\s*(万|千|[KkMm])?$/)
    if (!m) return 0
    let n = Number.parseFloat(m[1].replace(/,/g, ''))
    if (!Number.isFinite(n) || n < 0) return 0
    const unit = (m[2] || '').toUpperCase()
    if (unit === '万') n *= 1e4
    else if (unit === '千' || unit === 'K') n *= 1e3
    else if (unit === 'M') n *= 1e6
    return Math.round(n)
  }
  return {
    id: text(raw.id, 80) || `${prefix}-${index + 1}`,
    rank: count(raw.rank) || index + 1,
    title,
    url: /^https?:\/\//i.test(url) ? url : '',
    author: text(raw.author, 80),
    handle: text(raw.handle, 80),
    source: text(raw.source, 24),
    category: text(raw.category, 60),
    likes: count(raw.likes),
    replies: count(raw.replies),
    reposts: count(raw.reposts),
    views: count(raw.views),
    createdAt: text(raw.createdAt, 40),
    // 带截止时间的来源（Epic 限免）会写这一项；过了截止时间抓取合并时就下版。
    expiresAt: Number.isFinite(Date.parse(text(raw.expiresAt, 40))) ? text(raw.expiresAt, 40) : '',
    timeExact: raw.timeExact === false ? false : true,
    score: Number.isFinite(Number(raw.score)) ? Math.max(0, Math.min(100, Math.round(Number(raw.score)))) : 0,
    verdict: text(raw.verdict, 20) || (raw.verified === true ? 'free' : 'unknown'),
    verified: raw.verified === true,
    excerpt: text(raw.excerpt, 400)
  }
}

function normalizeFeed(raw, prefix = 'feed') {
  if (!isPlainObject(raw)) return emptyFeed()
  const items = []
  const seen = new Set()
  if (Array.isArray(raw.items)) {
    for (const [i, item] of raw.items.entries()) {
      const next = normalizeFeedItem(item, i, prefix)
      if (!next) continue
      // id 撞车会让界面列表 key 重复、排名错乱；重复的只留第一条。
      if (seen.has(next.id)) continue
      seen.add(next.id)
      items.push(next)
      if (items.length >= MAX_FEED_ITEMS) break
    }
  }
  return {
    updatedAt: text(raw.updatedAt, 40),
    date: text(raw.date, 20),
    keywords: textList(raw.keywords, 6, 20),
    items
  }
}

function emptyFeed() {
  return { updatedAt: '', date: '', keywords: [], items: [] }
}

/**
 * 卡片缺 id 时的稳定身份：由标题 + 分类算哈希。
 *
 * 以前用「第几张卡片」当 id，Agent 每写回一次、顺序一变，id 全变，
 * 提示词里「按 id 更新，不要改 id」就落空了，界面上的展开态与引用也跟着错位。
 */
function stableCardId(card) {
  const seed = `${card.title}|${card.category}`
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `card-${(hash >>> 0).toString(36)}`
}

/** 把任意输入规整成合法状态；结构性错误直接抛 ValidationError。 */
export function normalizeState(raw) {
  if (!isPlainObject(raw)) throw new ValidationError('状态必须是一个对象。')

  const cardsRaw = Array.isArray(raw.cards) ? raw.cards : []
  if (cardsRaw.length > MAX_CARDS) throw new ValidationError(`卡片数量超过上限 ${MAX_CARDS} 张。`)

  const cards = []
  const seen = new Set()
  for (const [index, item] of cardsRaw.entries()) {
    const card = normalizeCard(item, index)
    const given = card.id
    let id = given || stableCardId(card)
    if (seen.has(id)) {
      // 显式写了重复 id 是数据错误，要报出来；自动生成的撞车（同标题同分类）只加后缀。
      if (given) throw new ValidationError(`卡片 id 重复：${id}`)
      let suffix = 2
      while (seen.has(`${id}-${suffix}`)) suffix += 1
      id = `${id}-${suffix}`
    }
    card.id = id
    seen.add(id)
    cards.push(card)
  }

  const topics = []
  if (Array.isArray(raw.topics)) {
    for (const [i, item] of raw.topics.entries()) {
      const topic = normalizeTopic(item, i)
      if (topic) topics.push(topic)
      if (topics.length >= 20) break
    }
  }

  return {
    version: 1,
    cards,
    topics,
    linuxdo: normalizeFeed(raw.linuxdo, 'ld'),
    x: normalizeFeed(raw.x, 'x'),
    radar: normalizeFeed(raw.radar, 'rd'),
    lastReviewedAt: text(raw.lastReviewedAt, 40),
    updatedAt: text(raw.updatedAt, 40)
  }
}

/**
 * 合并一次「整份状态」写入。
 *
 * 界面每次保存都会把整份状态发回来，包括它读到的那份榜单。若直接覆盖：用户在抓取任务
 * 刚写完榜单后改一张卡片的备注，就会把刚抓到的条目悄悄抹掉（反过来 Agent 写文件也可能
 * 覆盖用户刚改的备注）。规则在这里写死——
 * - 卡片 / 主题 / lastReviewedAt 归用户，永远采用来件；
 * - 三份榜单归抓取任务与 Agent，只有来件的 updatedAt 确实更新时才采用，否则沿用磁盘上的。
 * 想清空某份榜单，就带着新的 updatedAt 写一份空 items（这是明确意图，不会被当成旧数据）。
 */
export function mergeState(current, incoming) {
  const stored = isPlainObject(current) ? current : {}
  const next = { ...(isPlainObject(incoming) ? incoming : {}) }
  for (const key of FEED_KEYS) {
    const kept = stored[key]
    const sent = next[key]
    if (!isPlainObject(sent)) {
      if (kept) next[key] = kept
      continue
    }
    const keptAt = Date.parse(kept?.updatedAt || '')
    const sentAt = Date.parse(sent.updatedAt || '')
    const newer = Number.isFinite(sentAt) && (!Number.isFinite(keptAt) || sentAt > keptAt)
    if (!newer) next[key] = kept || sent
  }
  return next
}

/**
 * 读取磁盘时的容错：一条缺标题或 id 重复的卡片，不该让整份文件打不开、连带所有抓取失败。
 * 写入仍走 normalizeState 的严格校验（坏数据进不了库）；这里只处理「已经坏在磁盘上」的情况，
 * 把坏卡片丢掉并报告丢了几张。
 */
export function normalizeStoredState(raw) {
  try {
    return { state: normalizeState(raw), dropped: 0 }
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
  }
  const storedCards = Array.isArray(raw?.cards) ? raw.cards.slice(0, MAX_CARDS) : []
  const cards = []
  const seen = new Set()
  for (const item of storedCards) {
    let card
    try {
      card = normalizeCard(item, cards.length)
    } catch {
      continue
    }
    const id = card.id || stableCardId(card)
    if (seen.has(id)) continue
    card.id = id
    seen.add(id)
    cards.push(card)
  }
  const state = normalizeState({ ...raw, cards })
  return { state, dropped: storedCards.length - cards.length }
}

/** 供客户端/测试使用的空状态。 */
export function emptyState() {
  return {
    version: 1,
    cards: [],
    topics: [],
    linuxdo: emptyFeed(),
    x: emptyFeed(),
    radar: emptyFeed(),
    lastReviewedAt: '',
    updatedAt: ''
  }
}
