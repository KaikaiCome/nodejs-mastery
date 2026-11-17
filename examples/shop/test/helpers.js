import { startStack } from '../stack.js'

export const TOKEN = 'test-service-token'

// 测试默认关闭 relay 定时器，由测试手动调用 relayOnce()，结果确定、不依赖时序
export const start = (opts = {}) => startStack({ quiet: true, serviceToken: TOKEN, relayIntervalMs: 0, ...opts })

// 带 Cookie 的客户端，模拟同源浏览器页面（显式发送 Origin）
export function browser(base, { origin = base } = {}) {
  let cookie = ''
  async function request(method, path, { body, headers = {}, raw = false } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(origin && method !== 'GET' ? { origin } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    const text = await res.text()
    let data = text
    if (!raw) { try { data = text ? JSON.parse(text) : null } catch {} }
    return { status: res.status, headers: res.headers, body: data }
  }
  return {
    request,
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    login: (username = 'alice', password = `${username}123`) => request('POST', '/bff/login', { body: { username, password } }),
    get cookie() { return cookie }
  }
}

// 直接调用内部服务（模拟 BFF 的身份）
export function internal(base, userId = 'u_alice') {
  return async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-user-id': userId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }
}

let seq = 0
export const key = (prefix = 'test') => `${prefix}-${Date.now().toString(36)}-${(seq++).toString().padStart(6, '0')}`
