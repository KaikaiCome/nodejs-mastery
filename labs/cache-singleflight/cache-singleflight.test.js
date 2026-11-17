import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

function setup(loadImpl) {
  let t = 0
  const calls = []
  const cache = lab.createCache({
    ttlMs: 1000,
    now: () => t,
    load: async (key) => {
      calls.push(key)
      return loadImpl(key, calls.length)
    },
  })
  return { cache, calls, advance: (ms) => { t += ms } }
}

test('100 个并发 get 同一个未缓存 key：load 只调用 1 次（single-flight）', async () => {
  const { cache, calls } = setup(async (key) => {
    await delay(10)
    return { key }
  })
  const results = await Promise.all(Array.from({ length: 100 }, () => cache.get('a')))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls, ['a'])
  assert.ok(results.every((r) => r === results[0]), '所有调用者应拿到同一个结果')
  assert.deepEqual(results[0], { key: 'a' })
})

test('不同 key 互不影响', async () => {
  const { cache, calls } = setup(async (key) => key.toUpperCase())
  assert.deepEqual(await Promise.all([cache.get('a'), cache.get('b'), cache.get('a')]), ['A', 'B', 'A'])
  assert.equal(calls.length, 2)
})

test('TTL 内命中缓存不调用 load，过期后重新加载', async () => {
  const { cache, calls, advance } = setup(async (key, n) => `${key}-v${n}`)
  assert.equal(await cache.get('a'), 'a-v1')
  advance(999)
  assert.equal(await cache.get('a'), 'a-v1')
  assert.equal(calls.length, 1)
  advance(1)
  assert.equal(await cache.get('a'), 'a-v2')
  assert.equal(calls.length, 2)
})

test('null / undefined 结果也会被缓存（负缓存，防止缓存穿透）', async () => {
  const { cache, calls } = setup(async (key) => (key === 'missing' ? null : undefined))
  assert.equal(await cache.get('missing'), null)
  assert.equal(await cache.get('missing'), null)
  assert.equal(await cache.get('undef'), undefined)
  assert.equal(await cache.get('undef'), undefined)
  assert.equal(calls.length, 2)
})

test('load 失败：所有等待者都收到同一个错误，且错误不被缓存', async () => {
  const boom = new Error('db down')
  const { cache, calls } = setup(async (key, n) => {
    await delay(5)
    if (n === 1) throw boom
    return 'recovered'
  })
  const settled = await Promise.allSettled(Array.from({ length: 10 }, () => cache.get('a')))
  assert.equal(calls.length, 1)
  assert.ok(settled.every((s) => s.status === 'rejected' && s.reason === boom))
  assert.equal(await cache.get('a'), 'recovered')
  assert.equal(calls.length, 2)
})

test('delete(key) 后下一次 get 重新加载', async () => {
  const { cache, calls } = setup(async (key, n) => n)
  assert.equal(await cache.get('a'), 1)
  cache.delete('a')
  assert.equal(await cache.get('a'), 2)
  assert.equal(calls.length, 2)
})
