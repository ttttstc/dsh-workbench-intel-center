import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../dsh/routes.js'
import { RUN_HOURS } from '../dsh/schedule.js'
import { X_TOP_LIMIT } from '../src/shared/core.js'

/**
 * 用假的抓取函数挂载真实路由：这条链路以前没有任何测试覆盖，
 * /radar/refresh 里一个未定义的 request 就一直没人发现。
 */
async function mount({ deps = {}, seedState } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-refresh-'))
  if (seedState) await fs.writeFile(path.join(root, 'state.json'), JSON.stringify(seedState), 'utf8')
  const routes = new Map()
  const ctx = {
    connection: {
      fetch: {
        register(route) {
          assert.equal(routes.has(route.path), false, `路径重复注册：${route.path}`)
          routes.set(route.path, route)
        }
      }
    }
  }
  const api = apply(ctx, { root }, 'dsh-workbench-intel-center', {
    startScheduler: false,
    now: () => new Date('2026-11-10T08:00:00.000Z'),
    ...deps
  })
  async function call(pathname, init = {}) {
    const route = routes.get(pathname)
    if (!route) throw new Error(`没有注册 ${pathname}`)
    const method = init.method || 'GET'
    assert.ok(route.methods.includes(method), `${pathname} 不支持 ${method}`)
    const request = new Request(`http://localhost${pathname}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: init.body
    })
    const response = await route.fetch(request)
    const type = response.headers.get('content-type') || ''
    const body = type.includes('application/json') ? await response.json() : await response.text()
    return { status: response.status, body }
  }
  return { call, api, root }
}

const radarItem = (title, url, createdAt = '2026-11-10T07:00:00.000Z') => ({ title, url, createdAt, source: 'v2ex' })

async function waitJob(job) {
  return job.wait()
}

test('POST /radar/refresh 启动后台任务：立即 202，状态里能看到结果', async () => {
  const { call, api } = await mount({
    deps: {
      collectServerSources: async () => ({
        items: [radarItem('免费领取 10 GB 云空间', 'https://example.com/a')],
        errors: []
      }),
      crawlBrowserFeeds: async () => ({ items: [], errors: ['NodeSeek：Cloudflare 拦截'] })
    }
  })

  const started = await call('/api/intel-center/radar/refresh', {
    method: 'POST',
    body: JSON.stringify({ reason: 'manual' })
  })
  assert.equal(started.status, 202, '长任务不能在请求里等完，要立刻返回')
  assert.equal(started.body.started, true)
  assert.equal(started.body.job.status, 'running')

  await waitJob(api.radarJob)

  const status = await call('/api/intel-center/radar/status')
  assert.equal(status.status, 200)
  assert.equal(status.body.job.status, 'succeeded')
  assert.equal(status.body.job.result.count, 1)
  assert.deepEqual(status.body.job.result.errors, ['NodeSeek：Cloudflare 拦截'], '单个来源失败不该让整轮失败')
  assert.equal(status.body.running, false)
  assert.deepEqual(status.body.hours, RUN_HOURS, '状态接口的小时表必须等于调度器真值')

  const state = await call('/api/intel-center/state')
  assert.equal(state.body.state.radar.items.length, 1)
  assert.equal(state.body.state.radar.items[0].title, '免费领取 10 GB 云空间')
})

test('抓取失败时不吞掉原因：job 进 failed，detail 可读', async () => {
  const { call, api } = await mount({
    deps: {
      collectServerSources: async () => { throw new Error('DNS 解析失败') },
      crawlBrowserFeeds: async () => ({ items: [], errors: [] })
    }
  })
  await call('/api/intel-center/radar/refresh', { method: 'POST', body: '{}' })
  await waitJob(api.radarJob)

  const status = await call('/api/intel-center/radar/status')
  assert.equal(status.body.job.status, 'failed')
  assert.match(status.body.job.error, /DNS 解析失败/)
  assert.equal(status.body.last.ok, false)
})

test('正在跑时再点一次刷新：返回 skipped 而不是排队', async () => {
  let release = () => {}
  const gate = new Promise((resolve) => { release = resolve })
  const { call, api } = await mount({
    deps: {
      collectServerSources: async () => {
        await gate
        return { items: [radarItem('免费额度', 'https://example.com/b')], errors: [] }
      },
      crawlBrowserFeeds: async () => ({ items: [], errors: [] })
    }
  })
  const first = await call('/api/intel-center/radar/refresh', { method: 'POST', body: '{}' })
  assert.equal(first.status, 202)
  const second = await call('/api/intel-center/radar/refresh', { method: 'POST', body: '{}' })
  assert.equal(second.status, 200)
  assert.equal(second.body.skipped, true)

  release()
  await waitJob(api.radarJob)
  assert.equal(api.radarJob.snapshot().status, 'succeeded')
})

test('POST /x/refresh 保留最新 200 条并按时间倒序，点赞只展示不影响排序', async () => {
  // 260 条：越往后越新；点赞故意与时间相反，用来验证排序看时间而不是看赞。
  const items = Array.from({ length: 260 }, (_, index) => ({
    id: `9000${index}`,
    title: `羊毛帖 ${index}`,
    url: `https://x.com/a/status/9000${index}`,
    likes: 1000 - index,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString()
  }))
  const { call, api } = await mount({
    deps: { crawlX: async () => ({ items, errors: [], scanned: items.length }) }
  })

  const started = await call('/api/intel-center/x/refresh', { method: 'POST', body: '{}' })
  assert.equal(started.status, 202)
  await waitJob(api.xJob)

  const status = await call('/api/intel-center/x/status')
  assert.equal(status.body.job.status, 'succeeded')
  assert.equal(status.body.limit, X_TOP_LIMIT)
  assert.deepEqual(status.body.hours, RUN_HOURS)
  assert.equal(status.body.job.result.count, X_TOP_LIMIT)

  const state = await call('/api/intel-center/state')
  const stored = state.body.state.x.items
  assert.equal(stored.length, X_TOP_LIMIT, '只保留上限条数')
  assert.equal(stored[0].title, '羊毛帖 259', '最新的排第一')
  assert.equal(stored[0].rank, 1, '排名跟时间序一致')
  assert.equal(stored[0].likes, 741, '点赞仍然保留展示')
  const times = stored.map((item) => Date.parse(item.createdAt))
  assert.deepEqual(times, [...times].sort((a, b) => b - a), '整份榜单按时间从近到远')
})

test('POST /state 不覆盖刚抓到的榜单：卡片归用户，榜单归抓取任务', async () => {
  const { call, api } = await mount({
    deps: {
      collectServerSources: async () => ({ items: [radarItem('限免 3 天', 'https://example.com/c')], errors: [] }),
      crawlBrowserFeeds: async () => ({ items: [], errors: [] })
    }
  })
  await call('/api/intel-center/radar/refresh', { method: 'POST', body: '{}' })
  await waitJob(api.radarJob)

  const before = await call('/api/intel-center/state')
  const stale = before.body.state // 模拟界面挂载时读到的旧快照
  const written = await call('/api/intel-center/state', {
    method: 'POST',
    body: JSON.stringify({ ...stale, radar: { updatedAt: '', date: '', keywords: [], items: [] }, cards: [{ id: 'c1', title: '一张卡片' }] })
  })
  assert.equal(written.status, 200)
  assert.equal(written.body.state.cards.length, 1)
  assert.equal(written.body.state.radar.items.length, 1, '旧快照里的空榜单不能把新抓的条目抹掉')
})

test('别处改过文件时按 id 合并卡片并回报 conflict', async () => {
  const { call, api } = await mount({
    seedState: {
      version: 1,
      cards: [{ id: 'keep', title: '原有卡片', category: '免费VPS' }],
      topics: []
    }
  })
  // 先落一次盘，拿到非空 updatedAt 作为「界面读到的版本」。
  await api.store.write((await call('/api/intel-center/state')).body.state)
  const base = await call('/api/intel-center/state')
  const baseUpdatedAt = base.body.state.updatedAt
  assert.ok(baseUpdatedAt)

  // 模拟 Agent 在这期间往文件里加了一张卡片
  await api.store.write({
    ...base.body.state,
    cards: [
      ...base.body.state.cards,
      { id: 'agent', title: 'Agent 新增', category: '免费VPS' }
    ]
  })

  const written = await call('/api/intel-center/state', {
    method: 'POST',
    body: JSON.stringify({
      baseUpdatedAt,
      cards: [{ id: 'keep', title: '原有卡片（改了备注）', category: '免费VPS', note: '我试过了' }],
      topics: []
    })
  })
  assert.equal(written.status, 200)
  assert.equal(written.body.conflict, true, '并发写要明确告诉界面合并过')
  const ids = written.body.state.cards.map((card) => card.id).sort()
  assert.deepEqual(ids, ['agent', 'keep'], '双方的新增都不能丢')
  assert.equal(written.body.state.cards.find((card) => card.id === 'keep').note, '我试过了')
})

test('磁盘上有坏卡片时整份数据仍可读，坏的那张被跳过', async () => {
  const { call } = await mount({
    seedState: {
      version: 1,
      cards: [
        { id: 'good', title: '好卡片' },
        { id: 'bad' }
      ],
      topics: []
    }
  })
  const state = await call('/api/intel-center/state')
  assert.equal(state.status, 200, '一张坏卡片不该让整个工作台打不开')
  assert.deepEqual(state.body.state.cards.map((card) => card.id), ['good'])
})
