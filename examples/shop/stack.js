import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, silentLogger } from './lib/context.js'
import { createMetrics, registerRuntimeMetrics } from './lib/metrics.js'
import { openDb, migrate } from './lib/db.js'
import { listen } from './lib/http.js'
import { createUpstream } from './lib/upstream.js'
import { createLifecycle } from './lib/lifecycle.js'
import { createOrderStore, seedProducts } from './order-service/orders.js'
import { createOrderServer } from './order-service/server.js'
import { createOutboxRelay } from './order-service/outbox-relay.js'
import { createNotificationStore, createNotificationServer } from './notification-service/server.js'
import { createRecServer } from './rec-service/server.js'
import { createBffServer } from './bff/server.js'
import { createUserStore, createSessionStore, createLoginLimiter } from './bff/session.js'

const here = fileURLToPath(new URL('.', import.meta.url))
export const DEFAULT_PORTS = { bff: 4000, order: 4001, notification: 4002, rec: 4003 }

// 组装整套服务。测试用内存库 + 随机端口；本地运行用文件库 + 固定端口。
export async function startStack({
  dataDir = null,
  ports = { bff: 0, order: 0, notification: 0, rec: 0 },
  host = '127.0.0.1',
  serviceToken = 'dev-service-token',
  logLevel = 'info',
  quiet = false,
  relayIntervalMs = 200,
  recSettings = { latencyMs: 0, failRate: 0 },
  allowedOrigins,
  secureCookies = false,
  budgets,
  drainDelayMs = 0
} = {}) {
  const log = service => (quiet ? silentLogger : createLogger({ service, level: logLevel }))
  const metrics = createMetrics()
  const lifecycle = createLifecycle({ logger: log('lifecycle'), drainDelayMs })
  const stopRuntimeMetrics = registerRuntimeMetrics(metrics)
  lifecycle.onShutdown(() => stopRuntimeMetrics())

  if (dataDir) mkdirSync(dataDir, { recursive: true })
  const orderDb = openDb(dataDir ? join(dataDir, 'orders.db') : ':memory:')
  const notificationDb = openDb(dataDir ? join(dataDir, 'notifications.db') : ':memory:')
  const closeQuietly = db => { try { db.close() } catch {} }
  lifecycle.onShutdown(() => { closeQuietly(orderDb); closeQuietly(notificationDb) })
  migrate(orderDb, join(here, 'order-service', 'migrations'))
  migrate(notificationDb, join(here, 'notification-service', 'migrations'))
  seedProducts(orderDb)

  const faults = { order: { dropNextCommitResponses: 0 }, notification: { failNextEvents: 0 } }
  const orderStore = createOrderStore(orderDb)
  const notificationStore = createNotificationStore(notificationDb)

  const orderServer = lifecycle.addServer(createOrderServer({ store: orderStore, serviceToken, logger: log('order-service'), metrics, lifecycle, faults: faults.order }))
  const notificationServer = lifecycle.addServer(createNotificationServer({ store: notificationStore, serviceToken, logger: log('notification-service'), metrics, lifecycle, faults: faults.notification }))
  const recServer = lifecycle.addServer(createRecServer({ logger: log('rec-service'), metrics, lifecycle, settings: recSettings }))

  const urls = {}
  urls.order = await listen(orderServer, ports.order, host)
  urls.notification = await listen(notificationServer, ports.notification, host)
  urls.rec = await listen(recServer, ports.rec, host)

  const upstreams = {
    orders: createUpstream('order-service', urls.order, { serviceToken, timeoutMs: 1000, metrics }),
    notifications: createUpstream('notification-service', urls.notification, { serviceToken, timeoutMs: 300, metrics }),
    rec: createUpstream('rec-service', urls.rec, { serviceToken, timeoutMs: 300, metrics })
  }

  // 数组在 listen 之后补充：随机端口只有监听后才知道
  const origins = [...(allowedOrigins ?? [])]
  const bffServer = lifecycle.addServer(createBffServer({
    upstreams,
    users: createUserStore(),
    sessions: createSessionStore(),
    limiter: createLoginLimiter(),
    logger: log('bff'),
    metrics,
    lifecycle,
    webDir: join(here, 'web'),
    allowedOrigins: origins,
    secureCookies,
    ...(budgets ? { budgets } : {})
  }))
  urls.bff = await listen(bffServer, ports.bff, host)
  if (!allowedOrigins) {
    // 本地开发：同时允许 localhost 与 127.0.0.1 两种写法
    const port = new URL(urls.bff).port
    origins.push(`http://127.0.0.1:${port}`, `http://localhost:${port}`)
  }

  const relay = createOutboxRelay(orderDb, {
    logger: log('outbox-relay'),
    publish: async message => {
      const res = await upstreams.notifications('POST', '/events', { body: message, timeoutMs: 2000 })
      if (res.status >= 300) throw new Error(`notification-service responded ${res.status}`)
    }
  })
  if (relayIntervalMs > 0) relay.start(relayIntervalMs)
  // 注册顺序决定关闭顺序（后注册先关闭）：先停 relay，再关数据库
  lifecycle.onShutdown(() => relay.stop())

  return {
    urls,
    faults,
    recSettings,
    relay,
    metrics,
    lifecycle,
    db: { orders: orderDb, notifications: notificationDb },
    stores: { orders: orderStore, notifications: notificationStore },
    close: () => lifecycle.shutdown('stack.close')
  }
}
