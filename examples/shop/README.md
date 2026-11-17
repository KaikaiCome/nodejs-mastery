# shop：全栈主线项目

一个零依赖、可运行、带测试的小型电商系统，用来把课程中的知识点组合到同一个真实系统里。配套讲解见站点的“全栈主线项目”章节（`docs/mainline/`）。

需要 Node.js ≥ 22.13（使用内置 `node:sqlite`）。

```bash
npm run shop                  # 启动全部服务，打开 http://127.0.0.1:4000
npm run test:shop             # 运行全部测试（40+ 个）
node examples/shop/experiments/oversell.js         # 超卖实验
node examples/shop/scripts/load.js http://127.0.0.1:4000 50 10   # 压测：50 并发 10 秒
```

演示账号：`alice` / `alice123`，`bob` / `bob123`。生产环境（`NODE_ENV=production`）会启用 `Secure` Cookie，并拒绝使用默认的 `SERVICE_TOKEN` 启动。

## 架构

```text
浏览器 (web/) ──同源── BFF :4000 ──service token──┬── order-service :4001 ── SQLite (orders.db)
                                                   │        └─ outbox relay ──┐
                                                   ├── notification :4002 ◄───┘ SQLite (inbox)
                                                   └── rec-service :4003（非核心，可降级）
```

| 目录 | 内容 |
| --- | --- |
| `lib/` | 共享基础设施：服务外壳（`http.js`）、下游调用与 deadline（`upstream.js`）、SQLite 与迁移（`db.js`）、优雅关闭（`lifecycle.js`）、日志与上下文（`context.js`）、指标（`metrics.js`） |
| `order-service/` | 商品、库存、订单：条件更新防超卖、幂等键、状态机、游标分页、Outbox |
| `notification-service/` | Inbox 去重的事件消费者 |
| `rec-service/` | 可注入延迟与失败率的推荐服务 |
| `bff/` | 会话、CSRF、登录限流、页面聚合与降级、错误映射、视图模型 |
| `web/` | 原生 JS 前端：幂等下单状态机（`api.js`）、只用 `textContent` 渲染 |
| `stack.js` / `start.js` | 组装全部服务（测试与启动共用）/ 命令行入口 |
| `test/` | 迁移、订单并发、可靠性、BFF、前端 API、生命周期 |

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` / `ORDER_PORT` / `NOTIFICATION_PORT` / `REC_PORT` | 4000–4003 | 端口 |
| `SHOP_DATA_DIR` | `examples/shop/.data` | 数据库目录 |
| `SERVICE_TOKEN` | 开发默认值 | 服务间凭证；`NODE_ENV=production` 时必须设置 |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `REC_LATENCY_MS` / `REC_FAIL_RATE` | `0` | 推荐服务故障注入 |
| `DRAIN_DELAY_MS` | `0` | 优雅关闭时 readiness 失败后、停止接收连接前的等待时间 |

## 刻意的简化

SQLite 代替 PostgreSQL、内存会话与限流（单实例）、HTTP 轮询代替消息队列、relay 假设单实例、推荐服务无鉴权。每一项在生产中的做法见“进阶：走向资深”章节。
