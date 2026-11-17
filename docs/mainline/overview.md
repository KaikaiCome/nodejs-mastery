# 全栈主线项目：Node Shop

前面的章节解决“知道”，这一部分解决“做到”。你将完整读懂、运行、破坏并修复一个**真实形态**的全栈系统：

```text
浏览器（原生 ES Module）
   │  Cookie 会话 · CSRF · 幂等键
   ▼
BFF :4000  ──── 首页聚合 / 鉴权 / 视图模型 / 超时预算 / 降级
   │ service token + x-user-id + x-request-id
   ├──► 订单服务 :4001 ── SQLite（迁移 · 事务 · 条件更新 · 幂等表 · Outbox）
   │                         │ Outbox relay（至少一次）
   │                         ▼
   ├──► 通知服务 :4002 ── SQLite（Inbox 去重）
   └──► 推荐服务 :4003 ── 可注入延迟/失败（练习降级）
```

全部代码在 [`examples/shop`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/examples/shop)，**零第三方依赖**（`node:http`、`node:sqlite`、`fetch`、`node:test`），每一行都能读懂，没有框架魔法。读完后再看 Express/NestJS，你会清楚它们替你做了什么。

## 为什么要有这个项目

“会写 BFF”与“资深全栈”之间隔着这些问题，而它们**只有在真实数据和并发下才会暴露**：

| 问题 | 只会写接口时 | 本项目要求 |
| --- | --- | --- |
| 两个人同时买最后一件 | 先查库存再扣减 → 超卖 | 条件更新 + 事务，有并发测试证明 |
| 下单请求超时了 | 用户再点一次 → 两笔订单 | 幂等键与订单同事务写入，响应丢失也能安全重试 |
| 下单后发通知 | 下单后直接调用通知服务 → 它挂了怎么办？ | Outbox：事件与订单同事务，后台至少一次投递，消费端去重 |
| 推荐服务变慢 | 首页一起变慢 | 时间预算 + 非核心依赖降级，页面告诉用户哪里降级了 |
| 用户改 URL 看别人订单 | 能看到 | 所有查询带 `user_id`，越权一律 404 |
| 发布新版本 | 改表结构 → 旧版本报错 | 版本化迁移 + expand/contract，校验和防篡改 |
| 停机发布 | 在途请求被掐断 | 摘流量 → 等在途请求 → 关资源，有测试证明顺序 |

## 运行

```bash
npm run shop          # 启动全部服务，打开 http://127.0.0.1:4000（alice / alice123）
npm run test:shop     # 40+ 个测试：并发、幂等、越权、降级、关闭顺序……
node examples/shop/experiments/oversell.js   # 亲眼看到超卖

# 只跑部分测试：--test-name-pattern 必须写在文件参数之前
node --test --test-name-pattern="幂等" "examples/shop/test/*.test.js"
```

::: tip 环境要求
Node.js ≥ 22.13（使用内置 `node:sqlite`）。数据保存在 `examples/shop/.data/`，删除该目录即可重置。
:::

可调参数（环境变量）：

| 变量 | 作用 |
| --- | --- |
| `REC_LATENCY_MS=500` | 推荐服务变慢 → 观察首页降级 |
| `REC_FAIL_RATE=0.5` | 推荐服务一半请求失败 |
| `LOG_LEVEL=debug` | 查看完整 JSON 日志（带 requestId） |
| `DRAIN_DELAY_MS=5000` | 关闭前的摘流量等待时间 |
| `PORT` / `ORDER_PORT` / … | 修改端口 |
| `SERVICE_TOKEN` | 服务间凭证；`NODE_ENV=production` 时必须设置 |

## 代码地图

| 路径 | 内容 | 对应章节 |
| --- | --- | --- |
| `lib/db.js` + `*/migrations/` | 连接、事务、版本化迁移 | [数据建模与迁移](./data) |
| `order-service/orders.js` | 下单、状态机、分页（纯领域逻辑，不认识 HTTP） | [下单](./ordering)、[状态机](./state-machine) |
| `order-service/outbox-relay.js`、`notification-service/` | 事件投递与去重 | [Outbox](./outbox) |
| `lib/http.js` | 服务外壳：路由、请求体限制、错误出口、访问日志、指标、健康检查 | [BFF 与服务外壳](./bff) |
| `lib/upstream.js` | 下游调用：deadline、超时、重试、错误分类 | [BFF 与服务外壳](./bff) |
| `bff/` | 会话、CSRF、限流、聚合、视图模型 | [BFF 与服务外壳](./bff) |
| `web/` | 原生前端：幂等下单、错误展示、XSS 防护 | [前端协作](./frontend) |
| `lib/lifecycle.js`、`lib/metrics.js`、`scripts/load.js` | 优雅关闭、指标、压测 | [上线与运维](./operations) |
| `stack.js`、`start.js` | 组装全部服务（测试与本地运行共用） | — |

## 学习方式（重要）

每章都按同一节奏：

1. **读**：章节讲“为什么这样设计”以及被放弃的方案。
2. **跑**：运行对应测试，读懂每个断言在证明什么。
3. **破坏**：按章节的“破坏实验”删掉一行关键代码，看哪个测试失败、失败信息是什么。
4. **扩展**：完成章节末尾的练习，并为它写测试。

::: warning 别只读代码
只读不改，留下的只是“熟悉感”。资深工程师的能力来自**预测系统在故障下的行为，并被测试证实或推翻**。每章至少完成一次“破坏实验”，做完记得 `git checkout examples/shop` 还原。
:::

## 本项目刻意简化的地方

诚实地列出来，它们正是你在[资深全栈的进阶](./senior)中要补上的：

- SQLite + 同步 API 让事务天然不交错；PostgreSQL 中情况不同（每章都有对照说明）。
- 会话、限流存在内存中，只适用于单实例。
- 服务间使用共享 token，生产环境应使用 mTLS 或短期 JWT。
- Outbox relay 假设单实例；多实例需要 `FOR UPDATE SKIP LOCKED` 或租约。
- 没有真实支付、消息队列、容器编排，也没有 TypeScript 构建链。
