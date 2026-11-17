import { test } from 'node:test'
import assert from 'node:assert/strict'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

const noSleep = async () => {}

// 构造一个按脚本依次返回结果的假 request；'hang' 表示一直挂起直到 signal abort
function scripted(steps) {
  const calls = []
  const request = (attempt, { signal }) => {
    calls.push({ attempt, signal })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if (step === 'hang') {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }
    if (step === 'hang-ignore-signal') return new Promise(() => {})
    if (step instanceof Error) return Promise.reject(step)
    return Promise.resolve({ status: step, body: `status-${step}` })
  }
  return { request, calls }
}

const networkError = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })

test('首次成功：返回响应，request 收到 attempt 与 AbortSignal', async () => {
  const { request, calls } = scripted([200])
  const client = lab.createClient({ request, deadlineMs: 1000, attemptTimeoutMs: 200, retries: 2, sleep: noSleep })
  const res = await client.call({ idempotent: true })
  assert.deepEqual(res, { status: 200, body: 'status-200' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].attempt, 0)
  assert.ok(calls[0].signal instanceof AbortSignal)
})

test('幂等请求遇到 503 / 网络错误会重试直至成功', async () => {
  const { request, calls } = scripted([503, networkError(), 200])
  const client = lab.createClient({ request, deadlineMs: 1000, attemptTimeoutMs: 200, retries: 3, sleep: noSleep })
  const res = await client.call({ idempotent: true })
  assert.equal(res.status, 200)
  assert.deepEqual(calls.map((c) => c.attempt), [0, 1, 2])
})

test('幂等请求重试次数用尽：共调用 retries + 1 次，返回最后的 5xx 响应', async () => {
  const { request, calls } = scripted([502, 503, 504])
  const client = lab.createClient({ request, deadlineMs: 1000, attemptTimeoutMs: 200, retries: 2, sleep: noSleep })
  const res = await client.call({ idempotent: true })
  assert.equal(res.status, 504)
  assert.equal(calls.length, 3)
})

test('非幂等请求从不重试：503 原样返回，网络错误原样抛出', async () => {
  const a = scripted([503, 200])
  const clientA = lab.createClient({ request: a.request, deadlineMs: 1000, attemptTimeoutMs: 200, retries: 3, sleep: noSleep })
  assert.equal((await clientA.call({ idempotent: false })).status, 503)
  assert.equal(a.calls.length, 1)

  const err = networkError()
  const b = scripted([err, 200])
  const clientB = lab.createClient({ request: b.request, deadlineMs: 1000, attemptTimeoutMs: 200, retries: 3, sleep: noSleep })
  await assert.rejects(clientB.call(), (e) => e === err)
  assert.equal(b.calls.length, 1)
})

test('4xx 从不重试（即使是幂等请求）', async () => {
  for (const status of [400, 404, 409]) {
    const { request, calls } = scripted([status, 200])
    const client = lab.createClient({ request, deadlineMs: 1000, attemptTimeoutMs: 200, retries: 3, sleep: noSleep })
    assert.equal((await client.call({ idempotent: true })).status, status)
    assert.equal(calls.length, 1)
  }
})

test('单次超时：挂起的请求在 attemptTimeoutMs 后被 abort，幂等请求重试', async () => {
  const { request, calls } = scripted(['hang', 200])
  const client = lab.createClient({ request, deadlineMs: 1000, attemptTimeoutMs: 30, retries: 2, sleep: noSleep })
  const started = Date.now()
  const res = await client.call({ idempotent: true })
  assert.equal(res.status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].signal.aborted, true)
  assert.ok(Date.now() - started < 500)
})

test('总时限耗尽：以 DEADLINE_EXCEEDED 拒绝，不会无限重试', async () => {
  const { request, calls } = scripted(['hang'])
  const client = lab.createClient({ request, deadlineMs: 100, attemptTimeoutMs: 30, retries: 50, sleep: noSleep })
  const started = Date.now()
  await assert.rejects(client.call({ idempotent: true }), { code: 'DEADLINE_EXCEEDED' })
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 80 && elapsed < 400, `耗时应接近 deadline，实际 ${elapsed}ms`)
  assert.ok(calls.length >= 2 && calls.length <= 6, `调用次数应受 deadline 限制，实际 ${calls.length}`)
  assert.ok(calls.every((c) => c.signal.aborted))
})

test('单次超时大于剩余时间时，按剩余时间 abort（即使 request 不理会 signal）', async () => {
  const { request, calls } = scripted(['hang-ignore-signal'])
  const client = lab.createClient({ request, deadlineMs: 50, attemptTimeoutMs: 5000, retries: 3, sleep: noSleep })
  const started = Date.now()
  await assert.rejects(client.call({ idempotent: true }), { code: 'DEADLINE_EXCEEDED' })
  assert.ok(Date.now() - started < 400)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].signal.aborted, true)
})
