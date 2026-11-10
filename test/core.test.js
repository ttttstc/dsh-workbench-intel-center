import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLinuxdoPrompt, buildReviewPrompt, buildXPrompt, filterRadar, relativeTime, filterCards, formatWhen, highlightCards, todayISO } from '../src/shared/core.js'

const cards = [
  {
    id: 'a', title: 'Oracle Cloud 永久免费 ARM', category: '免费VPS', tags: ['ARM', '永久免费'],
    priority: 'high', status: 'confirmed', score: 5, verifiedAt: '2026-11-09',
    summary: ['4 核 24G 可长期免费'], facts: [{ label: '内存', value: '24 GB' }],
    pros: ['额度大'], cons: ['需要信用卡', '可能被回收'], note: '已试用', flag: 'used'
  },
  {
    id: 'b', title: 'Render 免费 Web Service', category: '容器PaaS', tags: ['冷启动'],
    priority: 'normal', status: 'pending', score: 3, verifiedAt: '',
    summary: ['15 分钟无请求休眠'], facts: [{ label: '休眠', value: '15 分钟' }],
    pros: ['不用绑卡'], cons: ['冷启动慢'], note: '', flag: 'none'
  },
  {
    id: 'c', title: 'Hetzner CX22', category: '低价VPS', tags: ['欧洲'],
    priority: 'normal', status: 'confirmed', score: 4, verifiedAt: '2026-11-09',
    summary: ['€3.79/月起'], facts: [], pros: ['便宜'], cons: [], note: '', flag: 'dropped'
  }
]

test('按分类筛选', () => {
  assert.deepEqual(filterCards(cards, { category: '免费VPS' }).map((c) => c.id), ['a'])
})

test('按核实状态筛选', () => {
  assert.deepEqual(filterCards(cards, { status: 'pending' }).map((c) => c.id), ['b'])
})

test('按最低评分筛选', () => {
  assert.deepEqual(filterCards(cards, { minScore: '4' }).map((c) => c.id), ['a', 'c'])
})

test('按处理标记筛选', () => {
  assert.deepEqual(filterCards(cards, { flag: 'dropped' }).map((c) => c.id), ['c'])
})

test('搜索能命中要点、额度与坑点', () => {
  assert.deepEqual(filterCards(cards, { q: '24 GB' }).map((c) => c.id), ['a'])
  assert.deepEqual(filterCards(cards, { q: '冷启动' }).map((c) => c.id), ['b'])
  assert.deepEqual(filterCards(cards, { q: '不需要' }), [])
})

test('搜索大小写不敏感，空查询返回全部', () => {
  assert.equal(filterCards(cards, { q: 'arm' }).length, 1)
  assert.equal(filterCards(cards, { q: '   ' }).length, 3)
})

test('多个条件叠加', () => {
  assert.deepEqual(filterCards(cards, { category: '低价VPS', minScore: '5' }), [])
})

test('今日重点把高优先级放第一，已排除的沉底', () => {
  const top = highlightCards(cards, 3)
  assert.equal(top[0].id, 'a')
  assert.equal(top[2].id, 'c')
})

test('复核提示词包含主题、卡片 id 与数据文件路径', () => {
  const text = buildReviewPrompt({
    topics: [{ title: '免费云资源', note: '轻量节点' }],
    cards,
    dataFile: 'C:/Users/x/dsh/desktop-workbenches/intel-center/state.json',
    today: '2026-11-09'
  })
  assert.match(text, /免费云资源/)
  assert.match(text, /card id|按 id 更新/)
  assert.match(text, /a｜Oracle Cloud/)
  assert.match(text, /intel-center[\\/]state\.json/)
  assert.match(text, /2026-11-09/)
  assert.match(text, /不要编造/)
})

test('没有卡片时提示按主题新建', () => {
  const text = buildReviewPrompt({ topics: [], cards: [], dataFile: '', today: '2026-11-09' })
  assert.match(text, /目前还没有卡片/)
})

test('时间格式化对空值与非法值安全', () => {
  assert.equal(formatWhen(''), '未记录')
  assert.equal(formatWhen('not-a-date'), 'not-a-date')
  assert.match(formatWhen('2026-11-09T10:20:00Z'), /^2026-11-09 \d{2}:\d{2}$/)
})

test('todayISO 输出 YYYY-MM-DD', () => {
  assert.match(todayISO(new Date(2026, 10, 9)), /^2026-11-09$/)
})

test('linux.do 抓取指令写清关键词、日期、回写路径与结构', () => {
  const text = buildLinuxdoPrompt({
    date: '2026-11-09',
    keywords: ['羊毛', '薅'],
    dataFile: 'C:/Users/x/AppData/Roaming/dsh-desktop/harness/intel-center/state.json',
    existing: [{ createdAt: '2026-11-08T10:00:00Z' }]
  })
  assert.match(text, /「羊毛」、「薅」/)
  assert.match(text, /2026-11-09/)
  assert.match(text, /intel-center[\\/]state\.json/)
  assert.match(text, /按点赞数/)
  assert.match(text, /"linuxdo"/)
  assert.match(text, /不要编造数字/)
  assert.match(text, /上一次抓到 1 条/)
})

test('X 抓取指令点名 web-access skill、点赞排序与回写结构', () => {
  const text = buildXPrompt({
    date: '2026-11-09',
    keywords: ['羊毛', '薅'],
    dataFile: 'C:/Users/x/AppData/Roaming/dsh-desktop/harness/intel-center/state.json',
    existing: []
  })
  assert.match(text, /web-access skill/)
  assert.match(text, /按点赞数/)
  assert.match(text, /"x"/)
  assert.match(text, /linuxdo.*保持不变|保持不变/)
  assert.match(text, /2026-11-09/)
  assert.match(text, /不要编造/)
})

test('雷达筛选：来源 / 分类 / 关键词可叠加', () => {
  const items = [
    { source: 'v2ex', category: 'free', title: '免费领取云主机', excerpt: '' },
    { source: 'appinn', category: 'limited', title: '限免工具', excerpt: '今天' },
    { source: 'v2ex', category: 'cheap', title: '优惠券 5 折', excerpt: '' }
  ]
  assert.equal(filterRadar(items, {}).length, 3)
  assert.deepEqual(filterRadar(items, { source: 'v2ex' }).map((i) => i.category), ['free', 'cheap'])
  assert.deepEqual(filterRadar(items, { category: 'limited' }).map((i) => i.title), ['限免工具'])
  assert.deepEqual(filterRadar(items, { q: '优惠' }).map((i) => i.title), ['优惠券 5 折'])
  assert.equal(filterRadar(items, { source: 'v2ex', category: 'free', q: '云主机' }).length, 1)
})

test('相对时间：分钟 / 小时 / 天', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  assert.equal(relativeTime('2026-11-10T11:59:30Z', now), '刚刚')
  assert.equal(relativeTime('2026-11-10T11:30:00Z', now), '30 分钟前')
  assert.equal(relativeTime('2026-11-10T09:00:00Z', now), '3 小时前')
  assert.equal(relativeTime('2026-11-08T12:00:00Z', now), '2 天前')
  assert.equal(relativeTime('bad', now), '')
})
