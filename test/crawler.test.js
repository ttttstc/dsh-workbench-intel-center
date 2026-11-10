import test from 'node:test'
import assert from 'node:assert/strict'
import { createCdpClient, crawlX, DEFAULT_KEYWORDS } from '../dsh/crawler.js'

/** 假 CDP：模拟两个关键词、三次滚动、两次抓到同样的帖子。 */
function fakeCdp(pages) {
  const calls = { newTab: 0, eval: 0, scroll: 0, close: 0 }
  let current = -1
  let round = 0
  return {
    calls,
    async newTab() {
      calls.newTab += 1
      current += 1
      round = 0
      return `tab-${current}`
    },
    async eval() {
      calls.eval += 1
      const page = pages[current] || []
      round += 1
      return JSON.stringify(round <= 2 ? page : [])
    },
    async scrollBottom() {
      calls.scroll += 1
    },
    async close() {
      calls.close += 1
    },
    scrollSteps: () => round
  }
}

test('多关键词抓取：去重、按点赞降序、截断到 limit', async () => {
  const pages = [
    [
      { title: 'A', url: 'https://x.com/a/status/1', likes: 10, reposts: 1, replies: 1 },
      { title: 'B', url: 'https://x.com/b/status/2', likes: 99 },
      { title: 'C', url: 'https://x.com/c/status/3', likes: 5 }
    ],
    [
      { title: 'B', url: 'https://x.com/b/status/2', likes: 99 },
      { title: 'D', url: 'https://x.com/d/status/4', likes: 50 }
    ]
  ]
  const cdp = fakeCdp(pages)
  const { items, scanned, errors } = await crawlX({
    cdp,
    keywords: DEFAULT_KEYWORDS.slice(0, 2),
    limit: 3,
    scrolls: 3,
    pageWaitMs: 0,
    scrollWaitMs: 0
  })
  assert.deepEqual(errors, [])
  assert.equal(scanned, 4, '四条唯一帖子')
  assert.equal(items.length, 3, 'limit 生效')
  assert.deepEqual(items.map((i) => i.title), ['B', 'D', 'A'])
  assert.equal(items[0].rank, 1)
  assert.equal(items[0].id, '2')
  assert.equal(cdp.calls.close, 2, '每个 tab 用完都关掉')
})

test('单个关键词失败不中断整体，错误被收集', async () => {
  let attempt = 0
  const cdp = {
    async newTab() {
      attempt += 1
      if (attempt === 1) throw new Error('CDP 没起来')
      return 'tab-ok'
    },
    async eval() {
      return JSON.stringify([{ title: '好帖', url: 'https://x.com/x/status/9', likes: 1 }])
    },
    async scrollBottom() {},
    async close() {}
  }
  const { items, errors } = await crawlX({
    cdp,
    keywords: ['坏', '好'],
    scrolls: 1,
    pageWaitMs: 0,
    scrollWaitMs: 0
  })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /CDP 没起来/)
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '好帖')
})

test('没有标题或链接的条目被丢弃', async () => {
  const cdp = {
    async newTab() { return 't' },
    async eval() {
      return JSON.stringify([
        { title: '', url: 'https://x.com/a/status/1' },
        { title: '无链接', url: '' },
        { title: '正常', url: 'https://x.com/b/status/2', likes: 3 }
      ])
    },
    async scrollBottom() {},
    async close() {}
  }
  const { items } = await crawlX({ cdp, keywords: ['羊毛'], scrolls: 1, pageWaitMs: 0, scrollWaitMs: 0 })
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '正常')
})

test('CDP 客户端在代理不可用时给出明确错误', async () => {
  const cdp = createCdpClient('http://127.0.0.1:1')
  await assert.rejects(() => cdp.newTab('https://x.com'), /CDP|fetch|ECONN/i)
})

test('浏览器通道：linux.do 与 NodeSeek 各自取数，失败互不牵连', async () => {
  const { crawlBrowserFeeds } = await import('../dsh/crawler.js')
  const opened = []
  const cdp = {
    async newTab(url) { opened.push(url); return url.includes('linux.do') ? 'ld' : 'ns' },
    async eval(target) {
      if (target === 'ld') return '<rss><channel><item><title>免费额度</title><link>https://linux.do/t/1</link><pubDate>Sun, 09 Nov 2026 10:00:00 +0800</pubDate></item></channel></rss>'
      return '<a href="/post-9-1">限免 App</a>'
    },
    async scrollBottom() {},
    async close() {}
  }
  const { items, errors } = await crawlBrowserFeeds({ cdp, pageWaitMs: 0 })
  assert.deepEqual(errors, [])
  assert.deepEqual(opened.map((u) => (u.includes('nodeseek') ? 'nodeseek' : 'linuxdo')), ['linuxdo', 'nodeseek'])
  // 现在每个站会翻多页，同一个假响应会被重复解析，所以按来源断言而不是条数。
  assert.ok(items.some((i) => i.source === 'linuxdo'))
  assert.ok(items.some((i) => i.source === 'nodeseek'))
})

test('浏览器通道：一个站失败时另一个仍返回', async () => {
  const { crawlBrowserFeeds } = await import('../dsh/crawler.js')
  let call = 0
  const cdp = {
    async newTab() { call += 1; if (call === 1) throw new Error('CDP 挂了'); return 'ns' },
    async eval() { return '<a href="/post-1-1">免费券</a>' },
    async scrollBottom() {},
    async close() {}
  }
  const { items, errors } = await crawlBrowserFeeds({ cdp, pageWaitMs: 0 })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /linux.do/)
  assert.ok(items.length >= 1)
  assert.ok(items.every((i) => i.source === 'nodeseek'))
})
