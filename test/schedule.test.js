import test from 'node:test'
import assert from 'node:assert/strict'
import { RUN_HOURS, createTickScheduler, dueSlot, normalizeHours, normalizeSettings, msUntilNextRun, nextRunAt, previousRunAt } from '../dsh/schedule.js'

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

test('normalizeHours：空值回默认，脏数据被过滤，去重升序', () => {
  assert.deepEqual(normalizeHours(undefined), RUN_HOURS)
  assert.deepEqual(normalizeHours(''), RUN_HOURS)
  assert.deepEqual(normalizeHours('8,12,16,20'), [8, 12, 16, 20])
  assert.deepEqual(normalizeHours('9，21'), [9, 21], '中文逗号也要能分')
  assert.deepEqual(normalizeHours([9, 9, 21, 99, -1, 'x']), [9, 21])
  assert.deepEqual(normalizeHours([0]), [0], '0 点是合法时间，不能当成空值')
})

test('previousRunAt 取「已过去的最近槽位」', () => {
  assert.equal(previousRunAt(new Date(2026, 10, 10, 13, 5)).getHours(), 12)
  assert.equal(previousRunAt(new Date(2026, 10, 10, 7, 59)).getHours(), 20, '凌晨取前一天 20:00')
  assert.equal(previousRunAt(new Date(2026, 10, 10, 12, 0)).getHours(), 12, '整点算已过去')
})

test('dueSlot：已经跑过不重复，错过太久不补，关了补跑就只认刚刚到点', () => {
  const now = new Date(2026, 10, 10, 13, 5)
  assert.equal(dueSlot(now, new Date(2026, 10, 10, 12, 0).toISOString()), null, '12:00 跑过了')
  assert.equal(dueSlot(now, new Date(2026, 10, 10, 11, 0).toISOString()) instanceof Date, true, '11:00 跑过、12:00 没跑 → 补')
  assert.equal(dueSlot(new Date(2026, 10, 10, 20, 30), new Date(2026, 10, 10, 12, 0).toISOString(), { hours: [8] }), null, '槽位距今超过 6 小时不再补')
  assert.equal(
    dueSlot(now, new Date(2026, 10, 10, 11, 0).toISOString(), { catchUp: false }),
    null,
    '关掉补跑后，晚 5 分钟的槽位不算'
  )
})

test('tick 调度器：到点调用 onDue，之后继续排下一个 tick', async () => {
  const timers = []
  const due = []
  let lastRunAt = new Date(2026, 10, 10, 11, 0).toISOString()
  const clock = { now: new Date(2026, 10, 10, 12, 1) }
  const scheduler = createTickScheduler({
    now: () => clock.now,
    getSettings: async () => normalizeSettings(),
    getLastRunAt: async () => lastRunAt,
    onDue: async () => { due.push(clock.now.getHours()) },
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return { unref() {} } },
    clearTimer: () => {},
    onScheduled: () => {}
  })
  scheduler.start()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(due, [12], '12:00 的槽位该补跑')
  assert.ok(timers.length >= 1, '跑完继续排 tick')
})

test('tick 调度器：停用后不触发，重复 tick 也不会重复跑', async () => {
  const due = []
  let lastRunAt = new Date(2026, 10, 10, 11, 0).toISOString()
  const clock = { now: new Date(2026, 10, 10, 12, 1) }
  let enabled = false
  const scheduler = createTickScheduler({
    now: () => clock.now,
    getSettings: async () => normalizeSettings({ scheduler: { enabled, hours: RUN_HOURS } }),
    getLastRunAt: async () => lastRunAt,
    onDue: async () => { due.push(1); lastRunAt = clock.now.toISOString() },
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {}
  })
  scheduler.start()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(due.length, 0, '停用时不跑')

  enabled = true
  await scheduler.runTick()
  assert.equal(due.length, 1, '启用后跑一次')
  await scheduler.runTick()
  assert.equal(due.length, 1, '同一槽位不重复跑')
})

test('stop 之后不再排 tick', () => {
  const timers = []
  const scheduler = createTickScheduler({
    now: () => new Date(2026, 10, 10, 9, 0),
    getSettings: async () => normalizeSettings(),
    getLastRunAt: async () => '',
    onDue: async () => {},
    setTimer: (fn, delay) => { timers.push({ fn, delay }); return { unref() {} } },
    clearTimer: () => {}
  })
  scheduler.start()
  const before = timers.length
  scheduler.stop()
  scheduler.start()
  assert.ok(timers.length >= before, 'restart 会重新排')
})
