import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

const listen = (server, agent) => {
  resources.add(() => forceCleanup(server, agent))
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

function get(port, path, agent) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.on('error', reject)
  })
}

// 即使某个用例超时（finally 未执行），也在文件结束时强制释放所有资源，避免进程挂起
const resources = new Set()
after(() => { for (const fn of resources) fn() })

function forceCleanup(server, agent) {
  agent?.destroy()
  server.closeAllConnections()
  if (server.listening) server.close()
}

test('停机等待在途请求（keep-alive 连接）完成后再执行 onClose，并拒绝新连接', { timeout: 3000 }, async () => {
  const events = []
  let markStarted
  const started = new Promise((r) => { markStarted = r })
  const app = lab.createGracefulServer(
    async (req, res) => {
      if (req.url === '/slow') {
        markStarted()
        await delay(150)
        events.push('request done')
      }
      res.end('done')
    },
    { onClose: async () => { events.push('onClose') }, timeoutMs: 2000, onForceExit: () => events.push('forceExit') },
  )
  const agent = new http.Agent({ keepAlive: true })
  try {
    const port = await listen(app.server, agent)
    // 预热：建立一条 keep-alive 连接
    assert.equal((await get(port, '/warmup', agent)).body, 'done')

    const inflight = get(port, '/slow', agent)
    await started
    await app.shutdown()

    const res = await inflight
    assert.equal(res.status, 200)
    assert.equal(res.body, 'done')
    assert.deepEqual(events, ['request done', 'onClose'])
    assert.equal(app.server.listening, false)
    await assert.rejects(get(port, '/', false), { code: 'ECONNREFUSED' })
  } finally {
    forceCleanup(app.server, agent)
  }
})

test('drain 期间 isReady() 为 false，服务仍在监听', { timeout: 3000 }, async () => {
  const app = lab.createGracefulServer((req, res) => res.end('ok'), { drainDelayMs: 80, onForceExit: () => {} })
  try {
    const port = await listen(app.server)
    assert.equal(app.isReady(), true)
    const done = app.shutdown()
    assert.equal(app.isReady(), false)
    await delay(20)
    assert.equal(app.server.listening, true, 'drain 期间不应立即停止监听')
    assert.equal((await get(port, '/', false)).body, 'ok')
    await done
    assert.equal(app.server.listening, false)
    assert.equal(app.isReady(), false)
  } finally {
    forceCleanup(app.server)
  }
})

test('多次调用 shutdown() 只执行一次 onClose', { timeout: 3000 }, async () => {
  let closes = 0
  const app = lab.createGracefulServer((req, res) => res.end(), { onClose: async () => { closes++ }, onForceExit: () => {} })
  try {
    await listen(app.server)
    await Promise.all([app.shutdown(), app.shutdown()])
    assert.equal(closes, 1)
  } finally {
    forceCleanup(app.server)
  }
})

test('超过 timeoutMs 仍未完成：调用 onForceExit', { timeout: 3000 }, async () => {
  let forced
  const forcedP = new Promise((r) => { forced = r })
  const app = lab.createGracefulServer((req, res) => res.end(), {
    onClose: () => new Promise(() => {}), // 模拟卡住的资源释放
    timeoutMs: 50,
    onForceExit: () => forced('forced'),
  })
  try {
    await listen(app.server)
    app.shutdown().catch(() => {})
    const ac = new AbortController()
    const result = await Promise.race([forcedP, delay(1000, 'not forced', { signal: ac.signal })])
    ac.abort()
    assert.equal(result, 'forced')
  } finally {
    forceCleanup(app.server)
  }
})

test('正常完成后不会调用 onForceExit', { timeout: 3000 }, async () => {
  let forced = false
  const app = lab.createGracefulServer((req, res) => res.end(), { timeoutMs: 50, onForceExit: () => { forced = true } })
  try {
    await listen(app.server)
    await app.shutdown()
    await delay(80)
    assert.equal(forced, false)
  } finally {
    forceCleanup(app.server)
  }
})
