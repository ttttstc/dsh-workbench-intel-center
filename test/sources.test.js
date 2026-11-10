import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRadar,
  classify,
  fetchAppinn,
  fetchLinuxdo,
  fetchV2ex,
  isNoise,
  matchesKeywords,
  verifyFree,
  scoreWool,
  parseNodeSeek,
  parseRss,
  withinDays
} from '../dsh/sources.js'

test('分类：免费白嫖 / 限免 / 低价优惠 / 其他', () => {
  assert.equal(classify('免费领取 100 元额度'), 'free')
  assert.equal(classify('限时免费：某工具今天截止'), 'limited')
  assert.equal(classify('双十一优惠券 立减 50'), 'cheap')
  assert.equal(classify('今天写了一段代码'), 'other')
  assert.equal(matchesKeywords('今天写了一段代码'), false)
  assert.equal(matchesKeywords('送 30 天会员'), true)
})

test('噪声词（招聘、租房等）被识别', () => {
  assert.equal(isNoise('招聘前端工程师'), true)
  assert.equal(isNoise('免费领取云主机'), false)
})

test('7 天窗口：超期条目淘汰', () => {
  const now = Date.parse('2026-11-10T00:00:00Z')
  assert.equal(withinDays('2026-11-09T00:00:00Z', 7, now), true)
  assert.equal(withinDays('2026-10-01T00:00:00Z', 7, now), false)
  assert.equal(withinDays('not-a-date', 7, now), false)
})

test('buildRadar：去重、分类、过滤噪声与超期', () => {
  const now = Date.parse('2026-11-10T00:00:00Z')
  const items = buildRadar([
    { title: '免费领取云主机', url: 'https://a.com/1', createdAt: '2026-11-09T00:00:00Z', excerpt: '', source: 'v2ex', heat: 3 },
    { title: '免费领取云主机', url: 'https://a.com/1', createdAt: '2026-11-09T00:00:00Z', excerpt: '', source: 'v2ex' },
    { title: '限免：某 App 今天截止', url: 'https://a.com/2', createdAt: '2026-11-09T12:00:00Z', excerpt: '', source: 'appinn' },
    { title: '招聘前端', url: 'https://a.com/3', createdAt: '2026-11-09T12:00:00Z', excerpt: '', source: 'v2ex' },
    { title: '很老的优惠', url: 'https://a.com/4', createdAt: '2026-10-01T00:00:00Z', excerpt: '', source: 'v2ex' }
  ], { now })
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((i) => i.category).sort(), ['free', 'limited'])
})

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>免费领取 50 元券</title><link rel="alternate" href="https://www.v2ex.com/t/123"/>
    <updated>2026-11-09T10:00:00Z</updated><summary>限时领取</summary></entry>
  <entry><title>无关帖子</title><link href="https://www.v2ex.com/t/124"/><updated>2026-11-09T09:00:00Z</updated></entry>
</feed>`

test('V2EX 走官方 Atom：标题、链接、时间、摘要', async () => {
  const fakeFetch = async () => new Response(ATOM, { status: 200 })
  const { items, errors } = await fetchV2ex({ fetchImpl: fakeFetch })
  assert.deepEqual(errors, [])
  assert.equal(items.length, 2)
  assert.equal(items[0].title, '免费领取 50 元券')
  assert.equal(items[0].url, 'https://www.v2ex.com/t/123')
  assert.equal(items[0].source, 'v2ex')
  assert.match(items[0].excerpt, /限时领取/)
  assert.ok(Date.parse(items[0].createdAt))
})

test('LINUX DO 福利羊毛 RSS：条目解析与相对链接补全', async () => {
  const xml = `<rss><channel><item><title>白嫖一年会员</title><link>/t/123</link><pubDate>Sun, 09 Nov 2026 10:00:00 +0800</pubDate><description>限时</description></item></channel></rss>`
  const fakeFetch = async () => new Response(xml, { status: 200 })
  const { items } = await fetchLinuxdo({ fetchImpl: fakeFetch })
  assert.equal(items.length, 1)
  assert.equal(items[0].source, 'linuxdo')
  assert.equal(items[0].url, 'https://linux.do/t/123')
})

test('小众软件 RSS 解析：标题、链接、时间、摘要', async () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[限免：某工具]]></title><link>https://www.appinn.com/x/</link>
      <pubDate>Sun, 09 Nov 2026 10:00:00 +0800</pubDate>
      <description><![CDATA[<p>今天限时免费</p>]]></description></item>
    <item><title>没有链接的条目</title></item>
  </channel></rss>`
  const fakeFetch = async () => new Response(xml, { status: 200 })
  const { items, errors } = await fetchAppinn({ fetchImpl: fakeFetch })
  assert.deepEqual(errors, [])
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '限免：某工具')
  assert.equal(items[0].source, 'appinn')
  assert.match(items[0].excerpt, /限时免费/)
  assert.ok(!Number.isNaN(Date.parse(items[0].createdAt)))
})

test('抓取失败时返回可读错误而不是抛异常', async () => {
  const boom = async () => { throw new Error('网络不通') }
  const v2 = await fetchV2ex({ fetchImpl: boom })
  assert.equal(v2.items.length, 0)
  assert.match(v2.errors.join(' '), /网络不通/)
  const ap = await fetchAppinn({ fetchImpl: boom })
  assert.match(ap.errors.join(' '), /网络不通/)
})

test('linux.do RSS 解析：标题、链接、时间', () => {
  const xml = `<rss><channel><item><title>免费领取 100 额度</title><link>https://linux.do/t/1</link><pubDate>Sun, 09 Nov 2026 10:00:00 +0800</pubDate><description>&lt;p&gt;限时免费&lt;/p&gt;</description></item></channel></rss>`
  const items = parseRss(xml, { source: 'linuxdo' })
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '免费领取 100 额度')
  assert.equal(items[0].url, 'https://linux.do/t/1')
  assert.equal(items[0].source, 'linuxdo')
  assert.match(items[0].excerpt, /限时免费/)
})

test('NodeSeek HTML 解析：/post- 链接去重', () => {
  const html = `<a href="/post-123-1" target="">免费 5 元券</a><a href="/post-123-1" class="x">重复</a><a href="/post-456-1">限免工具</a>`
  const items = parseNodeSeek(html)
  assert.equal(items.length, 2)
  assert.equal(items[0].url, 'https://www.nodeseek.com/post-123-1')
  assert.deepEqual(items.map((i) => i.title), ['免费 5 元券', '限免工具'])
})

test('羊毛评分：有具体额度与领取方式的分更高', () => {
  const rich = scoreWool({ title: '免费领取 50 元券，点此领取', excerpt: '', category: 'free', createdAt: new Date().toISOString(), source: 'appinn' })
  const vague = scoreWool({ title: '大家好', excerpt: '', category: 'general', createdAt: '2026-10-01T00:00:00Z', source: 'nodeseek' })
  assert.ok(rich.score > vague.score, '具体信息应高于空泛内容')
  assert.equal(rich.verified, true)
  assert.equal(vague.verified, false)
  assert.ok(rich.score >= 1 && rich.score <= 100)
})

test('羊毛评分：需绑卡/邀请码会扣分', () => {
  const base = { excerpt: '', category: 'free', createdAt: new Date().toISOString(), source: 'nodeseek' }
  const plain = scoreWool({ ...base, title: '免费领取 100 元额度' })
  const card = scoreWool({ ...base, title: '免费领取 100 元额度，需绑卡并填邀请码' })
  assert.ok(card.score < plain.score)
})

test('核实结论：真实免费 / 有条件免费 / 只是优惠 / 待判断', () => {
  assert.equal(verifyFree('免费领取 100 元额度，点此领取').verdict, 'free')
  assert.equal(verifyFree('免费领取，但需要绑卡实名').verdict, 'conditional')
  assert.equal(verifyFree('全场 8 折优惠券').verdict, 'discount')
  assert.equal(verifyFree('今天写了一段代码').verdict, 'unknown')
})
