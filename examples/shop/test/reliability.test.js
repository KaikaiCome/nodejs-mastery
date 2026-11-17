import { test } from 'node:test'
import assert from 'node:assert/strict'
import { start, browser, key } from './helpers.js'
import { openDb, migrate } from '../lib/db.js'
import { createOutboxRelay } from '../order-service/outbox-relay.js'
import { fileURLToPath } from 'node:url'

test('提交成功但响应丢失：BFF 用同一幂等键重试，只产生一笔订单', async t => {
  const stack = await start()
  t.after(() => stack.close())
  const user = browser(stack.urls.bff)
  await user.login()
  stack.faults.order.dropNextCommitResponses = 1
  const before = stack.db.orders.prepare('SELECT COUNT(*) AS n FROM orders').get().n
  const res = await user.post('/bff/orders', { items: [{ productId: 'p3', qty: 1 }] }, { headers: { 'idempotency-key': key() } })
  assert.equal(res.status, 200, '重试命中幂等记录，返回首次创建的订单')
  assert.equal(res.headers.get('idempotent-replayed'), 'true')
  assert.equal(stack.db.orders.prepare('SELECT COUNT(*) AS n FROM orders').get().n, before + 1)
})

test('Outbox 端到端：订单事件最终变成用户通知', async t => {
  const stack = await start()
  t.after(() => stack.close())
  const user = browser(stack.urls.bff)
  await user.login()
  const order = (await user.post('/bff/orders', { items: [{ productId: 'p1', qty: 1 }] }, { headers: { 'idempotency-key': key() } })).body
  await user.post(`/bff/orders/${order.id}/pay`)
  assert.deepEqual(await stack.relay.relayOnce(), { scanned: 2, published: 2 })
  const home = (await user.get('/bff/pages/home')).body
  assert.equal(home.notifications.unread, 2)
  assert.match(home.notifications.items[0].text, /支付成功/)
})

test('下游失败时 relay 退避重试，恢复后投递成功', async t => {
  const stack = await start()
  t.after(() => stack.close())
  const user = browser(stack.urls.bff)
  await user.login()
  await user.post('/bff/orders', { items: [{ productId: 'p3', qty: 1 }] }, { headers: { 'idempotency-key': key() } })
  stack.faults.notification.failNextEvents = 1
  assert.deepEqual(await stack.relay.relayOnce(), { scanned: 1, published: 0 })
  const row = stack.db.orders.prepare('SELECT attempts, next_attempt_at, last_error FROM outbox').get()
  assert.equal(row.attempts, 1)
  assert.match(row.last_error, /503/)
  assert.ok(row.next_attempt_at > new Date().toISOString(), '失败后应推迟下一次尝试')
  assert.deepEqual(await stack.relay.relayOnce(), { scanned: 0, published: 0 }, '退避期内不重试')
  stack.db.orders.prepare('UPDATE outbox SET next_attempt_at = ?').run(new Date(0).toISOString())
  assert.deepEqual(await stack.relay.relayOnce(), { scanned: 1, published: 1 })
  assert.equal(stack.relay.pending(), 0)
})

test('至少一次投递 + 消费端去重：发布后标记失败导致重投，通知不会重复', async t => {
  const stack = await start()
  t.after(() => stack.close())
  const user = browser(stack.urls.bff)
  await user.login()
  await user.post('/bff/orders', { items: [{ productId: 'p3', qty: 1 }] }, { headers: { 'idempotency-key': key() } })

  // 用一个“发布成功后崩溃”的 relay 模拟最危险的时刻：消息已送达，但还没来得及标记 published
  const crashy = createOutboxRelay(stack.db.orders, {
    publish: async m => {
      const res = await fetch(`${stack.urls.notification}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-service-token' },
        body: JSON.stringify(m)
      })
      assert.equal(res.status, 200)
    },
    hooks: { afterPublish: () => { throw new Error('crash before marking published') } },
    backoffMs: () => 0
  })
  await crashy.relayOnce()
  assert.equal(stack.relay.pending(), 1, '消息仍是未发布状态，将被再次投递')
  await stack.relay.relayOnce()
  assert.equal(stack.relay.pending(), 0)
  const inbox = stack.db.notifications.prepare('SELECT COUNT(*) AS n FROM notifications').get().n
  assert.equal(inbox, 1, '同一 message_id 只产生一条通知')
})

test('relay 的 start/stop 不会重叠执行，stop 会等待当前一轮完成', async () => {
  const db = openDb()
  migrate(db, fileURLToPath(new URL('../order-service/migrations', import.meta.url)))
  db.prepare("INSERT INTO outbox (message_id, topic, payload, created_at, next_attempt_at) VALUES ('m1', 't', '{}', 'x', '')").run()
  let concurrent = 0
  let maxConcurrent = 0
  let delivered = 0
  const relay = createOutboxRelay(db, {
    publish: async () => {
      maxConcurrent = Math.max(maxConcurrent, ++concurrent)
      await new Promise(r => setTimeout(r, 30))
      concurrent--
      delivered++
    }
  })
  relay.start(1)
  await new Promise(r => setTimeout(r, 15))
  await relay.stop()
  assert.equal(maxConcurrent, 1)
  assert.equal(delivered, 1, 'stop() 返回时在途的发布已经完成')
  assert.equal(relay.pending(), 0)
  db.close()
})
