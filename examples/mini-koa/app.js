// 运行：node examples/mini-koa/app.js
import { MiniKoa } from './mini-koa.js'

const app = new MiniKoa()

// 洋葱最外层：计时
app.use(async (ctx, next) => {
  const start = Date.now()
  await next()
  ctx.set('X-Response-Time', `${Date.now() - start}ms`)
  console.log(`${ctx.method} ${ctx.path} ${ctx.status} ${Date.now() - start}ms`)
})

// 统一响应包装
app.use(async (ctx, next) => {
  await next()
  if (ctx.status === 200 && ctx.body && typeof ctx.body === 'object') {
    ctx.body = { code: 0, data: ctx.body }
  }
})

// 路由
app.use(async (ctx) => {
  if (ctx.path === '/hello') {
    ctx.body = { hello: ctx.query.name ?? 'world' }
  } else if (ctx.path === '/error') {
    ctx.throw(400, 'something wrong in your request')
  } else if (ctx.path === '/crash') {
    throw new Error('secret internal detail')
  }
})

const port = process.env.PORT || 3002
app.listen(port, () => console.log(`mini-koa listening on http://localhost:${port}  (try /hello?name=node, /error, /crash)`))
