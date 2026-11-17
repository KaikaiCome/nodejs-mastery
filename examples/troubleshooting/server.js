// 故意包含问题的服务，用于练习排查。运行：node --inspect examples/troubleshooting/server.js
import http from 'node:http'
import { monitorEventLoopDelay } from 'node:perf_hooks'

const loopDelay = monitorEventLoopDelay({ resolution: 20 })
loopDelay.enable()

// ❌ 问题 1：无界的模块级缓存（内存泄漏）
const requestCache = []

// ❌ 问题 2：每次请求都注册监听器且从不移除
import { EventEmitter } from 'node:events'
const bus = new EventEmitter()

function blockFor(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) { /* ❌ 问题 3：同步忙等，阻塞事件循环 */ }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (data) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)) }

  switch (url.pathname) {
    case '/ping':
      return send({ pong: Date.now() })

    case '/leak': {
      const n = Number(url.searchParams.get('n') ?? 100)
      for (let i = 0; i < n; i++) {
        requestCache.push({ id: i, payload: 'x'.repeat(1024), headers: { ...req.headers } })
        bus.on('tick', () => requestCache.length)
      }
      return send({ cached: requestCache.length, listeners: bus.listenerCount('tick') })
    }

    case '/block': {
      const ms = Math.min(Number(url.searchParams.get('ms') ?? 1000), 10_000)
      blockFor(ms)
      return send({ blockedMs: ms })
    }

    case '/stats': {
      const mem = process.memoryUsage()
      const mb = v => `${(v / 1024 / 1024).toFixed(1)}MB`
      const stats = {
        rss: mb(mem.rss), heapUsed: mb(mem.heapUsed), external: mb(mem.external),
        eventLoopDelayP99ms: (loopDelay.percentile(99) / 1e6).toFixed(1),
        eventLoopDelayMaxMs: (loopDelay.max / 1e6).toFixed(1)
      }
      loopDelay.reset()
      return send(stats)
    }

    default:
      res.statusCode = 404
      return send({ message: 'Not Found' })
  }
})

bus.setMaxListeners(0) // ❌ 问题 4：为了“消除警告”而关闭了泄漏告警

const port = process.env.PORT || 3001
server.listen(port, () => {
  console.log(`troubleshooting lab on http://localhost:${port}`)
  console.log('endpoints: /ping /leak?n=1000 /block?ms=3000 /stats')
  console.log('任务：找出 4 个问题并修复（答案见 README.md）')
})
