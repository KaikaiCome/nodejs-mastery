import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { createLifecycle } from '../lib/lifecycle.js'
import { createService, createRouter, listen } from '../lib/http.js'
import { createMetrics } from '../lib/metrics.js'
import { silentLogger } from '../lib/context.js'
import { runOversell } from '../experiments/oversell.js'

test('优雅关闭：摘流量 → 等在途请求完成 → 再关闭依赖', async () => {
  const events = []
  const lifecycle = createLifecycle({ drainDelayMs: 50, onForceExit: () => events.push('FORCED') })
  const router = createRouter().add('GET', '/slow', async () => {
    await sleep(150)
    events.push('request finished')
    return { ok: true }
  })
  const server = lifecycle.addServer(createService({ name: 't', router, logger: silentLogger, metrics: createMetrics(), isReady: lifecycle.isReady, isShuttingDown: lifecycle.isShuttingDown }))
  lifecycle.onShutdown(() => events.push('db closed'))
  lifecycle.onShutdown(() => events.push('relay stopped'))
  const base = await listen(server)
  // 用 keep-alive 连接发请求：关闭时必须能结束，而不是等到 keepAliveTimeout
  const agent = new http.Agent({ keepAlive: true })
  const get = path => new Promise((resolve, reject) => {
    http.get(base + path, { agent }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body, connection: res.headers.connection }))
    }).on('error', reject)
  })

  const inflight = get('/slow')
  await sleep(20)
  const shutdown = lifecycle.shutdown('test')
  const ready = await get('/readyz')
  assert.equal(ready.status, 503, 'readiness 先失败，负载均衡器据此摘流量')
  assert.equal(ready.connection, 'close')

  const res = await inflight
  assert.equal(res.status, 200, '在途请求正常完成')
  await shutdown
  assert.deepEqual(events, ['request finished', 'relay stopped', 'db closed'])
  await assert.rejects(get('/healthz'), '关闭后不再接受新连接')
  agent.destroy()
})

test('关闭不会被“已连接但从未发请求”的连接卡住（fetch 会预建这种备用连接）', async () => {
  let forced = false
  const lifecycle = createLifecycle({ timeoutMs: 1000, onForceExit: () => { forced = true } })
  const server = lifecycle.addServer(createService({ name: 't', router: createRouter(), logger: silentLogger, metrics: createMetrics() }))
  const { port } = new URL(await listen(server))
  const socket = net.connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const closed = once(socket, 'close')

  const startedAt = performance.now()
  await lifecycle.shutdown('test')
  await closed
  assert.ok(performance.now() - startedAt < 500, '应立即关闭，而不是等到 headersTimeout')
  assert.equal(forced, false)
})

test('超时兜底：资源关闭卡住时强制退出', async () => {
  let forced = false
  const lifecycle = createLifecycle({ timeoutMs: 50, onForceExit: () => { forced = true } })
  lifecycle.onShutdown(() => new Promise(() => {}))
  lifecycle.shutdown('test')
  await sleep(100)
  assert.ok(forced)
})

test('超卖实验：先读后写在并发下超卖，条件更新不会', async () => {
  const naive = await runOversell({ strategy: 'naive', buyers: 10, stock: 1 })
  assert.ok(naive.sold > 1, `naive 应超卖，实际成交 ${naive.sold}`)
  const safe = await runOversell({ strategy: 'safe', buyers: 10, stock: 1 })
  assert.equal(safe.sold, 1)
  assert.equal(safe.available, 0)
})
