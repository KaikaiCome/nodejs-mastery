import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

const countTimeouts = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
const never = () => new Promise(() => {})

describe('retry', () => {
  test('失败后按指数退避重试，attempt 从 0 递增，最终返回成功值', async () => {
    const attempts = []
    const delays = []
    const result = await lab.retry(
      async (attempt) => {
        attempts.push(attempt)
        if (attempt < 2) throw new Error('boom')
        return 'ok'
      },
      { retries: 5, baseMs: 10, maxMs: 1000, random: () => 1, sleep: async (ms) => { delays.push(ms) } },
    )
    assert.equal(result, 'ok')
    assert.deepEqual(attempts, [0, 1, 2])
    assert.deepEqual(delays, [10, 20])
  })

  test('退避时间受 maxMs 封顶，并乘以 random()（full jitter）', async () => {
    const delays = []
    await assert.rejects(
      lab.retry(async () => { throw new Error('always') }, {
        retries: 5, baseMs: 100, maxMs: 500, random: () => 0.5,
        sleep: async (ms) => { delays.push(ms) },
      }),
      /always/,
    )
    assert.deepEqual(delays, [50, 100, 200, 250, 250])
  })

  test('重试次数用尽后抛出最后一次的错误，共调用 retries + 1 次', async () => {
    let calls = 0
    await assert.rejects(
      lab.retry(async (attempt) => { calls++; throw new Error(`fail-${attempt}`) }, {
        retries: 2, baseMs: 1, sleep: async () => {},
      }),
      { message: 'fail-2' },
    )
    assert.equal(calls, 3)
  })

  test('shouldRetry 返回 false 时不再重试', async () => {
    let calls = 0
    const err = Object.assign(new Error('bad request'), { status: 400 })
    await assert.rejects(
      lab.retry(async () => { calls++; throw err }, {
        retries: 5, baseMs: 1, sleep: async () => {}, shouldRetry: (e) => e.status >= 500,
      }),
      (e) => e === err,
    )
    assert.equal(calls, 1)
  })

  test('fn 执行中 abort：立即以 signal.reason 拒绝，不再发起新尝试', async () => {
    const ac = new AbortController()
    let calls = 0
    const reason = new Error('user cancelled')
    const p = lab.retry(() => { calls++; return never() }, { retries: 5, baseMs: 1, signal: ac.signal })
    setTimeout(() => ac.abort(reason), 10)
    const started = Date.now()
    await assert.rejects(p, (e) => e === reason)
    assert.ok(Date.now() - started < 500)
    await delay(20)
    assert.equal(calls, 1)
  })

  test('退避等待中 abort：即使 sleep 不理会 signal 也要立即拒绝', async () => {
    const ac = new AbortController()
    let calls = 0
    const reason = new Error('cancel during sleep')
    const p = lab.retry(async () => { calls++; throw new Error('fail') }, {
      retries: 5, baseMs: 1, signal: ac.signal, sleep: never,
    })
    setTimeout(() => ac.abort(reason), 10)
    await assert.rejects(p, (e) => e === reason)
    await delay(20)
    assert.equal(calls, 1)
  })

  test('signal 已经 abort 时不调用 fn', async () => {
    let calls = 0
    const reason = new Error('already')
    await assert.rejects(
      lab.retry(async () => { calls++ }, { signal: AbortSignal.abort(reason) }),
      (e) => e === reason,
    )
    assert.equal(calls, 0)
  })
})

describe('pTimeout', () => {
  test('promise 先完成时返回其结果', async () => {
    assert.equal(await lab.pTimeout(delay(5, 'v'), 1000), 'v')
  })

  test('promise 先失败时透传原错误', async () => {
    const err = new Error('inner')
    await assert.rejects(lab.pTimeout(Promise.reject(err), 1000), (e) => e === err)
  })

  test('超时以 name === "TimeoutError" 的 Error 拒绝', async () => {
    await assert.rejects(lab.pTimeout(never(), 20), (e) => e instanceof Error && e.name === 'TimeoutError')
  })

  test('promise 先完成后必须清除定时器（不留下悬挂的 Timeout）', async () => {
    const before = countTimeouts()
    await lab.pTimeout(Promise.resolve(1), 2_000)
    await lab.pTimeout(Promise.reject(new Error('x')), 2_000).catch(() => {})
    assert.equal(countTimeouts(), before)
  })

  test('signal abort 时以 signal.reason 拒绝并清除定时器', async () => {
    const ac = new AbortController()
    const reason = new Error('aborted')
    const before = countTimeouts()
    const p = lab.pTimeout(never(), 2_000, { signal: ac.signal })
    ac.abort(reason)
    await assert.rejects(p, (e) => e === reason)
    assert.equal(countTimeouts(), before)
  })
})

describe('mapLimit', () => {
  test('结果顺序与输入一致（即使完成顺序不同）', async () => {
    const result = await lab.mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
      await delay(ms)
      return `${i}:${ms}`
    })
    assert.deepEqual(result, ['0:30', '1:10', '2:20', '3:5'])
  })

  test('并发数永远不超过 limit，且能跑满 limit', async () => {
    let active = 0
    let maxActive = 0
    const items = Array.from({ length: 12 }, (_, i) => i)
    const result = await lab.mapLimit(items, 3, async (x) => {
      active++
      maxActive = Math.max(maxActive, active)
      await delay(5 + (x % 3) * 3)
      active--
      return x * 2
    })
    assert.equal(maxActive, 3)
    assert.deepEqual(result, items.map((x) => x * 2))
  })

  test('空数组直接返回 []', async () => {
    assert.deepEqual(await lab.mapLimit([], 3, async () => 1), [])
  })

  test('第一个错误立即 reject，失败后不再启动新任务', async () => {
    const started = []
    const err = new Error('task 1 failed')
    const p = lab.mapLimit(Array.from({ length: 10 }, (_, i) => i), 2, async (x) => {
      started.push(x)
      if (x === 1) {
        await delay(5)
        throw err
      }
      await delay(30)
      return x
    })
    await assert.rejects(p, (e) => e === err)
    await delay(80)
    assert.deepEqual(started, [0, 1])
  })
})
