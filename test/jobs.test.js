import test from 'node:test'
import assert from 'node:assert/strict'
import { createJob, lastRunOf } from '../dsh/jobs.js'

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
  // 注意：createJob 的超时定时器是 unref 的，如果 run() 永远不结算，事件循环会先空掉，
  // Node 20 的 test runner 就会报「promise 仍未结算」。所以这里让 run 用一个正常的（ref 的）
  // 定时器在超时之后才结算：既验证超时判定，又不给测试留下悬空 promise。
  const job = createJob({
    timeoutMs: 20,
    run: () => new Promise((resolve) => setTimeout(() => resolve({ count: 1 }), 60))
  })
  job.start('manual')
  const snapshot = await job.wait()
  assert.equal(snapshot.status, 'failed')
  assert.match(snapshot.error, /超过/)
  assert.equal(job.running, false)
  // 等 run 自己落地，测试结束时不留挂起 promise。
  await new Promise((resolve) => setTimeout(resolve, 70))
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

test('late 结果不覆盖新一轮：上一轮的迟到结果被忽略', async () => {
  let call = 0
  const job = createJob({
    timeoutMs: 30,
    // 第一轮 60ms 才返回（会先超时），第二轮 10ms 返回；都用普通定时器，测试结束前必然结算。
    run: () => {
      call += 1
      const round = call
      return new Promise((resolve) => setTimeout(() => resolve({ count: round }), round === 1 ? 60 : 10))
    }
  })
  job.start('manual')
  const first = await job.wait() // 30ms 超时 → failed
  assert.equal(first.status, 'failed')
  job.start('manual') // 立刻开第二轮
  await new Promise((resolve) => setTimeout(resolve, 90)) // 等第一轮的迟到结果也落地
  const snapshot = job.snapshot()
  assert.equal(snapshot.status, 'succeeded', '第二轮应成功')
  assert.equal(snapshot.result.count, 2, '第一轮的迟到结果不能覆盖第二轮')
  assert.equal(snapshot.runs, 2)
})
