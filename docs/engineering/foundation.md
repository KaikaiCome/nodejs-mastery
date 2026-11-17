# 配置、日志、错误、校验

这四件事决定一个服务是否“企业级”。

## 1. 配置：启动时校验，失败即退出

```ts
import { z } from 'zod'
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().default(3000)
})
export const config = schema.parse(process.env) // 缺配置立刻崩，而不是半夜出 bug
```

原则（12-Factor）：配置来自环境变量；密钥来自密钥管理（Vault/K8s Secret），**不进代码库**；`.env` 仅用于本地。

## 2. 日志：结构化 JSON + traceId

```ts
import pino from 'pino'
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password'], // 脱敏
  base: { service: 'bff-web', env: process.env.NODE_ENV }
})
// pino-http 自动记录访问日志，并为每个请求生成子 logger：req.log
```

- 为什么 pino：异步、低开销；`console.log` 在高并发下是同步写 stdout（TTY/文件时），会拖慢事件循环。
- 日志级别：`fatal` 进程将退出 / `error` 需要处理 / `warn` 异常但可自愈 / `info` 关键业务事件 / `debug` 排查。
- 每条日志必须带：`traceId`、`userId`（如有）、耗时、下游名称。
- 输出到 stdout，由采集器（Fluent Bit/Filebeat）送往 ELK/Loki。

## 3. 错误：分类 + 统一出口

```ts
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public expose = true,
    public cause?: unknown
  ) { super(message) }
}
export const Errors = {
  NotFound: (what: string) => new AppError('NOT_FOUND', `${what} not found`, 404),
  Unauthorized: () => new AppError('UNAUTHORIZED', 'Login required', 401),
  Forbidden: () => new AppError('FORBIDDEN', 'No permission', 403),
  Conflict: (msg: string) => new AppError('CONFLICT', msg, 409),
  Upstream: (name: string, cause: unknown) => new AppError('UPSTREAM_ERROR', `${name} unavailable`, 502, true, cause)
}
```

统一响应格式（团队约定一种即可）：

```json
{ "code": "NOT_FOUND", "message": "user not found", "requestId": "c1a…" }
```

- `4xx` 返回明确提示；`5xx` 对外只返回通用信息 + requestId，细节进日志。
- 错误码文档化，前端据此做交互（如 `UNAUTHORIZED` 跳登录）。

## 4. 校验：所有外部输入

```ts
const createUser = z.object({
  body: z.object({ email: z.string().email(), name: z.string().min(1).max(50), age: z.number().int().min(0).optional() })
})
export const validate = (schema) => (req, res, next) => {
  const r = schema.safeParse({ body: req.body, query: req.query, params: req.params })
  if (!r.success) return next(new AppError('VALIDATION_ERROR', r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), 400))
  Object.assign(req, { valid: r.data })
  next()
}
```

外部输入包括：请求参数、请求头、**下游服务响应**（BFF 尤其要校验下游返回，防止下游脏数据把前端搞崩）、消息队列消息、环境变量。

## 练习

为 `examples/express-basic` 加上：zod 配置校验、pino 日志（含 traceId）、`AppError` 统一错误输出。
