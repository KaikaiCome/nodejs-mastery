import http from 'node:http'
import { compose } from './compose.js'

export class HttpError extends Error {
  constructor(status, message, expose = status < 500) {
    super(message)
    this.status = status
    this.expose = expose
  }
}

export class MiniKoa {
  middleware = []

  use(fn) {
    this.middleware.push(fn)
    return this
  }

  callback() {
    const fn = compose(this.middleware)
    return async (req, res) => {
      const url = new URL(req.url, 'http://localhost')
      const ctx = {
        req, res, state: {},
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        status: 404,
        _body: undefined,
        get body() { return this._body },
        set body(v) { this._body = v; if (this.status === 404) this.status = 200 },
        set(k, v) { res.setHeader(k, v) },
        throw(status, msg) { throw new HttpError(status, msg) }
      }
      try {
        await fn(ctx)
      } catch (err) {
        ctx.status = err.status || 500
        ctx._body = { message: err.expose ? err.message : 'Internal Server Error' }
        if (ctx.status >= 500) console.error(err)
      }
      respond(ctx)
    }
  }

  listen(...args) {
    return http.createServer(this.callback()).listen(...args)
  }
}

function respond(ctx) {
  const { res } = ctx
  res.statusCode = ctx.status
  const body = ctx._body
  if (body === undefined) return res.end(ctx.status === 404 ? 'Not Found' : undefined)
  if (typeof body === 'string' || Buffer.isBuffer(body)) return res.end(body)
  if (typeof body.pipe === 'function') return body.pipe(res)
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
