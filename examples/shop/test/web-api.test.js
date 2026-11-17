import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, createCheckout, createApi } from '../web/api.js'

function fakeApi(responses) {
  const calls = []
  return {
    calls,
    createOrder: async (items, key) => {
      calls.push(key)
      const next = responses.shift()
      if (next instanceof Error) throw next
      return next
    }
  }
}

let n = 0
const opts = { newKey: () => `key-${++n}`, wait: async () => {} }

test('结果未知（网络错误 / 503）时用同一个幂等键重试', async () => {
  const api = fakeApi([new ApiError(0, {}), new ApiError(503, {}), { id: 'o1' }])
  const order = await createCheckout(api, opts).submit([{ productId: 'p1', qty: 1 }])
  assert.equal(order.id, 'o1')
  assert.equal(api.calls.length, 3)
  assert.equal(new Set(api.calls).size, 1)
})

test('业务错误不重试；同一购物车再次提交仍复用该键', async () => {
  const api = fakeApi([new ApiError(409, { code: 'OUT_OF_STOCK' }), { id: 'o2' }])
  const checkout = createCheckout(api, opts)
  await assert.rejects(checkout.submit([{ productId: 'p4', qty: 1 }]), { code: 'OUT_OF_STOCK' })
  assert.equal(api.calls.length, 1)
  await checkout.submit([{ productId: 'p4', qty: 1 }])
  assert.equal(api.calls[0], api.calls[1])
})

test('购物车变化或下单成功后换新键', async () => {
  const api = fakeApi([new ApiError(0, {}), new ApiError(0, {}), new ApiError(0, {}), { id: 'a' }, { id: 'b' }])
  const checkout = createCheckout(api, opts)
  await assert.rejects(checkout.submit([{ productId: 'p1', qty: 1 }]))
  await checkout.submit([{ productId: 'p1', qty: 2 }])
  await checkout.submit([{ productId: 'p1', qty: 2 }])
  const [k1, , , k2, k3] = api.calls
  assert.notEqual(k1, k2, '购物车变化 = 新的意图')
  assert.notEqual(k2, k3, '成功后再次下单 = 新的意图')
})

test('重复点击合并为同一个请求', async () => {
  let release
  const api = { calls: 0, createOrder: () => { api.calls++; return new Promise(r => { release = r }) } }
  const checkout = createCheckout(api, opts)
  const items = [{ productId: 'p1', qty: 1 }]
  const a = checkout.submit(items)
  const b = checkout.submit([...items])
  release({ id: 'x' })
  assert.equal(await a, await b)
  assert.equal(api.calls, 1)
})

test('API 层把网络异常和 HTTP 错误统一为 ApiError', async () => {
  const offline = createApi({ fetchImpl: async () => { throw new TypeError('fetch failed') } })
  await assert.rejects(offline.me(), { status: 0, code: 'NETWORK_ERROR' })
  const failing = createApi({ fetchImpl: async () => new Response(JSON.stringify({ code: 'OUT_OF_STOCK', message: '库存不足', requestId: 'r1' }), { status: 409 }) })
  await assert.rejects(failing.me(), { status: 409, code: 'OUT_OF_STOCK', requestId: 'r1' })
})
