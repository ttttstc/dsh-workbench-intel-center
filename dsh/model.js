/**
 * 情报卡片的数据模型与校验。
 *
 * 服务端与测试共用：所有写入磁盘的数据先过这里，模型/Agent 写坏格式时给出明确中文错误，
 * 不把脏数据落库。客户端提交的字段一律截断到上限，避免一条超长文本撑爆界面或文件。
 */

export const MAX_CARDS = 500
export const MAX_SUMMARY = 6
export const MAX_FACTS = 12
export const MAX_LIST = 8
export const MAX_SOURCES = 6
export const MAX_NOTE = 2000
export const MAX_TEXT = 400

export const STATUSES = ['confirmed', 'pending']
export const FLAGS = ['none', 'watch', 'shortlist', 'used', 'dropped']

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
    id: text(raw.id, 64) || `card-${index + 1}`,
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
    timeExact: raw.timeExact === false ? false : true,
    score: Number.isFinite(Number(raw.score)) ? Math.max(0, Math.min(100, Math.round(Number(raw.score)))) : 0,
    verdict: text(raw.verdict, 20) || (raw.verified === true ? 'free' : 'unknown'),
    verified: raw.verified === true,
    excerpt: text(raw.excerpt, 400)
  }
}

function normalizeFeed(raw, prefix = 'feed') {
  if (!isPlainObject(raw)) return { updatedAt: '', date: '', keywords: [], items: [] }
  const items = []
  if (Array.isArray(raw.items)) {
    for (const [i, item] of raw.items.entries()) {
      const next = normalizeFeedItem(item, i, prefix)
      if (next) items.push(next)
      if (items.length >= 500) break
    }
  }
  return {
    updatedAt: text(raw.updatedAt, 40),
    date: text(raw.date, 20),
    keywords: textList(raw.keywords, 6, 20),
    items
  }
}

/** 把任意输入规整成合法状态；结构性错误直接抛 ValidationError。 */
export function normalizeState(raw) {
  if (!isPlainObject(raw)) throw new ValidationError('状态必须是一个对象。')

  const cardsRaw = Array.isArray(raw.cards) ? raw.cards : []
  if (cardsRaw.length > MAX_CARDS) throw new ValidationError(`卡片数量超过上限 ${MAX_CARDS} 张。`)

  const cards = cardsRaw.map(normalizeCard)

  const seen = new Set()
  for (const card of cards) {
    if (seen.has(card.id)) throw new ValidationError(`卡片 id 重复：${card.id}`)
    seen.add(card.id)
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

/** 供客户端/测试使用的空状态。 */
export function emptyState() {
  return { version: 1, cards: [], topics: [], lastReviewedAt: '', updatedAt: '' }
}
