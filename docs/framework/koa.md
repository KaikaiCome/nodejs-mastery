# Koa 洋葱模型与实战

## 洋葱模型

```
请求 → mw1 前 → mw2 前 → mw3 → mw2 后 → mw1 后 → 响应
```

```js
app.use(async (ctx, next) => {
  const start = Date.now()
  await next()                         // 等待下游全部执行完
  ctx.set('X-Response-Time', `${Date.now() - start}ms`)
})
```

相比 Express，Koa 的中间件可以**在下游执行完后继续处理**（计时、统一包装响应、统一捕获错误），且天然基于 async/await。

## 手写 koa-compose（面试与理解必备）

```js
function compose(middleware) {
  return function (ctx, next) {
    let index = -1
    function dispatch(i) {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i
      let fn = middleware[i]
      if (i === middleware.length) fn = next
      if (!fn) return Promise.resolve()
      try {
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)))
      } catch (err) {
        return Promise.reject(err)
      }
    }
    return dispatch(0)
  }
}
```

## 手写 mini-koa

```js
const http = require('node:http')
class MiniKoa {
  middleware = []
  use(fn) { this.middleware.push(fn); return this }
  listen(...args) {
    const fn = compose(this.middleware)
    return http.createServer(async (req, res) => {
      const ctx = { req, res, status: 404, body: undefined }
      try {
        await fn(ctx)
      } catch (err) {
        ctx.status = err.status || 500
        ctx.body = { message: err.expose ? err.message : 'Internal Server Error' }
      }
      res.statusCode = ctx.body === undefined ? ctx.status : (ctx.status === 404 ? 200 : ctx.status)
      const body = ctx.body
      if (body === undefined) return res.end()
      if (typeof body === 'string' || Buffer.isBuffer(body)) return res.end(body)
      if (typeof body?.pipe === 'function') return body.pipe(res)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }).listen(...args)
  }
}
```

## Context 设计

`ctx` 代理了 `ctx.request` / `ctx.response`：`ctx.body`、`ctx.status`、`ctx.query`、`ctx.get(header)`、`ctx.throw(400, 'bad')`、`ctx.state`（跨中间件传递数据，如当前用户）。

## 企业级 Koa 骨架

```js
import Koa from 'koa'
import Router from '@koa/router'
import bodyParser from '@koa/bodyparser'

const app = new Koa({ proxy: true })

// 1. 最外层：统一错误 + 统一响应格式
app.use(async (ctx, next) => {
  try {
    await next()
    if (ctx.body !== undefined && ctx.status < 300 && !ctx.state.raw) {
      ctx.body = { code: 0, data: ctx.body, requestId: ctx.state.requestId }
    }
  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = { code: err.code || 'INTERNAL_ERROR', message: err.expose ? err.message : 'Internal Server Error', requestId: ctx.state.requestId }
    ctx.app.emit('error', err, ctx)
  }
})
app.on('error', (err, ctx) => logger.error({ err, url: ctx?.url }))

// 2. traceId、访问日志
// 3. bodyParser、鉴权
app.use(bodyParser({ jsonLimit: '1mb' }))

const router = new Router({ prefix: '/api' })
router.get('/users/:id', async ctx => { ctx.body = await userService.getById(ctx.params.id) })
app.use(router.routes()).use(router.allowedMethods())
```

## 常见坑

| 现象 | 原因 |
| --- | --- |
| 404 但逻辑执行了 | 异步操作没 `await`，中间件返回后才赋值 `ctx.body` |
| 下游中间件没执行 | 忘了 `await next()` |
| 错误没被捕获 | `next()` 没 `await`/没 `return`，Promise 链断开 |
| 回调 API 设置 body 不生效 | 把回调包成 Promise 再 await |

## Egg.js / Midway

阿里系基于 Koa 的企业框架：约定式目录、插件、多进程模型（agent + workers）。Midway 提供 IoC/装饰器，与 NestJS 风格接近，适合国内大型团队。

## 练习

运行 `examples/mini-koa`，为其增加：`ctx.throw`、`ctx.query` 解析，以及一个超时中间件（超过 3s 返回 504）。
