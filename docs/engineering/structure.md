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

- 开发：`tsx watch src/main.ts`；生产：`tsc` 编译后 `node dist/main.js`。
- Node ≥ 22.18 / 23.6 默认支持**类型剥离**，可直接 `node src/main.ts`。但只支持“可擦除”的语法：`enum`、`namespace`、参数属性（`constructor(private x)`）等需要生成代码的写法会报错。启用 `"erasableSyntaxOnly": true`（TS ≥ 5.8）让编辑器提前发现；导入时写 `.ts` 扩展名并开启 `allowImportingTsExtensions`。类型检查仍需单独运行 `tsc --noEmit`。
- 规范：ESLint + Prettier + husky + lint-staged + commitlint。
- monorepo：`pnpm workspace`，抽 `packages/shared-types` 给前端与 BFF 共享。

## 类型安全的前后端契约

TypeScript 的类型在运行时不存在，`req.body as CreateOrderInput` 什么也没校验。可靠的做法是**以运行时 schema 为唯一来源，从中推导类型**：

```ts
// packages/contracts/order.ts —— 前端与 BFF 共享
import { z } from 'zod'
export const CreateOrderInput = z.object({
  items: z.array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(10) })).min(1).max(20)
})
export type CreateOrderInput = z.infer<typeof CreateOrderInput>

// BFF：边界处校验，之后的代码拿到的是真正可信的类型
const input = CreateOrderInput.parse(req.body)
```

- **对外 API**（多语言客户端、开放平台）：用 OpenAPI 描述，生成客户端与校验代码。
- **全 TS 团队内部**：共享 zod schema，或用 tRPC / ts-rest 直接共享路由类型。
- 下游服务返回的数据也是“外部输入”，同样要在 client 层校验，否则下游一次字段改名会以 `undefined` 的形式在页面上才暴露。
