import express from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Errors } from './errors.js'

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(50)
})

const validateBody = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body)
  if (!r.success) return next(Errors.Validation(r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')))
  req.valid = r.data
  next()
}

// Controller：只做 HTTP 适配
function usersRouter(userService) {
  const router = express.Router()
  router.get('/', async (req, res) => res.json(await userService.list()))
  router.get('/:id', async (req, res) => res.json(await userService.getById(req.params.id)))
  router.post('/', validateBody(createUserSchema), async (req, res) => {
    res.status(201).json(await userService.create(req.valid))
  })
  return router
}

// app 与 listen 分离：测试时可直接注入依赖
export function createApp({ userService, logger = console }) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '100kb' }))

  app.use((req, res, next) => {
    req.id = req.get('x-request-id') || randomUUID()
    res.set('x-request-id', req.id)
    const start = performance.now()
    res.on('finish', () => logger.info?.(JSON.stringify({
      requestId: req.id, method: req.method, url: req.originalUrl, status: res.statusCode, ms: Math.round(performance.now() - start)
    })))
    next()
  })

  app.get('/healthz', (req, res) => res.send('ok'))
  app.use('/api/users', usersRouter(userService))

  app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Not Found', requestId: req.id }))

  // 统一错误处理：必须声明 4 个参数
  // Express 5 会自动把 async 处理函数中的异常传到这里
  app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500
    if (status >= 500) logger.error?.(err)
    res.status(status).json({
      code: err.code ?? (status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR'),
      message: status < 500 ? err.message : 'Internal Server Error',
      requestId: req.id
    })
  })
  return app
}
