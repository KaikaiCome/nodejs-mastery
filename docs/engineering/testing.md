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

## 测试难测的东西

成功路径谁都会测。区分初级与资深的，是能不能稳定地测出**并发、故障与时间**相关的 bug。下面的例子都来自[主线项目](../mainline/overview)的 `examples/shop/test/`。

### 并发：真的同时发起

```js
// 20 个请求抢最后 1 件库存：恰好 1 个 201、19 个 409，库存为 0 而不是负数
const results = await Promise.all(Array.from({ length: 20 }, () => post('/orders', ...)))
assert.equal(results.filter(r => r.status === 201).length, 1)
```

并发测试必须**断言不变量**（库存非负、订单数等于成功数），而不只是“没报错”。

### 故障：注入，而不是等它发生

```js
stack.faults.order.dropNextCommitResponses = 1   // 事务已提交，但连接被断开
// 断言：前端用同一个幂等键重试后，只存在一个订单
```

在被测系统中预留**故障注入点**（或用 MockAgent 返回 500/超时），把“响应丢失”“下游 503”“处理到一半崩溃”变成可重复的测试用例。

### 时间：手动驱动，不要 `sleep`

```js
// 测试中关闭 relay 定时器（relayIntervalMs: 0），由测试手动驱动每一轮
assert.deepEqual(await relay.relayOnce(), { scanned: 1, published: 0 })   // 下游失败
assert.deepEqual(await relay.relayOnce(), { scanned: 0, published: 0 })   // 退避期内不重试
db.prepare('UPDATE outbox SET next_attempt_at = ?').run(new Date(0).toISOString())   // “快进”时间
assert.deepEqual(await relay.relayOnce(), { scanned: 1, published: 1 })
```

`await sleep(1000)` 让测试变慢且不稳定。把后台循环做成可手动触发的、把 `now()` 做成可注入的（`createOutboxRelay` 接受 `now` 参数），测试就既快又确定。`node:test` 的 `mock.timers` 也能模拟定时器。

### 资源：测试结束时什么都不能剩

- 每个测试用 `t.after(() => stack.close())` 清理；端口传 `0` 由系统分配（`startStack` 的默认值），多个测试文件并行运行也不会冲突。
- 测试进程跑完却不退出，说明有句柄泄漏（未关闭的 server、定时器、数据库）。可用 `process.getActiveResourcesInfo()` 定位——[实验](../guide/labs) `async-control` 就用它检查定时器泄漏。

### 让测试证明它有用

对每个关键测试做一次“反向验证”：**故意改坏实现，确认测试会失败**。主线项目每章的“破坏实验”就是这个练习。一个改坏了代码仍然通过的测试，比没有测试更危险。

## 原则

- 测**行为**不测实现；覆盖错误路径（超时、下游 500、非法参数）。
- 测试之间相互独立；数据库用事务回滚或每次重建。
- CI 中必跑：lint → typecheck → unit → integration；覆盖率作为参考而非目标。
- 压测：`autocannon` / k6，上线前对关键接口给出 QPS 与 P99 基线。
