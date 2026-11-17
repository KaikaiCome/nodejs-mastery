// 与 DOM 无关的请求层：可以直接在 Node 中测试
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? `HTTP ${status}`)
    this.status = status
    this.code = body?.code ?? 'NETWORK_ERROR'
    this.details = body?.details
    this.requestId = body?.requestId
  }
}

export function createApi({ fetchImpl = (...args) => fetch(...args), base = '' } = {}) {
  async function request(method, path, { body, headers = {} } = {}) {
    let res
    try {
      res = await fetchImpl(base + path, {
        method,
        credentials: 'same-origin',
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch (cause) {
      // 网络错误：请求可能根本没到服务端，也可能已经执行成功只是响应丢了——结果未知
      const err = new ApiError(0, { code: 'NETWORK_ERROR', message: '网络异常，请检查连接' })
      err.cause = cause
      throw err
    }
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (!res.ok) throw new ApiError(res.status, data)
    return data
  }

  return {
    request,
    login: (username, password) => request('POST', '/bff/login', { body: { username, password } }),
    logout: () => request('POST', '/bff/logout'),
    me: () => request('GET', '/bff/me'),
    home: () => request('GET', '/bff/pages/home'),
    orders: cursor => request('GET', `/bff/orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    createOrder: (items, key) => request('POST', '/bff/orders', { body: { items }, headers: { 'idempotency-key': key } }),
    pay: id => request('POST', `/bff/orders/${encodeURIComponent(id)}/pay`),
    cancel: id => request('POST', `/bff/orders/${encodeURIComponent(id)}/cancel`)
  }
}

export const isRetriable = err => err instanceof ApiError && (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504)

const defaultKey = () => globalThis.crypto.randomUUID()
const defaultWait = ms => new Promise(r => setTimeout(r, ms))

// 下单流程的前端一半：
// - 同一份购物车复用同一个幂等键：结果未知时（网络错误/5xx）重试不会重复下单
// - 购物车变化或下单成功后换新键：新的意图 = 新的请求
// - 进行中的重复点击直接复用同一个 Promise
export function createCheckout(api, { newKey = defaultKey, maxAttempts = 3, wait = defaultWait } = {}) {
  let key = null
  let fingerprint = null
  let inflight = null

  async function attempt(items, myKey) {
    for (let i = 1; ; i++) {
      try {
        const order = await api.createOrder(items, myKey)
        if (key === myKey) { key = null; fingerprint = null }
        return order
      } catch (err) {
        if (!isRetriable(err) || i >= maxAttempts) throw err
        await wait(200 * 2 ** (i - 1))
      }
    }
  }

  return {
    submit(items) {
      const fp = JSON.stringify([...items].map(i => [i.productId, i.qty]).sort())
      if (inflight && inflight.fp === fp) return inflight.promise
      if (fp !== fingerprint || !key) {
        key = newKey()
        fingerprint = fp
      }
      const promise = attempt(items, key).finally(() => { if (inflight?.promise === promise) inflight = null })
      inflight = { fp, promise }
      return promise
    },
    get currentKey() { return key }
  }
}
