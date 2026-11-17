import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start, internal, key } from './helpers.js'

let stack, alice, bob
before(async () => {
  stack = await start()
  alice = internal(stack.urls.order, 'u_alice')
  bob = internal(stack.urls.order, 'u_bob')
})
after(() => stack.close())

const stock = id => stack.db.orders.prepare('SELECT available FROM inventory WHERE product_id = ?').get(id).available
const order = (client, items, k = key()) => client('POST', '/orders', { body: { items }, headers: { 'idempotency-key': k } })

test('内部接口必须携带 service token，不能伪造 x-user-id', async () => {
  const res = await fetch(`${stack.urls.order}/orders`, { headers: { 'x-user-id': 'u_alice' } })
  assert.equal(res.status, 401)
})

test('并发抢购最后 1 件：恰好 1 单成功，库存为 0', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    order(i % 2 ? alice : bob, [{ productId: 'p4', qty: 1 }])))
  const statuses = results.map(r => r.status).sort()
  assert.equal(statuses.filter(s => s === 201).length, 1)
  assert.equal(statuses.filter(s => s === 409).length, 19)
  assert.ok(results.filter(r => r.status === 409).every(r => r.body.code === 'OUT_OF_STOCK'))
  assert.equal(stock('p4'), 0)
})

test('多商品订单任一商品缺货时整单回滚', async () => {
  const before = stock('p1')
  const res = await order(alice, [{ productId: 'p1', qty: 1 }, { productId: 'p4', qty: 1 }])
  assert.equal(res.status, 409)
  assert.equal(stock('p1'), before, 'p1 的扣减必须随事务回滚')
})

test('幂等：同一个键重放返回同一订单，内容不同则拒绝', async () => {
  const k = key()
  const first = await order(alice, [{ productId: 'p3', qty: 2 }], k)
  const again = await order(alice, [{ productId: 'p3', qty: 2 }], k)
  assert.equal(first.status, 201)
  assert.equal(again.status, 200)
  assert.equal(again.headers.get('idempotent-replayed'), 'true')
  assert.equal(again.body.id, first.body.id)
  const misuse = await order(alice, [{ productId: 'p3', qty: 3 }], k)
  assert.equal(misuse.status, 422)
  assert.equal(misuse.body.code, 'IDEMPOTENCY_KEY_REUSED')
})

test('幂等键按用户隔离：不同用户使用相同键互不影响', async () => {
  const k = key()
  const a = await order(alice, [{ productId: 'p3', qty: 1 }], k)
  const b = await order(bob, [{ productId: 'p3', qty: 1 }], k)
  assert.equal(a.status, 201)
  assert.equal(b.status, 201)
  assert.notEqual(a.body.id, b.body.id)
})

test('输入校验', async () => {
  const cases = [
    [[], 'VALIDATION_ERROR'],
    [[{ productId: 'p1', qty: 0 }], 'VALIDATION_ERROR'],
    [[{ productId: 'p1', qty: 1.5 }], 'VALIDATION_ERROR'],
    [[{ productId: 'p1', qty: 6 }], 'VALIDATION_ERROR'],
    [[{ productId: 'p1', qty: 1 }, { productId: 'p1', qty: 1 }], 'VALIDATION_ERROR'],
    [[{ productId: 'nope', qty: 1 }], 'PRODUCT_NOT_FOUND']
  ]
  for (const [items, code] of cases) {
    const res = await order(alice, items)
    assert.equal(res.status, 400, JSON.stringify(items))
    assert.equal(res.body.code, code)
  }
  const noKey = await alice('POST', '/orders', { body: { items: [{ productId: 'p1', qty: 1 }] } })
  assert.equal(noKey.body.code, 'IDEMPOTENCY_KEY_REQUIRED')
})

test('状态机：支付幂等、已支付不能取消、取消只释放一次库存', async () => {
  const paid = (await order(alice, [{ productId: 'p2', qty: 1 }])).body
  assert.equal((await alice('POST', `/orders/${paid.id}/pay`)).body.status, 'PAID')
  assert.equal((await alice('POST', `/orders/${paid.id}/pay`)).status, 200, '重复支付请求应幂等成功')
  const cancelPaid = await alice('POST', `/orders/${paid.id}/cancel`)
  assert.equal(cancelPaid.status, 409)
  assert.equal(cancelPaid.body.code, 'INVALID_STATE')

  const before = stock('p2')
  const pending = (await order(alice, [{ productId: 'p2', qty: 2 }])).body
  assert.equal(stock('p2'), before - 2)
  const cancels = await Promise.all([1, 2, 3].map(() => alice('POST', `/orders/${pending.id}/cancel`)))
  assert.ok(cancels.every(r => r.status === 200 && r.body.status === 'CANCELLED'))
  assert.equal(stock('p2'), before, '并发取消也只能释放一次库存')
  assert.equal((await alice('POST', `/orders/${pending.id}/pay`)).body.code, 'INVALID_STATE')
})

test('越权访问他人订单返回 404（不暴露订单是否存在）', async () => {
  const mine = (await order(alice, [{ productId: 'p3', qty: 1 }])).body
  for (const [method, path] of [['GET', ''], ['POST', '/pay'], ['POST', '/cancel']]) {
    const res = await bob(method, `/orders/${mine.id}${path}`)
    assert.equal(res.status, 404)
  }
  assert.equal((await alice('GET', `/orders/${mine.id}`)).body.status, 'PENDING')
})

test('游标分页：不重复、不遗漏，非法游标返回 400', async () => {
  const carol = internal(stack.urls.order, 'u_carol')
  const created = []
  for (let i = 0; i < 7; i++) created.push((await order(carol, [{ productId: 'p3', qty: 1 }])).body.id)
  const seen = []
  let cursor = null
  do {
    const page = (await carol('GET', `/orders?limit=3${cursor ? `&cursor=${cursor}` : ''}`)).body
    assert.ok(page.items.length <= 3)
    assert.ok(page.items.every(o => o.items.length === 1), '订单项应被批量加载')
    seen.push(...page.items.map(o => o.id))
    cursor = page.nextCursor
  } while (cursor)
  assert.deepEqual(new Set(seen), new Set(created))
  assert.equal(seen.length, 7)
  const bad = await carol('GET', '/orders?cursor=not-a-cursor')
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, 'INVALID_CURSOR')
})

test('每次状态变化都在同一事务中写入 outbox', async () => {
  const before = stack.db.orders.prepare('SELECT COUNT(*) AS n FROM outbox').get().n
  const o = (await order(alice, [{ productId: 'p3', qty: 1 }])).body
  await alice('POST', `/orders/${o.id}/pay`)
  const topics = stack.db.orders.prepare('SELECT topic FROM outbox ORDER BY id DESC LIMIT 2').all().map(r => r.topic)
  assert.deepEqual(topics, ['order.paid', 'order.created'])
  assert.equal(stack.db.orders.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, before + 2)
})
