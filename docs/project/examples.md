# 可运行示例说明

仓库 [`examples/`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/examples) 目录下的示例都可以直接运行（Node.js ≥ 20）。

| 示例 | 依赖 | 运行 | 对应章节 |
| --- | --- | --- | --- |
| `event-loop` | 无 | `node examples/event-loop/order.js` | [事件循环](../core/event-loop) |
| `mini-koa` | 无 | `node examples/mini-koa/app.js` | [Koa](../framework/koa) |
| `express-basic` | express, zod | `cd examples/express-basic && npm i && npm start` | [Express](../framework/express)、[工程化](../engineering/foundation) |
| `bff-aggregation` | 无 | `node examples/bff-aggregation/server.js` | [BFF 聚合](../bff/aggregation)、[稳定性](../bff/resilience) |
| `troubleshooting` | 无 | `node --inspect examples/troubleshooting/server.js` | [内存与 CPU](../troubleshooting/memory-cpu) |

运行无依赖示例的测试：

```bash
npm run test:examples
# 等价于 node --test "examples/mini-koa/*.test.js" "examples/bff-aggregation/*.test.js"

# express-basic 的测试
cd examples/express-basic && npm i && npm test
```

## bff-aggregation 体验

```bash
node examples/bff-aggregation/server.js
curl http://localhost:3000/bff/home?uid=1
# 多请求几次，观察 degraded 字段与 breaker 状态
curl http://localhost:3000/bff/breakers
```

示例同时启动 3 个 mock 下游（用户、订单、推荐）。推荐服务随机变慢/失败，BFF 使用 超时 + allSettled 降级 + 熔断器。

## troubleshooting 体验

```bash
node --inspect examples/troubleshooting/server.js
# 打开 chrome://inspect → Memory 拍快照
curl "http://localhost:3001/leak?n=1000"   # 重复调用后再拍快照，Comparison 对比
curl "http://localhost:3001/block?ms=3000" # 同时另一个终端 curl /ping 观察被阻塞
curl http://localhost:3001/stats            # 查看事件循环延迟与内存
```
