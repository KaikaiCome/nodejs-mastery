// 参考实现：原生 node:http 服务
import http from 'node:http'

const MAX_BODY_BYTES = 1024

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

// 读取请求体，超限时尽早返回 null（同时继续排空剩余数据，保证连接可复用）
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (declared > limit) {
      req.resume()
      return resolve(null)
    }
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        return resolve(null)
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

const routes = {
  '/health': {
    GET: (req, res) => sendJson(res, 200, { ok: true }),
  },
  '/echo': {
    POST: async (req, res) => {
      const raw = await readBody(req, MAX_BODY_BYTES)
      if (raw === null) {
        return sendJson(res, 413, { code: 'PAYLOAD_TOO_LARGE', message: `请求体不能超过 ${MAX_BODY_BYTES} 字节` })
      }
      let data
      try {
        data = JSON.parse(raw.toString('utf8'))
      } catch {
        return sendJson(res, 400, { code: 'INVALID_JSON', message: '请求体不是合法的 JSON' })
      }
      sendJson(res, 200, data)
    },
  },
}

export function createApp() {
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    const route = routes[pathname]
    if (!route) return sendJson(res, 404, { code: 'NOT_FOUND', message: `${pathname} 不存在` })

    const handler = route[req.method]
    if (!handler) {
      return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED' }, { allow: Object.keys(route).join(', ') })
    }

    try {
      await handler(req, res)
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { code: 'INTERNAL_ERROR' })
      else res.destroy(err)
    }
  })

  // 必须大于前置负载均衡器（如 AWS ALB 默认 60s）的空闲超时，避免 LB 复用已被关闭的连接导致 502
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  return server
}
