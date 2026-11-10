import test from 'node:test'
import assert from 'node:assert/strict'
import { RUN_HOURS, createRefreshScheduler, msUntilNextRun, nextRunAt } from '../dsh/schedule.js'

test('刷新时段是 08 / 12 / 16 / 20 点，凌晨不刷', () => {
  assert.deepEqual(RUN_HOURS, [8, 12, 16, 20])
})

test('凌晨 03:30 不刷新，下一次是当天 08:00', () => {
  const next = nextRunAt(new Date(2026, 10, 10, 3, 30))
  assert.equal(next.getHours(), 8)
  assert.equal(next.getDate(), 10)
})

test('08:00 刚过，下一次是当天 12:00', () => {
  const next = nextRunAt(new Date(2026, 10, 10, 8, 0, 1))
  assert.equal(next.getHours(), 12)
})

test('12:00 整点顺延到 16:00，不会原地重跑', () => {
  const next = nextRunAt(new Date(2026, 10, 10, 12, 0, 0, 0))
  assert.equal(next.getHours(), 16)
})

test('20:00 之后到次日 08:00，期间不刷新', () => {
  const next = nextRunAt(new Date(2026, 10, 10, 22, 15))
  assert.equal(next.getHours(), 8)
  assert.equal(next.getDate(), 11)
})

test('msUntilNextRun 永远非负', () => {
  assert.ok(msUntilNextRun(new Date(2026, 10, 10, 23, 59)) > 0)
})

test('调度器按延迟排程，到点执行 run 并继续排下一次', async () => {
  const timers = []
  const scheduled = []
  let runs = 0
  const clock = { now: new Date(2026, 10, 10, 1, 0) }
  const scheduler = createRefreshScheduler({
    run: async () => { runs += 1 },
    now: () => clock.now,
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return { unref() {} } },
    clearTimer: () => {},
    onScheduled: (next) => scheduled.push(next.getHours())
  })
  scheduler.start()
  assert.equal(timers.length, 1)
  assert.equal(scheduled[0], 8, '凌晨排到当天 08:00')
  assert.equal(timers[0].delay, 7 * 60 * 60 * 1000, '01:00 距 08:00 是 7 小时')
  await timers[0].fn()
  assert.equal(runs, 1)
  assert.equal(timers.length, 2, '跑完继续排下一次')
})

test('stop 之后不再排程', () => {
  const timers = []
  const scheduler = createRefreshScheduler({
    run: async () => {},
    now: () => new Date(2026, 10, 10, 9, 0),
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return { unref() {} } },
    clearTimer: () => {},
    onScheduled: () => {}
  })
  scheduler.start()
  const before = timers.length
  scheduler.stop()
  scheduler.start()
  assert.equal(timers.length, before + 1, 'restart 会重新排一次')
})
