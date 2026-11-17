import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

const target = process.env.LAB_TARGET === 'solution' ? './solution.js' : './starter.js'
const lab = await import(new URL(target, import.meta.url))

const JSON_TYPE = 'application/json; charset=utf-8'
let server
let port

before(async () => {
  server = lab.createApp()
  assert.ok(server instanceof http.Server, 'createApp() 应返回 http.Server')
  assert.equal(server.listening, false, 'createApp() 不应自行 listen')
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})

after(async () => {
  if (!server?.listening) return
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, agent: false, headers: body ? { 'content-type': 'application/json' } : {} },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json
          try { json = JSON.parse(text) } catch { json = undefined }
          resolve({ status: res.statusCode, headers: res.headers, text, json })
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

test('GET /health → 200 {ok:true}', async () => {
  const res = await request('GET', '/health')
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, { ok: true })
  assert.equal(res.headers['content-type'], JSON_TYPE)
})

test('路径匹配忽略查询字符串：GET /health?verbose=1 → 200', async () => {
  const res = await request('GET', '/health?verbose=1')
  assert.equal(res.status, 200)
})

test('POST /echo 原样返回 JSON', async () => {
  const payload = { name: '张三', tags: ['a', 'b'], n: 1 }
  const res = await request('POST', '/echo', JSON.stringify(payload))
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, payload)
  assert.equal(res.headers['content-type'], JSON_TYPE)
})

test('请求体超过 1024 字节 → 413 PAYLOAD_TOO_LARGE', async () => {
  const res = await request('POST', '/echo', JSON.stringify({ data: 'x'.repeat(2000) }))
  assert.equal(res.status, 413)
  assert.equal(res.json?.code, 'PAYLOAD_TOO_LARGE')
  assert.equal(res.headers['content-type'], JSON_TYPE)
})

test('分块传输（无 Content-Length）超过 1024 字节同样 → 413', async () => {
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/echo', agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks)) }))
    })
    req.on('error', reject)
    req.write('{"data":"')
    req.write('y'.repeat(1500))
    req.end('"}')
  })
  assert.equal(res.status, 413)
  assert.equal(res.json.code, 'PAYLOAD_TOO_LARGE')
})

test('非法 JSON → 400 INVALID_JSON', async () => {
  const res = await request('POST', '/echo', '{"broken": ')
  assert.equal(res.status, 400)
  assert.equal(res.json?.code, 'INVALID_JSON')
  assert.equal(res.headers['content-type'], JSON_TYPE)
})

test('未知路径 → 404 NOT_FOUND', async () => {
  const res = await request('GET', '/nope')
  assert.equal(res.status, 404)
  assert.equal(res.json?.code, 'NOT_FOUND')
  assert.equal(res.headers['content-type'], JSON_TYPE)
})

test('已知路径但方法错误 → 405，带 Allow 头', async () => {
  const a = await request('GET', '/echo')
  assert.equal(a.status, 405)
  assert.match(a.headers.allow ?? '', /POST/)
  assert.equal(a.headers['content-type'], JSON_TYPE)

  const b = await request('DELETE', '/health')
  assert.equal(b.status, 405)
  assert.match(b.headers.allow ?? '', /GET/)
})

test('keepAliveTimeout = 65000，headersTimeout = 66000', () => {
  assert.equal(server.keepAliveTimeout, 65_000)
  assert.equal(server.headersTimeout, 66_000)
})
