import test from 'node:test'
import assert from 'node:assert/strict'
import { createJob, lastRunOf } from '../dsh/jobs.js'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('任务从 idle 进 running，结束后 succeeded 并保留结果', async () => {
  let release = () => {}
  const gate = new Promise((resolve) => { release = resolve })
  const job = createJob({ name: 'demo', run: async () => { await gate; return { count: 3 } } })

  assert.equal(job.snapshot().status, 'idle')
  assert.equal(job.running, false)

  const started = job.start('manual')
  assert.equal(started.started, true)
  assert.equal(started.skipped, false)
  assert.equal(job.snapshot().status, 'running')
  assert.equal(job.running, true)

  release()
  const snapshot = await job.wait()
  assert.equal(snapshot.status, 'succeeded')
  assert.deepEqual(snapshot.result, { count: 3 })
  assert.equal(snapshot.error, '')
  assert.ok(snapshot.finishedAt, '结束时间要写上')
})

test('正在跑时再启动只返回 skipped，不叠加也不打断', async () => {
  let release = () => {}
  const gate = new Promise((resolve) => { release = resolve })
  let calls = 0
  const job = createJob({ run: async () => { calls += 1; await gate; return { count: 1 } } })

  job.start('manual')
  const second = job.start('scheduled')
  assert.equal(second.started, false)
  assert.equal(second.skipped, true)
  assert.equal(second.reason, 'already-running')

  release()
  await job.wait()
  assert.equal(calls, 1, '第二轮不应真的执行')
  assert.equal(job.snapshot().runs, 1)
})

test('失败被记成 failed，并保留可读原因', async () => {
  const job = createJob({
    run: async () => { throw new Error('CDP 代理没开') }
  })
  job.start('manual')
  const snapshot = await job.wait()
  assert.equal(snapshot.status, 'failed')
  assert.match(snapshot.error, /CDP 代理没开/)
  assert.equal(lastRunOf(job).ok, false)
  assert.match(lastRunOf(job).error, /CDP 代理没开/)
})

test('超过 timeoutMs 仍未结束的任务标记为失败，不永远停在 running', async () => {
  // 用可控的 gate 而不是 new Promise(() => {})：测试结束时必须让挂起的 promise 落地，
  // 否则 Node 20 的 test runner 会判定「promise 仍未结算，事件循环却已空」而直接判失败。
  let release = () => {}
  const gate = new Promise((resolve) => { release = resolve })
  const job = createJob({ timeoutMs: 20, run: () => gate })
  job.start('manual')
  const snapshot = await job.wait()
  assert.equal(snapshot.status, 'failed')
  assert.match(snapshot.error, /超过/)
  assert.equal(job.running, false)
  release({ count: 0 })
})

test('lastRunOf 在没跑过时给出 ok:null 的历史形状', () => {
  const job = createJob({ run: async () => ({ count: 0 }) })
  assert.deepEqual(lastRunOf(job), { at: '', ok: null, count: 0, error: '', reason: '' })
})

test('成功后 lastRunOf 兼容旧接口：ok / count / reason', async () => {
  const job = createJob({ run: async () => ({ count: 7, errors: ['V2EX 超时'] }) })
  job.start('scheduled')
  await job.wait()
  const last = lastRunOf(job)
  assert.equal(last.ok, true)
  assert.equal(last.count, 7)
  assert.equal(last.reason, 'scheduled')
  assert.match(last.error, /V2EX 超时/)
})

test('late 结果不覆盖新一轮：token 失效后忽略', async () => {
  const releases = []
  const job = createJob({
    timeoutMs: 50,
    run: () => new Promise((resolve) => { releases.push(resolve) })
  })
  job.start('manual')
  await flush()
  assert.equal(job.snapshot().status, 'running')
  // 超时后进入 failed，此时再启动第二轮；第一轮之后才 resolve，不应把状态改回去。
  await job.wait()
  assert.equal(job.snapshot().status, 'failed')
  job.start('manual')
  releases[0]({ count: 99 })
  await flush()
  assert.equal(job.snapshot().status, 'running', '第一轮的迟到结果不能改写第二轮状态')
  // 收尾：第二轮也要结算，否则测试结束时会留下挂起的 promise（Node 20 会因此判失败）。
  releases[1]({ count: 1 })
  await job.wait()
})
