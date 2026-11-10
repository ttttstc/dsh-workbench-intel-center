import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createIntelStore } from '../dsh/store.js'

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'intel-center-test-'))
}

test('首次读取用种子数据初始化，并落盘 state.json', async () => {
  const root = await tempRoot()
  const store = createIntelStore(root)
  const state = await store.read()
  assert.ok(state.cards.length > 0, '种子应该带已核实的卡片')
  assert.equal(state.topics.length, 1)
  assert.match(state.topics[0].title, /羊毛福利/)
  for (const card of state.cards) {
    assert.ok(card.verifiedAt, `卡片 ${card.id} 缺少核实日期`)
    assert.ok(card.sources.length > 0, `卡片 ${card.id} 缺少来源`)
  }
  const file = path.join(root, 'state.json')
  assert.ok((await fs.stat(file)).size > 0)
})

test('写入后可读回，updatedAt 自动补齐', async () => {
  const root = await tempRoot()
  const store = createIntelStore(root)
  await store.read()
  const { state, bytes } = await store.write({
    cards: [{ id: 'card-1', title: '测试卡片', score: 4, status: 'confirmed', verifiedAt: '2026-11-09' }],
    topics: [{ id: 'topic-1', title: '主题一' }]
  })
  assert.ok(bytes > 0)
  assert.ok(state.updatedAt)
  const again = await store.read()
  assert.equal(again.cards.length, 1)
  assert.equal(again.cards[0].title, '测试卡片')
  assert.equal(again.cards[0].score, 4)
})

test('坏 JSON 不覆盖原文件，并报出可读错误', async () => {
  const root = await tempRoot()
  const store = createIntelStore(root)
  await store.read()
  await fs.writeFile(path.join(root, 'state.json'), '{ broken', 'utf8')
  await assert.rejects(() => store.read(), /不是合法 JSON/)
})

test('meta 报告真实文件路径与存在性', async () => {
  const root = await tempRoot()
  const store = createIntelStore(root)
  const meta = await store.meta()
  assert.equal(meta.file, path.join(root, 'state.json'))
  assert.equal(meta.exists, false)
  await store.read()
  assert.equal((await store.meta()).exists, true)
})

test('卸载不删数据：store 只在给定 root 下工作，不向上层写入', async () => {
  const root = await tempRoot()
  const store = createIntelStore(root)
  await store.read()
  const entries = await fs.readdir(root)
  assert.deepEqual(entries, ['state.json'])
})

test('缺少 root 时立即失败，避免写到意外位置', () => {
  assert.throws(() => createIntelStore(''), /缺少数据目录/)
})
