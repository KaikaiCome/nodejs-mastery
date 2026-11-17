# 可运行示例说明

仓库 [`examples/`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/examples) 目录下的示例都可以直接运行（Node.js ≥ 22.13）。

| 示例 | 依赖 | 运行 | 对应章节 |
| --- | --- | --- | --- |
| `shop` | 无 | `npm run shop` | [全栈主线项目](../mainline/overview) |
| `event-loop` | 无 | `node examples/event-loop/order.js` | [事件循环](../core/event-loop) |
| `mini-koa` | 无 | `node examples/mini-koa/app.js` | [Koa](../framework/koa) |
| `express-basic` | express, zod | `cd examples/express-basic && npm i && npm start` | [Express](../framework/express)、[工程化](../engineering/foundation) |
| `bff-aggregation` | 无 | `node examples/bff-aggregation/server.js` | [BFF 聚合](../bff/aggregation)、[稳定性](../bff/resilience) |
| `troubleshooting` | 无 | `node --inspect examples/troubleshooting/server.js` | [内存与 CPU](../troubleshooting/memory-cpu) |

另有 9 个自动判分的[动手实验](../guide/labs)位于 `labs/` 目录。

运行测试：

```bash
npm test                 # mini-koa + bff-aggregation + shop + 全部实验的参考答案
npm run test:examples    # 只跑 mini-koa 与 bff-aggregation
npm run test:shop        # 只跑主线项目
npm run test:labs        # 校验全部实验的参考答案

# express-basic 有自己的依赖
npm ci --prefix examples/express-basic
npm run test:express
```

CI（`.github/workflows/ci.yml`）在 Node 22 与 24 上运行以上全部测试和站点构建。

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
