# Express 原理与实战

## 核心模型

Express = **路由 + 线性中间件栈**。每个中间件签名 `(req, res, next)`，调用 `next()` 进入下一个，`next(err)` 跳到错误中间件 `(err, req, res, next)`。

### 手写 mini-express（理解本质）

```js
const http = require('node:http')
function express() {
  const stack = []
  const app = (req, res) => {
    let i = 0
    const next = (err) => {
      const layer = stack[i++]
      if (!layer) return err ? (res.statusCode = 500, res.end('Error')) : (res.statusCode = 404, res.end('Not Found'))
      const { path, method, fn } = layer
      if (path && !req.url.startsWith(path)) return next(err)
      if (method && method !== req.method) return next(err)
      const isErrHandler = fn.length === 4
      try {
        if (err && isErrHandler) return fn(err, req, res, next)
        if (!err && !isErrHandler) return fn(req, res, next)
        next(err)
      } catch (e) { next(e) }
    }
    next()
  }
  app.use = (path, fn) => typeof path === 'function' ? stack.push({ fn: path }) : stack.push({ path, fn })
  app.get = (path, fn) => stack.push({ path, method: 'GET', fn })
  app.listen = (...a) => http.createServer(app).listen(...a)
  return app
}
```

> 注意：Express 通过 `fn.length === 4` 判断错误中间件，所以错误处理器**必须声明 4 个参数**。

## Express 5 的重要变化

Express 5（2024 年正式发布）：
- **async 处理函数抛出的错误/rejected Promise 会自动传给 `next(err)`**（Express 4 中会变成 unhandledRejection！）。
- 路由语法变化：`/*` 需写成 `/*splat`，可选参数 `/:file{.:ext}`。
- `req.query` 只读、`res.status()` 校验范围等。

Express 4 项目需要自行包装：

```js
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
```

## 企业级 Express 骨架

```js
import express from 'express'
import helmet from 'helmet'
import compression from 'compression'
import { randomUUID } from 'node:crypto'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)                  // 在 LB 之后，正确获取 req.ip / protocol
app.use(helmet())
app.use(compression())
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {              // traceId
  req.id = req.get('x-request-id') || randomUUID()
  res.set('x-request-id', req.id)
  next()
})
app.get('/healthz', (req, res) => res.send('ok'))
app.use('/api/users', usersRouter)
app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Not Found' }))
app.use((err, req, res, next) => {         // 统一错误处理
  const status = err.status || 500
  req.log?.error({ err }, 'request failed')
  res.status(status).json({
    code: err.code || 'INTERNAL_ERROR',
    message: status < 500 ? err.message : 'Internal Server Error', // 不泄露内部细节
    requestId: req.id
  })
})
```

## Router 与分层

```js
// routes/users.js —— 只做 HTTP 适配
const router = express.Router()
router.get('/:id', validate(idSchema), async (req, res) => {
  res.json(await userService.getById(req.params.id))
})
export default router
```

路由（Controller）只负责：解析参数 → 调 Service → 序列化响应。业务逻辑放 Service，数据访问放 Repository。见 [项目结构与分层](../engineering/structure)。

## 常见坑

| 现象 | 原因 |
| --- | --- |
| `Cannot set headers after they are sent` | 调用了两次 `res.send` / `next()` 后又响应；在 `res.json` 后忘记 `return` |
| 请求一直 pending | 中间件既没响应也没调用 `next()` |
| `req.body` 为 undefined | 未注册 `express.json()` 或 Content-Type 不匹配 |
| 错误处理器不生效 | 少写了第 4 个参数；或注册在路由之前 |
| `req.ip` 总是 LB 的 IP | 未设置 `trust proxy` |

## 练习

运行 `examples/express-basic`，加一个 `POST /users` 接口，带 zod 校验与 409 冲突处理。
