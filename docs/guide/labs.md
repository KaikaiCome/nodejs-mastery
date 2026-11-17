# 动手实验（自动判分）

读懂不等于会写。每个实验给你一个**空的实现**（`starter.js`）和一组**测试**，测试全部通过才算完成。测试专门覆盖容易写错的边界：资源泄漏、超时竞态、背压、并发重复请求等。

## 使用方法

需要 Node.js ≥ 22.13，无需安装任何依赖。

```bash
npm run lab                       # 列出全部实验
npm run lab -- async-control      # 运行某个实验的测试（针对你的 starter.js）
npm run lab -- async-control --solution   # 查看参考答案能否通过（卡住时再看）
```

每个实验目录 `labs/<name>/` 包含：

| 文件 | 说明 |
| --- | --- |
| `README.md` | 目标、背景、接口约定、验收标准、提示、延伸思考 |
| `starter.js` | 你要修改的文件 |
| `<name>.test.js` | 判分测试，不要修改 |
| `solution.js` | 参考答案，先独立完成再对照 |

全部通过后，在对应章节末尾勾选“实验已通过”，进度会显示在[学习路线](./roadmap#学习进度)中。

## 实验列表

| 实验 | 对应章节 | 你将实现 | 关键考点 |
| --- | --- | --- | --- |
| [`async-control`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/async-control) | [异步编程](../core/async) | `retry` / `pTimeout` / `mapLimit` | 定时器泄漏、AbortSignal、并发上限与结果顺序 |
| [`event-loop-yield`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/event-loop-yield) | [事件循环](../core/event-loop) | 分片处理大任务 | 分片间让步、`setImmediate` 与 `setTimeout` 的执行时机 |
| [`stream-upload`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/stream-upload) | [Buffer 与 Stream](../core/stream) | 流式上传 | 大小限制、边写边算哈希、失败时删除目标文件 |
| [`http-server`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/http-server) | [HTTP 与网络](../core/http) | 原生 HTTP 服务 | 路由、405 + `Allow`、413（含 chunked）、超时配置 |
| [`koa-timeout`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/koa-timeout) | [Koa](../framework/koa) | 超时中间件 | 洋葱模型、AbortSignal 传递、504 |
| [`cache-singleflight`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/cache-singleflight) | [数据库与缓存](../engineering/database) | 缓存 + single-flight | 击穿（并发合并）、穿透（空值缓存）、失败不缓存 |
| [`resilient-call`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/resilient-call) | [稳定性](../bff/resilience) | 弹性调用客户端 | deadline、单次超时、只重试幂等请求 |
| [`graceful-shutdown`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/graceful-shutdown) | [进程与集群](../core/process) | 优雅停机 | 排空请求、keep-alive 连接、强制退出兜底 |
| [`security`](https://github.com/KaikaiCome/nodejs-mastery/tree/main/labs/security) | [安全](../engineering/security) | 安全合并与 URL 校验 | 原型链污染、SSRF（私网地址、IP 变体写法） |

## 之后做什么

实验训练的是**单个知识点**。真实系统的难点在于它们的组合：超时与幂等如何配合、关闭顺序如何与后台任务协调、前端如何配合后端的重试语义。完成实验后进入[全栈主线项目](../mainline/overview)。
