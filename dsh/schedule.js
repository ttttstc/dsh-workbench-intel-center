/**
 * 定时刷新：每天 08:00–22:00 之间每 4 小时一次（08/12/16/20，本机时区），凌晨不刷新。
 *
 * 只做「下一次该在什么时候跑」与「到点调用 run」两件事；时间函数是纯函数，
 * 可以用假时钟测试，不依赖真实等待。
 */

export const RUN_HOURS = [8, 12, 16, 20]

/** 给定时刻之后的第一个预约时间。 */
export function nextRunAt(from = new Date(), hours = RUN_HOURS) {
  const base = new Date(from.getTime())
  for (const hour of hours) {
    const candidate = new Date(base.getTime())
    candidate.setHours(hour, 0, 0, 0)
    if (candidate.getTime() > base.getTime()) return candidate
  }
  const tomorrow = new Date(base.getTime())
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(hours[0], 0, 0, 0)
  return tomorrow
}

/** 距离下一次刷新还有多久（毫秒），用于界面显示。 */
export function msUntilNextRun(from = new Date(), hours = RUN_HOURS) {
  return Math.max(0, nextRunAt(from, hours).getTime() - from.getTime())
}

/**
 * 定时器外壳。
 * @param run 真正执行的抓取任务（异步）
 * @param hooks.onScheduled 每次排好下一次后回调（给界面用）
 */
export function createRefreshScheduler({
  hours = RUN_HOURS,
  run,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onScheduled = () => {},
  onError = () => {}
} = {}) {
  let timer = null
  let stopped = false

  function arm() {
    if (stopped) return null
    const next = nextRunAt(now(), hours)
    const delay = Math.max(1000, next.getTime() - now().getTime())
    timer = setTimer(async () => {
      try {
        await run()
      } catch (error) {
        onError(error)
      } finally {
        arm()
      }
    }, delay)
    if (typeof timer?.unref === 'function') timer.unref()
    onScheduled(next)
    return next
  }

  return {
    start() {
      stopped = false
      return arm()
    },
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
    },
    next() {
      return nextRunAt(now(), hours)
    }
  }
}
