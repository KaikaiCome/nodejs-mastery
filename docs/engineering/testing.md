# 测试体系

## 测试金字塔

| 层 | 对象 | 工具 | 比例 |
| --- | --- | --- | --- |
| 单元测试 | 纯函数、Service（mock 依赖） | `node:test` / Vitest / Jest | 多 |
| 集成测试 | HTTP 接口 + 真实 DB/Redis | supertest + Testcontainers | 中 |
| 契约测试 | BFF ↔ 下游接口约定 | Pact / schema 校验 | 关键接口 |
| E2E | 前端 + BFF 全链路 | Playwright | 少 |

## 内置测试运行器

```js
// user.service.test.js
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { UserService } from './user.service.js'

test('getById throws NOT_FOUND when missing', async () => {
  const repo = { findById: mock.fn(async () => null) }
  const svc = new UserService(repo)
  await assert.rejects(svc.getById('1'), { code: 'NOT_FOUND' })
  assert.equal(repo.findById.mock.callCount(), 1)
})
```

运行：`node --test`。

## 接口测试

```js
import request from 'supertest'
import { createApp } from '../src/app.js'

test('GET /api/users/:id', async () => {
  const app = createApp({ userService: { getById: async id => ({ id, name: 'A' }) } })
  const res = await request(app).get('/api/users/1').expect(200)
  assert.equal(res.body.name, 'A')
})
```

## 模拟下游 HTTP

```js
import { MockAgent, setGlobalDispatcher } from 'undici'
const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent)
agent.get('http://user-svc').intercept({ path: '/users/1' }).reply(200, { id: 1 })
agent.get('http://order-svc').intercept({ path: '/orders?uid=1' }).reply(500, {})
// 断言 BFF 在订单服务失败时降级返回空列表
```

## 原则

- 测**行为**不测实现；覆盖错误路径（超时、下游 500、非法参数）。
- 测试之间相互独立；数据库用事务回滚或每次重建。
- CI 中必跑：lint → typecheck → unit → integration；覆盖率作为参考而非目标。
- 压测：`autocannon` / k6，上线前对关键接口给出 QPS 与 P99 基线。
