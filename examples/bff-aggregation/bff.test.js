import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CircuitBreaker } from './breaker.js'
import { createBff } from './server.js'
import { startUpstreams } from './upstreams.js'

async function withBff(upstreamOpts, bffOpts, fn) {
  const up = startUpstreams(upstreamOpts)
  const bff = createBff(up.urls, { log: () => {}, ...bffOpts }).listen(0)
  await new Promise(r => bff.once('listening', r))
  try {
    await fn(`http://127.0.0.1:${bff.address().port}`)
  } finally {
    bff.closeAllConnections(); bff.close(); up.close()
  }
}

test('aggregates upstreams and strips internal fields', async () => {
  await withBff({ recFailRate: 0, recSlowRate: 0 }, {}, async (base) => {
    const res = await fetch(`${base}/bff/home?uid=1`)
    assert.equal(res.status, 200)
    const { data } = await res.json()
    assert.deepEqual(data.degraded, [])
    assert.equal(data.recentOrders[0].amount, '129.90')
    assert.equal(data.recommendations.length, 2)
    assert.equal('passwordHash' in data.user, false)
  })
})

test('degrades recommendations when rec service is slow', async () => {
  await withBff({ recFailRate: 0, recSlowRate: 1, recSlowMs: 1000 }, { recTimeoutMs: 100 }, async (base) => {
    const start = Date.now()
    const { data } = await (await fetch(`${base}/bff/home?uid=1`)).json()
    assert.ok(Date.now() - start < 800, 'should not wait for slow upstream')
    assert.deepEqual(data.degraded, ['recommendations'])
    assert.deepEqual(data.recommendations, [])
  })
})

test('fails with 502 when core user service fails', async () => {
  await withBff({}, {}, async (base) => {
    const res = await fetch(`${base}/bff/home?uid=404`)
    assert.equal(res.status, 502)
    assert.equal((await res.json()).code, 'UPSTREAM_ERROR')
  })
})

test('validates input', async () => {
  await withBff({}, {}, async (base) => {
    assert.equal((await fetch(`${base}/bff/home`)).status, 400)
  })
})

test('circuit breaker opens, short-circuits, then recovers via half-open', async () => {
  let t = 0
  let calls = 0
  let healthy = false
  const breaker = new CircuitBreaker(async () => { calls++; if (!healthy) throw new Error('down'); return 'ok' }, {
    minimumRequests: 4, failureThreshold: 0.5, resetTimeoutMs: 1000, now: () => t
  })
  for (let i = 0; i < 4; i++) await assert.rejects(breaker.fire())
  assert.equal(breaker.state, 'OPEN')

  await assert.rejects(breaker.fire(), /circuit open/)
  assert.equal(calls, 4, 'open circuit must not call the upstream')

  t += 1000
  healthy = true
  assert.equal(await breaker.fire(), 'ok')
  assert.equal(breaker.state, 'CLOSED')
})
