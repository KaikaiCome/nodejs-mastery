import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { start, browser, key } from './helpers.js'

let stack
before(async () => { stack = await start({ budgets: { home: 800, write: 3000, read: 1500, optionalDependency: 150 } }) })
after(() => stack.close())

test('登录：Cookie 属性安全，错误密码统一提示，登录后才能访问', async () => {
  const user = browser(stack.urls.bff)
  assert.equal((await user.get('/bff/me')).status, 401)
  const bad = await user.login('alice', 'wrong')
  assert.equal(bad.status, 401)
  const unknown = await user.login('nobody', 'wrong')
  assert.equal(unknown.body.code, bad.body.code, '不存在的用户与错误密码不可区分')

  const ok = await user.login()
  assert.equal(ok.status, 200)
  const cookie = ok.headers.get('set-cookie')
  for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(attr), attr)
  assert.doesNotMatch(cookie, /Max-Age/i, '空闲超时由服务端滑动 TTL 决定，固定 Max-Age 会让活跃用户被强制登出')
  assert.equal((await user.get('/bff/me')).body.user.id, 'u_alice')
})

test('登录会轮换会话 ID，登出后旧会话失效', async () => {
  const user = browser(stack.urls.bff)
  await user.login()
  const first = user.cookie
  await user.login()
  assert.notEqual(user.cookie, first)
  const stale = await fetch(`${stack.urls.bff}/bff/me`, { headers: { cookie: first } })
  assert.equal(stale.status, 401)
  await user.post('/bff/logout')
  assert.equal((await user.get('/bff/me')).status, 401)
})

test('登录限流：连续失败 5 次后返回 429 + Retry-After', async () => {
  const user = browser(stack.urls.bff)
  for (let i = 0; i < 5; i++) assert.equal((await user.login('bob', 'wrong')).status, 401)
  const limited = await user.login('bob', 'bob123')
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  assert.equal((await browser(stack.urls.bff).login('alice')).status, 200, '限流按用户名区分，不影响其他用户')
})

test('登录限流：并发爆破也只能尝试 5 次', async () => {
  const user = browser(stack.urls.bff)
  const results = await Promise.all(Array.from({ length: 20 }, () => user.login('mallory', 'guess')))
  const statuses = results.map(r => r.status)
  assert.equal(statuses.filter(s => s === 401).length, 5, '计数必须发生在 await 密码校验之前')
  assert.equal(statuses.filter(s => s === 429).length, 15)
})

test('CSRF：跨站或缺少来源证明的写请求被拒绝', async () => {
  const user = browser(stack.urls.bff)
  await user.login()
  const body = { items: [{ productId: 'p3', qty: 1 }] }
  const evil = await user.request('POST', '/bff/orders', { body, headers: { origin: 'https://evil.example', 'idempotency-key': key() } })
  assert.equal(evil.status, 403)
  assert.equal(evil.body.code, 'CSRF_REJECTED')

  const res = await fetch(`${stack.urls.bff}/bff/logout`, { method: 'POST', headers: { cookie: user.cookie } })
  assert.equal(res.status, 403, '没有 Origin 也没有 Sec-Fetch-Site: same-origin')
  const sameSite = await fetch(`${stack.urls.bff}/bff/orders/x/cancel`, { method: 'POST', headers: { cookie: user.cookie, 'sec-fetch-site': 'same-origin' } })
  assert.equal(sameSite.status, 404, '通过 CSRF 检查后才会走到业务逻辑')
})

test('首页聚合：推荐服务超时 → 降级而不是整页失败，并在预算内返回', async () => {
  const user = browser(stack.urls.bff)
  await user.login()
  const ok = (await user.get('/bff/pages/home')).body
  assert.deepEqual(ok.degraded, [])
  assert.equal(ok.recommendations.length, 2)

  stack.recSettings.latencyMs = 1000
  try {
    const startedAt = performance.now()
    const res = await user.get('/bff/pages/home')
    const ms = performance.now() - startedAt
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.degraded, ['recommendations'])
    assert.deepEqual(res.body.recommendations, [])
    assert.ok(res.body.products.length > 0)
    assert.ok(ms < 600, `应在非核心依赖预算内返回，实际 ${ms.toFixed(0)}ms`)
  } finally {
    stack.recSettings.latencyMs = 0
  }
})

test('核心依赖故障：返回 502 + requestId，不泄漏内部细节', async t => {
  const broken = await start()
  t.after(() => broken.close())
  const user = browser(broken.urls.bff)
  await user.login()
  // 模拟数据库故障：订单服务内部报 500，BFF 对外只给通用错误
  broken.db.orders.close()
  const res = await user.get('/bff/pages/home')
  assert.equal(res.status, 502)
  assert.equal(res.body.code, 'UPSTREAM_ERROR')
  assert.equal(res.body.message, '服务暂时不可用，请稍后重试')
  assert.ok(res.body.requestId)
  assert.doesNotMatch(JSON.stringify(res.body), /sqlite|database|stack/i)
})

test('完整下单流程 + 视图模型 + 兼容旧字段 quantity', async () => {
  const user = browser(stack.urls.bff)
  await user.login()
  const created = await user.post('/bff/orders', { items: [{ productId: 'p1', quantity: 2 }] }, { headers: { 'idempotency-key': key() } })
  assert.equal(created.status, 201)
  assert.equal(created.body.total, '¥798.00')
  assert.equal(created.body.statusText, '待支付')
  assert.equal(created.body.canPay, true)
  assert.match(stack.metrics.render(), /bff_deprecated_field_total\{field="items.quantity"\} 1/)

  const paid = await user.post(`/bff/orders/${created.body.id}/pay`)
  assert.equal(paid.body.statusText, '已支付')
  assert.equal(paid.body.canCancel, false)

  const list = await user.get('/bff/orders')
  assert.equal(list.body.items[0].id, created.body.id)

  const stockout = await user.post('/bff/orders', { items: [{ productId: 'p2', qty: 5 }, { productId: 'p4', qty: 2 }] }, { headers: { 'idempotency-key': key() } })
  assert.equal(stockout.status, 409, '白名单内的业务错误透传给前端')
  assert.equal(stockout.body.code, 'OUT_OF_STOCK')

  const noKey = await user.post('/bff/orders', { items: [{ productId: 'p1', qty: 1 }] })
  assert.equal(noKey.status, 400)
})

test('请求体防护：非 JSON → 415，过大 → 413，坏 JSON → 400', async () => {
  const user = browser(stack.urls.bff)
  await user.login()
  const h = { 'idempotency-key': key() }
  assert.equal((await user.request('POST', '/bff/orders', { body: 'x', headers: { ...h, 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await user.request('POST', '/bff/orders', { body: `{"items":"${'a'.repeat(70_000)}"}`, headers: h })).status, 413)
  const bad = await user.request('POST', '/bff/orders', { body: '{oops', headers: h })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, 'INVALID_JSON')
})

test('静态资源：安全响应头 + 阻止路径穿越', async () => {
  const page = await fetch(`${stack.urls.bff}/`)
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/)
  assert.equal((await fetch(`${stack.urls.bff}/static/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8')
  for (const path of ['/static/..%2Fstack.js', '/static/..%5C..%5Cpackage.json', '/static/%2e%2e%2fstart.js']) {
    assert.equal((await fetch(stack.urls.bff + path)).status, 404, path)
  }
})

test('405 带 Allow 头；指标使用路由模板作为标签，避免基数爆炸', async () => {
  const res = await fetch(`${stack.urls.bff}/bff/orders`, { method: 'DELETE', headers: { origin: stack.urls.bff } })
  assert.equal(res.status, 405)
  assert.match(res.headers.get('allow'), /GET/)
  const metrics = await (await fetch(`${stack.urls.bff}/metrics`)).text()
  assert.match(metrics, /route="\/bff\/orders\/:id\/pay"/)
  assert.doesNotMatch(metrics, /route="\/bff\/orders\/[0-9a-f]{8}-/)
})

test('requestId 贯穿：客户端传入的合法 ID 原样返回', async () => {
  const res = await fetch(`${stack.urls.bff}/healthz`, { headers: { 'x-request-id': 'trace-abc-123456' } })
  assert.equal(res.headers.get('x-request-id'), 'trace-abc-123456')
  const injected = await fetch(`${stack.urls.bff}/healthz`, { headers: { 'x-request-id': 'bad id\twith spaces' } })
  assert.notEqual(injected.headers.get('x-request-id'), 'bad id\twith spaces')
})
