import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../dsh/routes.js'

/** 用假 ctx 捕获 apply 注册的路由，再按真实 Request 调用。 */
function mount(root) {
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
  apply(ctx, { root })
  return async function call(pathname, init) {
    const route = routes.get(pathname)
    if (!route) throw new Error(`没有注册 ${pathname}`)
    const method = init?.method || 'GET'
    assert.ok(route.methods.includes(method), `${pathname} 不支持 ${method}`)
    const request = new Request(`http://localhost${pathname}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: init?.body
    })
    const response = await route.fetch(request)
    const type = response.headers.get('content-type') || ''
    const body = type.includes('application/json') ? await response.json() : await response.text()
    return { status: response.status, body, headers: response.headers }
  }
}

test('注册了 meta 与 state 两条路由', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-route-'))
  const call = mount(root)
  const meta = await call('/api/intel-center/meta')
  assert.equal(meta.status, 200)
  assert.equal(meta.body.plugin, 'dsh-workbench-intel-center')
  assert.equal(meta.body.file, path.join(root, 'state.json'))
})

test('GET state 首次读会带种子卡片', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-route-'))
  const call = mount(root)
  const { status, body } = await call('/api/intel-center/state')
  assert.equal(status, 200)
  assert.ok(body.state.cards.length > 0)
  assert.ok(body.state.topics.length > 0)
})

test('POST state 写入后 GET 能读回，并补齐 updatedAt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-route-'))
  const call = mount(root)
  await call('/api/intel-center/state')
  const written = await call('/api/intel-center/state', {
    method: 'POST',
    body: JSON.stringify({
      cards: [{ id: 'c1', title: '测试', score: 4, status: 'confirmed', verifiedAt: '2026-11-09' }],
      topics: []
    })
  })
  assert.equal(written.status, 200)
  assert.equal(written.body.state.cards.length, 1)
  assert.ok(written.body.state.updatedAt)
  const read = await call('/api/intel-center/state')
  assert.equal(read.body.state.cards[0].title, '测试')
})

test('POST 坏数据返回 400 与中文原因，不落库', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-route-'))
  const call = mount(root)
  await call('/api/intel-center/state')
  const bad = await call('/api/intel-center/state', { method: 'POST', body: '{"cards":[{"summary":[]}]}' })
  assert.equal(bad.status, 400)
  assert.match(bad.body.error, /缺少标题/)
  const after = await call('/api/intel-center/state')
  assert.ok(after.body.state.cards.length > 0, '原数据应保持不变')
})

test('POST 非 JSON 返回 400', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-route-'))
  const call = mount(root)
  const bad = await call('/api/intel-center/state', { method: 'POST', body: 'not json' })
  assert.equal(bad.status, 400)
  assert.match(bad.body.error, /不是合法 JSON/)
})

test('响应带 no-store，避免缓存旧卡片', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-route-'))
  const routes = new Map()
  apply({ connection: { fetch: { register: (route) => routes.set(route.path, route) } } }, { root })
  const response = await routes.get('/api/intel-center/state').fetch(
    new Request('http://localhost/api/intel-center/state')
  )
  assert.equal(response.headers.get('cache-control'), 'no-store')
})


test('Token 羊毛接口：返回抓取元信息', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-wool-'))
  const call = mount(root)
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('<html><head></head><body>羊毛列表</body></html>', { status: 200 })
  try {
    const { status, body } = await call('/api/intel-center/wool')
    assert.equal(status, 200)
    assert.equal(body.source, 'https://aihot.news/free-tokens')
    assert.ok(body.bytes > 0)
    assert.ok(body.fetchedAt)
  } finally {
    globalThis.fetch = original
  }
})

test('Token 羊毛页面：同源转发并注入 base', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-wool-'))
  const call = mount(root)
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('<html><head><meta charset="utf-8"></head><body>羊毛</body></html>', { status: 200 })
  try {
    const { status, body, headers } = await call('/api/intel-center/wool/page')
    assert.equal(status, 200)
    assert.match(headers.get('content-type') || '', /text\/html/)
    assert.match(body, /<base href="https:\/\/aihot\.news\/">/)
    assert.match(body, /羊毛/)
  } finally {
    globalThis.fetch = original
  }
})

test('Token 羊毛页面：源站失败时给可读的兜底页', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-wool-'))
  const call = mount(root)
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('down', { status: 503 })
  try {
    const page = await call('/api/intel-center/wool/page')
    assert.equal(page.status, 502)
    assert.match(page.body, /暂时取不到 Token 羊毛页面/)
    assert.match(page.body, /在新窗口打开源页面/)
    const meta = await call('/api/intel-center/wool')
    assert.equal(meta.status, 502)
    assert.match(meta.body.error, /503/)
  } finally {
    globalThis.fetch = original
  }
})
