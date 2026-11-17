# 项目结构与分层

## 推荐目录（按领域模块 + 分层）

```
src/
├── main.ts                 # 启动：加载配置、创建 app、监听、优雅关闭
├── app.ts                  # 组装中间件与路由（便于测试时不 listen）
├── config/                 # 配置 schema 与加载
├── common/                 # 横切：errors, logger, middleware, utils
│   ├── errors.ts
│   ├── logger.ts
│   └── middleware/
├── infra/                  # 基础设施：db, redis, http-client, mq
├── modules/
│   ├── user/
│   │   ├── user.controller.ts   # HTTP 适配
│   │   ├── user.service.ts      # 业务逻辑
│   │   ├── user.repository.ts   # 数据访问
│   │   ├── user.schema.ts       # 入参校验 / DTO
│   │   └── user.test.ts
│   └── order/
└── types/
```

**按功能（模块）而不是按技术类型分目录**：改一个需求只动一个文件夹。

## 分层职责

| 层 | 职责 | 禁止 |
| --- | --- | --- |
| Controller | 解析请求、调用 service、组织响应 | 写业务规则、直接操作 DB |
| Service | 业务规则、事务边界、编排 | 依赖 `req/res` |
| Repository | 数据读写、SQL/ORM | 业务判断 |
| Infra | 外部系统客户端 | 业务逻辑 |

依赖方向：**Controller → Service → Repository/Infra**，下层不反向依赖上层。

## 依赖注入（不用框架也能做）

```ts
// 组装根（composition root）
export function createContainer(config: Config) {
  const db = createPool(config.db)
  const userRepo = new UserRepository(db)
  const userService = new UserService(userRepo, new MailClient(config.mail))
  return { db, userService }
}
// 测试时替换实现
const service = new UserService(fakeRepo, fakeMail)
```

好处：可测试、可替换、生命周期清晰。NestJS / Midway / `awilix` 可以自动化这一过程。

## app 与 server 分离

```ts
// app.ts
export function createApp(deps) { const app = express(); /* ... */ return app }
// main.ts
const app = createApp(createContainer(loadConfig()))
const server = app.listen(port)
// test：supertest(createApp(fakeDeps))
```

## TypeScript 工程配置要点

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

- 开发：`tsx watch src/main.ts`；生产：`tsc` 编译后 `node dist/main.js`（Node ≥ 22.6 也可 `--experimental-strip-types`，但生产仍建议编译）。
- 规范：ESLint + Prettier + husky + lint-staged + commitlint。
- monorepo：`pnpm workspace`，抽 `packages/shared-types` 给前端与 BFF 共享。
