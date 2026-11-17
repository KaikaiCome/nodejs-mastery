import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { compose } from '../../examples/mini-koa/compose.js'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

const countTimeouts = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length

// 模拟一个会响应取消信号的慢查询
function slowWork(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(signal.reason)
    }, { once: true })
  })
}

test('快速处理：直接透传，不改状态码，signal 未被 abort', async () => {
  const ctx = {}
  await compose([
    lab.timeout(200),
    async (ctx) => {
      assert.ok(ctx.signal instanceof AbortSignal, '应在 ctx.signal 上提供 AbortSignal')
      await delay(5)
      ctx.status = 200
      ctx.body = 'ok'
    },
  ])(ctx)
  assert.equal(ctx.status, 200)
  assert.equal(ctx.body, 'ok')
  assert.equal(ctx.signal.aborted, false)
})

test('慢处理：超时返回 504 GATEWAY_TIMEOUT，且 ctx.signal 被 abort', async () => {
  const ctx = {}
  let downstreamError
  const started = Date.now()
  await compose([
    lab.timeout(30),
    async (ctx) => {
      try {
        await slowWork(1000, ctx.signal)
        ctx.body = 'too late'
      } catch (err) {
        downstreamError = err
        throw err
      }
    },
  ])(ctx)
  assert.ok(Date.now() - started < 500, '应在超时后尽快返回')
  assert.equal(ctx.status, 504)
  assert.deepEqual(ctx.body, { code: 'GATEWAY_TIMEOUT' })
  assert.equal(ctx.signal.aborted, true)
  await delay(5)
  assert.ok(downstreamError, '下游应通过 signal 感知到取消')
})

test('下游同步/异步抛错：原样向上传播', async () => {
  const err = new Error('db down')
  await assert.rejects(compose([lab.timeout(200), async () => { throw err }])({}), (e) => e === err)
  await assert.rejects(
    compose([lab.timeout(200), async () => { await delay(5); throw err }])({}),
    (e) => e === err,
  )
})

test('完成、出错、超时三种情况下都不留下活动定时器', async () => {
  const before = countTimeouts()
  await compose([lab.timeout(10_000), async (ctx) => { ctx.body = 'fast' }])({})
  await compose([lab.timeout(10_000), async () => { throw new Error('x') }])({}).catch(() => {})
  await compose([lab.timeout(10), (ctx) => slowWork(1000, ctx.signal)])({})
  await delay(5)
  assert.equal(countTimeouts(), before)
})

test('外层中间件能看到 504（洋葱模型）', async () => {
  const ctx = {}
  let seenStatus
  await compose([
    async (ctx, next) => { await next(); seenStatus = ctx.status },
    lab.timeout(20),
    (ctx) => slowWork(1000, ctx.signal),
  ])(ctx)
  assert.equal(seenStatus, 504)
})
