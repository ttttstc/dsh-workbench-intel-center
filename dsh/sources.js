/**
 * 羊毛雷达的数据源（四个，全部真实抓取）。
 *
 * 直连：
 * - V2EX · 优惠信息  https://www.v2ex.com/feed/deals.xml （官方 Atom，不用会 403 的 JSON API）
 * - 小众软件        https://www.appinn.com/feed/ （官方 RSS）
 * - LINUX DO · 福利羊毛 https://linux.do/c/welfare/36.rss （category 36；可能被 Cloudflare 拦）
 * 浏览器：
 * - NodeSeek · 推广/情报 https://www.nodeseek.com/categories/promotion （Cloudflare，必须借浏览器）
 * - LINUX DO 直连失败时，用浏览器页面内 fetch 补抓
 *
 * 收录规则集中在 KEYWORDS / CATEGORIES / buildRadar，改词表即可调整口径。
 */

export const SOURCES = [
  { id: 'linuxdo', name: 'LINUX DO 福利羊毛', home: 'https://linux.do/c/welfare/36', kind: 'both' },
  { id: 'appinn', name: '小众软件', home: 'https://www.appinn.com/', kind: 'direct' },
  { id: 'nodeseek', name: 'NodeSeek 推广情报', home: 'https://www.nodeseek.com/categories/promotion', kind: 'browser' },
  { id: 'v2ex', name: 'V2EX 优惠信息', home: 'https://www.v2ex.com/go/deals', kind: 'direct' }
]

/** 收录关键词：标题或摘要命中任一才进榜。 */
// 关键词不分层级，全部等权：命中任意一个即进入收集范围。
export const KEYWORDS = [
  '羊毛', '薅', '免费', '白嫖', '限免', '0 元', '0元', '低价', '折扣', '优惠',
  '福利', '抽奖', '红包', '秒杀', '团购', '试用', '白送', '便宜', '省钱',
  '优惠券', '折扣码', '返现', '补贴', '特价', '送', '领'
]

/** 三个标签，顺序即判定优先级（先限免，再免费，最后低价）。 */
export const CATEGORIES = [
  { id: 'limited', name: '限免', words: ['限免', '限时免费', '限时', '最后一天', '即将结束', '截止'] },
  { id: 'free', name: '免费', words: ['免费', '白嫖', '0 元', '0元', '白给', '赠送', '领取', '试用', '白送', '福利', '抽奖'] },
  { id: 'cheap', name: '低价', words: ['低价', '优惠', '折扣', '特价', '降价', '券', '补贴', '促销', '立减', '首月', '元/月', '红包', '秒杀', '团购', '返现', '便宜', '省钱'] }
]

export const MAX_AGE_DAYS = 7
/** 雷达在库上限：一处定义，抓取合并、接口状态与界面文案共用。 */
export const MAX_RADAR_ITEMS = 500

const NOISE = ['招聘', '求职', '面试', '房源', '租房', '征友']

const norm = (value) => String(value ?? '').toLowerCase()

export function classify(text) {
  const haystack = norm(text)
  for (const category of CATEGORIES) {
    if (category.words.some((word) => haystack.includes(norm(word)))) return category.id
  }
  return 'other'
}

export function matchesKeywords(text) {
  const haystack = norm(text)
  return KEYWORDS.some((word) => haystack.includes(norm(word)))
}


export function isNoise(text) {
  const haystack = norm(text)
  return NOISE.some((word) => haystack.includes(norm(word)))
}

export function withinDays(createdAt, days = MAX_AGE_DAYS, now = Date.now()) {
  const time = Date.parse(createdAt)
  if (Number.isNaN(time)) return false
  return now - time <= days * 24 * 60 * 60 * 1000
}

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** RSS 2.0（小众软件 / Discourse）。 */
export function parseRss(xml, { source, linkBase = '' } = {}) {
  const items = []
  for (const block of String(xml || '').split(/<item[ >]/).slice(1)) {
    const title = stripHtml((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1])
    const link = stripHtml((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1])
    const pub = stripHtml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1])
    const desc = stripHtml((block.match(/<description>([\s\S]*?)<\/description>/) || [])[1]).slice(0, 200)
    if (!title || !link) continue
    const created = Date.parse(pub)
    items.push({
      source,
      title,
      url: link.startsWith('http') ? link : linkBase + link,
      excerpt: desc,
      createdAt: Number.isNaN(created) ? new Date().toISOString() : new Date(created).toISOString(),
      heat: 0
    })
  }
  return items
}

/** Atom（V2EX 官方源）。 */
export function parseAtom(xml, { source } = {}) {
  const items = []
  for (const block of String(xml || '').split(/<entry>/).slice(1)) {
    const title = stripHtml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1])
    const href = (block.match(/<link[^>]+href="([^"]+)"/) || [])[1]
    const updated = stripHtml((block.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1])
    const summary = stripHtml((block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1]).slice(0, 200)
    if (!title || !href) continue
    const created = Date.parse(updated)
    items.push({
      source,
      title,
      url: href,
      excerpt: summary,
      createdAt: Number.isNaN(created) ? new Date().toISOString() : new Date(created).toISOString(),
      heat: 0
    })
  }
  return items
}

/** NodeSeek 分类页 HTML：抓 /post-<id>-<n> 链接与标题。 */
export function parseNodeSeek(html, { now = new Date().toISOString() } = {}) {
  const text = String(html || '')
  const items = []
  const seen = new Set()
  const re = /<a[^>]+href="(\/post-\d+-\d+)"[^>]*>([^<]{2,160})<\/a>/g
  let match
  while ((match = re.exec(text)) !== null) {
    const url = 'https://www.nodeseek.com' + match[1]
    const title = stripHtml(match[2])
    if (!title || seen.has(url)) continue
    seen.add(url)
    // 标题后面紧跟的区块里有该帖最后活跃时间（time datetime），用它当时间轴，
    // 取不到才退回抓取时刻——这样列表不会被统一刷成「刚刚」。
    const window = text.slice(match.index, match.index + 2200)
    const stamp = (window.match(/<time[^>]+datetime="([^"]+)"/) || [])[1]
    const parsed = stamp ? Date.parse(stamp) : NaN
    const exact = !Number.isNaN(parsed)
    items.push({
      source: 'nodeseek',
      title,
      url,
      excerpt: '',
      // 没有可靠时间就给抓取时刻，但标记 timeExact=false，界面显示「最近活跃」而不是「刚刚」。
      createdAt: exact ? new Date(parsed).toISOString() : now,
      timeExact: exact,
      heat: 0
    })
  }
  return items
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function getText(url, { fetchImpl = fetch, timeoutMs = 15000, accept = '*/*' } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': UA, accept, 'cache-control': 'no-cache', pragma: 'no-cache' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`返回 ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

/** V2EX 优惠信息：官方 Atom。 */
export async function fetchV2ex({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://www.v2ex.com/feed/deals.xml', {
      fetchImpl,
      accept: 'application/atom+xml,application/xml,text/xml,*/*'
    })
    return { items: parseAtom(xml, { source: 'v2ex' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`V2EX 优惠信息：${error?.message || error}`] }
  }
}

/** 小众软件：官方 RSS。 */
export async function fetchAppinn({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://www.appinn.com/feed/', {
      fetchImpl,
      accept: 'application/rss+xml,application/xml,text/xml,*/*'
    })
    return { items: parseRss(xml, { source: 'appinn' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`小众软件：${error?.message || error}`] }
  }
}

/** LINUX DO · 福利羊毛：category 36 的 RSS。可能被 Cloudflare 拦，失败交给浏览器补抓。 */
export async function fetchLinuxdo({ fetchImpl = fetch } = {}) {
  try {
    const xml = await getText('https://linux.do/c/welfare/36.rss', {
      fetchImpl,
      accept: 'application/rss+xml,application/xml,text/xml,*/*'
    })
    return { items: parseRss(xml, { source: 'linuxdo', linkBase: 'https://linux.do' }), errors: [] }
  } catch (error) {
    return { items: [], errors: [`LINUX DO 福利羊毛：${error?.message || error}`] }
  }
}

async function withRetry(task, { retries = 1, waitMs = 800 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await task()
      if (result?.items?.length) return result
      lastError = new Error((result?.errors || []).join('；') || '没有取到内容')
    } catch (error) {
      lastError = error
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  return { items: [], errors: [String(lastError?.message || lastError)] }
}

/** 三个直连来源（NodeSeek 只能走浏览器）。 */
export async function collectServerSources({ fetchImpl = fetch } = {}) {
  const [v2, ap, ld] = await Promise.all([
    withRetry(() => fetchV2ex({ fetchImpl })),
    withRetry(() => fetchAppinn({ fetchImpl })),
    withRetry(() => fetchLinuxdo({ fetchImpl }), { retries: 0 })
  ])
  return {
    items: [...v2.items, ...ap.items, ...ld.items],
    errors: [...(v2.errors || []), ...(ap.errors || []), ...(ld.errors || [])]
  }
}

const CATEGORY_PRIORITY = { limited: 0, free: 1, cheap: 2, general: 3 }

const FREE_SIGNAL = /(免费|白嫖|0\s*元|0元|白给|赠送|免费领取|免单|限免)/
const COST_SIGNAL = /(需绑卡|要绑卡|需实名|实名认证|需付|付费|首充|首月|押金|满减|需购买|会员价|订阅|邀请码|返利|aff|推广)/i
const DISCOUNT_SIGNAL = /(折扣|优惠|立减|特价|秒杀|团购|券|返现|补贴|降价|便宜|省钱)/

/**
 * 核实「是否真实免费」：给出四档结论，而不是笼统的「已核实」。
 * - free        真实免费（有免费信号且没有附加代价）
 * - conditional 有条件免费（要绑卡 / 实名 / 邀请码 / 首充等）
 * - discount    只是优惠（没有免费信号，只有折扣）
 * - unknown     看不出是否免费
 */
export function verifyFree(text) {
  const t = String(text || '')
  const free = FREE_SIGNAL.test(t)
  const cost = COST_SIGNAL.test(t)
  const discount = DISCOUNT_SIGNAL.test(t)
  if (free && !cost) return { verdict: 'free', reason: '明确写了免费且无附加条件' }
  if (free && cost) return { verdict: 'conditional', reason: '写的是免费，但需要绑卡/实名/邀请码等条件' }
  if (!free && discount) return { verdict: 'discount', reason: '没有免费信号，属于折扣/优惠' }
  return { verdict: 'unknown', reason: '看不出是否真实免费' }
}

/** 判断是否有「可核实的具体信息」：金额、额度、期限、领取方式。 */
export function hasConcreteEvidence(text) {
  const t = String(text || '')
  const money = /(¥|￥|\$|\d+\s*(元|块|美元|刀|积分|额度|点|GB|G|TB|天|个月|年))/.test(t)
  const claim = /(领取|领|注册|签到|申请|兑换|下单|直达|链接|邀请码|口令)/.test(t)
  return money && claim
}

/**
 * 羊毛评分（0-100）：
 * 基础分按类别（免费/限免 > 折扣 > 一般），再按「有具体数字」「时效」「是否要绑卡/实名/返利」加减。
 */
export function scoreWool(item, { now = Date.now() } = {}) {
  const text = (item.title || '') + ' ' + (item.excerpt || '')
  const base = { limited: 62, free: 58, cheap: 40, general: 24 }[item.category] ?? 24
  let score = base
  if (hasConcreteEvidence(text)) score += 18
  if (/(限时|限免)/.test(text)) score += 6
  const verdictInfo = verifyFree(text)
  if (verdictInfo.verdict === 'free') score += 10
  else if (verdictInfo.verdict === 'conditional') score -= 6
  else if (verdictInfo.verdict === 'discount') score += 2
  const age = now - (Date.parse(item.createdAt) || now)
  if (age <= 24 * 3600 * 1000) score += 10
  else if (age <= 3 * 24 * 3600 * 1000) score += 5
  if (item.source === 'appinn') score += 4
  if (item.source === 'v2ex') score += 3
  score = Math.max(1, Math.min(100, Math.round(score)))
  return { score, verdict: verdictInfo.verdict, verified: verdictInfo.verdict === 'free' }
}


/**
 * 收录与排序：只留近 7 天、命中关键词、非噪声的条目；
 * 先按 限免 > 免费 > 低价，同标签内按发布时间倒序。
 */
export function buildRadar(rawItems, { now = Date.now(), days = MAX_AGE_DAYS, limit = MAX_RADAR_ITEMS } = {}) {
  const byUrl = new Map()
  for (const raw of rawItems) {
    if (!raw?.url || !raw?.title) continue
    if (!withinDays(raw.createdAt, days, now)) continue
    if (isNoise(raw.title) || isNoise(raw.excerpt)) continue
    const text = `${raw.title} ${raw.excerpt}`
    if (!matchesKeywords(text)) continue
    const rawCat = classify(text)
    // 命中关键词但归不到三类的（比如只说「福利」「抽奖」），保留为「一般」，
    // 否则版块里大量有效帖子会被关键词表挡掉。
    const category = rawCat === 'other' ? 'general' : rawCat
    if (byUrl.has(raw.url)) continue
    const graded = scoreWool({ ...raw, category }, { now })
    byUrl.set(raw.url, {
      ...raw,
      category,
      score: graded.score,
      verdict: graded.verdict,
      verified: graded.verified,
      id: raw.url.replace(/[^\w]/g, '').slice(-48)
    })
  }
  return [...byUrl.values()]
    .sort((a, b) => {
      // 羊毛分从高到低；同分再看时间。必须是可传递的全序：
      // 以前写成「差值 ≥5 才比分数」，比较函数不满足传递性，排出来的顺序是随机的。
      const sa = a.score || 0
      const sb = b.score || 0
      if (sb !== sa) return sb - sa
      const ta = Date.parse(a.createdAt) || 0
      const tb = Date.parse(b.createdAt) || 0
      if (tb !== ta) return tb - ta
      return (CATEGORY_PRIORITY[a.category] ?? 9) - (CATEGORY_PRIORITY[b.category] ?? 9)
    })
    .slice(0, limit)
}
