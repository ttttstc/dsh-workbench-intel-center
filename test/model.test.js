import test from 'node:test'
import assert from 'node:assert/strict'
import { ValidationError, mergeState, normalizeState, normalizeStoredState } from '../dsh/model.js'

test('拒绝非对象状态', () => {
  assert.throws(() => normalizeState(null), ValidationError)
  assert.throws(() => normalizeState('x'), ValidationError)
  assert.throws(() => normalizeState([]), ValidationError)
})

test('卡片缺标题时报出序号', () => {
  assert.throws(() => normalizeState({ cards: [{ summary: ['a'] }] }), /第 1 张卡片缺少标题/)
})

test('卡片 id 重复被拒绝', () => {
  assert.throws(() => normalizeState({ cards: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }), /重复/)
})

test('评分被夹到 1-5，非法状态退化为待验证', () => {
  const state = normalizeState({ cards: [{ title: 'X', score: 99, status: 'whatever' }] })
  assert.equal(state.cards[0].score, 5)
  assert.equal(state.cards[0].status, 'pending')
})

test('来源只保留 http(s)，非法条目丢弃', () => {
  const state = normalizeState({
    cards: [{
      title: 'X',
      sources: [
        { title: '官方定价', url: 'https://example.com/pricing' },
        { title: '坏链接', url: 'javascript:alert(1)' },
        'https://example.com/raw'
      ]
    }]
  })
  assert.equal(state.cards[0].sources.length, 2)
  assert.equal(state.cards[0].sources[0].title, '官方定价')
  assert.equal(state.cards[0].sources[1].url, 'https://example.com/raw')
})

test('摘要与要点数量有上限', () => {
  const state = normalizeState({
    cards: [{
      title: 'X',
      summary: Array.from({ length: 20 }, (_, i) => `要点 ${i}`),
      facts: Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }))
    }]
  })
  assert.equal(state.cards[0].summary.length, 6)
  assert.equal(state.cards[0].facts.length, 12)
})

test('备注被截断到 2000 字，控制字符被清掉', () => {
  const state = normalizeState({ cards: [{ title: 'X', note: 'a'.repeat(3000) + '\u0001' }] })
  assert.equal(state.cards[0].note.length, 2000)
})

test('verifiedAt 只接受 YYYY-MM-DD', () => {
  const ok = normalizeState({ cards: [{ title: 'X', verifiedAt: '2026-11-09' }] })
  assert.equal(ok.cards[0].verifiedAt, '2026-11-09')
  const bad = normalizeState({ cards: [{ title: 'X', verifiedAt: '2026/11/09' }] })
  assert.equal(bad.cards[0].verifiedAt, '')
})

test('主题数量最多保留 20 个，空标题丢弃', () => {
  const state = normalizeState({
    topics: [...Array.from({ length: 25 }, (_, i) => ({ title: `主题${i}` })), { title: '   ' }]
  })
  assert.equal(state.topics.length, 20)
})

test('linux.do 榜单结构被规整：数字、链接与排名', () => {
  const state = normalizeState({
    linuxdo: {
      updatedAt: '2026-11-09T12:00:00Z',
      date: '2026-11-09',
      keywords: ['羊毛', '薅'],
      items: [
        { id: 't1', title: '免费 50 元券', url: 'https://linux.do/t/1', likes: '120', replies: 8.6, views: -5 },
        { title: '缺链接', url: 'javascript:alert(1)', likes: 3 },
        { title: '   ' }
      ]
    }
  })
  assert.equal(state.linuxdo.date, '2026-11-09')
  assert.deepEqual(state.linuxdo.keywords, ['羊毛', '薅'])
  assert.equal(state.linuxdo.items.length, 2, '空标题被丢弃')
  const first = state.linuxdo.items[0]
  assert.equal(first.likes, 120)
  assert.equal(first.replies, 9)
  assert.equal(first.views, 0)
  assert.equal(first.rank, 1)
  assert.equal(first.url, 'https://linux.do/t/1')
  assert.equal(state.linuxdo.items[1].url, '', '非 http(s) 链接被清空')
})

test('没有 linuxdo 字段时给空结构，老数据不会炸', () => {
  const state = normalizeState({ cards: [] })
  assert.deepEqual(state.linuxdo, { updatedAt: '', date: '', keywords: [], items: [] })
})

test('X 榜单结构与 linux.do 分开保存，互不覆盖', () => {
  const state = normalizeState({
    linuxdo: { date: '2026-11-09', items: [{ title: 'ld 帖', url: 'https://linux.do/t/1' }] },
    x: {
      updatedAt: '2026-11-09T16:00:00Z',
      date: '2026-11-09',
      keywords: ['羊毛', '薅'],
      items: [{ title: 'X 帖', url: 'https://x.com/a/status/1', handle: '@a', likes: '2.9万', reposts: 459 }]
    }
  })
  assert.equal(state.linuxdo.items.length, 1)
  assert.equal(state.x.items.length, 1)
  assert.equal(state.x.items[0].handle, '@a')
  assert.equal(state.x.items[0].likes, 29000, '「2.9万」这类中文缩写应被换算')
})

test('缺 id 的卡片按标题+分类得到稳定 id，重排后不变', () => {
  const first = normalizeState({ cards: [{ title: 'A', category: 'X' }, { title: 'B', category: 'X' }] })
  const reordered = normalizeState({ cards: [{ title: 'B', category: 'X' }, { title: 'A', category: 'X' }] })
  const byTitle = (state) => Object.fromEntries(state.cards.map((card) => [card.title, card.id]))
  assert.deepEqual(byTitle(first), byTitle(reordered), '换一下顺序不该改 id')
  assert.match(first.cards[0].id, /^card-[a-z0-9]+$/)
})

test('同标题同分类的两张卡片：自动 id 撞车时加后缀，不整体报错', () => {
  const state = normalizeState({ cards: [{ title: 'A' }, { title: 'A' }] })
  assert.equal(state.cards.length, 2)
  assert.notEqual(state.cards[0].id, state.cards[1].id)
  assert.match(state.cards[1].id, /-2$/)
})

test('mergeState：卡片归用户，榜单只接受更新的来件', () => {
  const current = {
    version: 1,
    cards: [{ id: 'old', title: '旧卡片' }],
    topics: [],
    radar: { updatedAt: '2026-11-10T08:00:00.000Z', date: '2026-11-10', keywords: [], items: [{ id: 'r1', title: '新抓的' }] },
    x: { updatedAt: '2026-11-10T08:00:00.000Z', date: '2026-11-10', keywords: [], items: [] }
  }
  const staleClientPost = {
    cards: [{ id: 'mine', title: '我的卡片' }],
    topics: [],
    radar: { updatedAt: '', date: '', keywords: [], items: [] },
    x: { updatedAt: '2026-11-10T08:00:00.000Z', date: '2026-11-10', keywords: [], items: [] }
  }
  const merged = mergeState(current, staleClientPost)
  assert.deepEqual(merged.cards.map((card) => card.id), ['mine'], '卡片采用来件')
  assert.equal(merged.radar.items.length, 1, '旧快照的榜单被挡住')
  assert.equal(merged.x.items.length, 0)

  const newer = mergeState(current, {
    ...staleClientPost,
    radar: { updatedAt: '2026-11-10T09:00:00.000Z', date: '2026-11-10', keywords: [], items: [{ id: 'r2', title: '更新的一轮' }] }
  })
  assert.equal(newer.radar.items[0].id, 'r2', '更新时间的榜单采用来件')
})

test('mergeState：来件没有榜单字段时保留磁盘上的', () => {
  const current = { cards: [], radar: { updatedAt: '2026-11-10T08:00:00.000Z', items: [{ id: 'r1' }] } }
  const merged = mergeState(current, { cards: [] })
  assert.deepEqual(merged.radar.items.map((item) => item.id), ['r1'])
})

test('榜单条目 id 撞车时只留第一条，避免列表 key 重复', () => {
  const state = normalizeState({
    radar: {
      items: [
        { id: 'dup', title: 'A', url: 'https://example.com/1' },
        { id: 'dup', title: 'B', url: 'https://example.com/2' }
      ]
    }
  })
  assert.equal(state.radar.items.length, 1)
  assert.equal(state.radar.items[0].title, 'A')
})

test('normalizeStoredState：坏卡片被跳过并报告数量', () => {
  const { state, dropped } = normalizeStoredState({
    version: 1,
    cards: [{ id: 'ok', title: '好卡片' }, { id: 'bad' }, { id: 'ok', title: '重复 id' }]
  })
  assert.equal(state.cards.length, 1)
  assert.equal(dropped, 2)
})

test('expiresAt：合法 ISO 保留，垃圾值丢弃', () => {
  const ok = normalizeState({ radar: { items: [{ id: "a", title: "游戏", url: "https://e.com/1", expiresAt: "2026-11-18T00:00:00.000Z" }] } })
  assert.equal(ok.radar.items[0].expiresAt, "2026-11-18T00:00:00.000Z")
  const bad = normalizeState({ radar: { items: [{ id: "b", title: "游戏", url: "https://e.com/2", expiresAt: "not-a-date" }] } })
  assert.equal(bad.radar.items[0].expiresAt, "")
})
