# Node.js 精通之路

面向**高级前端**的 Node.js 系统课程网站：从运行时原理到 Express/Koa，再到 **BFF 实战**、企业级工程化、后端架构设计与疑难杂症排查。

🌐 在线阅读：https://kaikaicome.github.io/nodejs-mastery/

## 课程目录

| 模块 | 内容 |
| --- | --- |
| 0. 开始 | 学习路线、证据等级、前端到后端的思维转变、动手实验指南 |
| 1. 核心原理 | 事件循环与 libuv、CJS/ESM、异步与错误处理、Buffer/Stream、HTTP、进程/线程/集群 |
| 2. Web 框架 | Express 原理（手写 mini-express）、Koa 洋葱模型（手写 compose）、Fastify/NestJS 选型 |
| 3. 企业级工程化 | 分层与目录、配置/日志/错误/校验、数据库与 Redis、测试体系、安全 |
| 4. BFF 专题 | 职责边界、聚合与裁剪、鉴权会话、超时/重试/熔断/降级、GraphQL 与 SSR |
| 5. 架构与后端思维 | 后端思维模型、DDD 与整洁架构、高并发与一致性、微服务与网关 |
| 6. 部署与可观测 | Docker/PM2/K8s、优雅关闭、Prometheus 指标、OpenTelemetry 链路追踪 |
| 7. 疑难杂症 | 排查手册、内存泄漏与 CPU 飙高、常见报错速查与真实案例 |
| 8. 全栈主线项目 | 迁移与事务、防超卖与幂等、状态机、Outbox/Inbox、BFF、前端协作、运维、走向资深 |
| 9. 实战与检验 | 毕业项目（含评分标准）、自检清单与面试题 |

网站功能：全文搜索、学习进度记录（区分“已阅读”与“实验已通过”，浏览器本地保存）、暗色模式。

## 动手实验

[`labs/`](labs) 下有 9 个自动判分实验，每个实验包含说明、待完成的 `starter.js`、判分测试与参考答案：

```bash
npm run lab                   # 列出实验
npm run lab -- async-control  # 运行测试，全部通过即完成
```

## 可运行示例

| 示例 | 说明 |
| --- | --- |
| [`examples/shop`](examples/shop) | **全栈主线项目**：BFF + 订单/通知/推荐服务 + 原生前端，SQLite 事务、幂等、Outbox、优雅关闭（40+ 个测试） |
| [`examples/event-loop`](examples/event-loop) | 事件循环执行顺序（含 ESM 与 CJS 的差异） |
| [`examples/mini-koa`](examples/mini-koa) | 手写 koa-compose 与 mini-koa（带测试） |
| [`examples/express-basic`](examples/express-basic) | Express 5 分层、zod 校验、统一错误、优雅关闭（带测试） |
| [`examples/bff-aggregation`](examples/bff-aggregation) | BFF 并行聚合、超时、熔断、降级、字段裁剪（带 mock 下游与测试） |
| [`examples/troubleshooting`](examples/troubleshooting) | 内存泄漏与事件循环阻塞排障练习 |

## 本地运行

```bash
npm install
npm run dev            # 本地预览网站
npm run build          # 构建静态站点
npm run shop           # 启动全栈主线项目 http://127.0.0.1:4000
npm test               # 示例 + 主线项目 + 实验参考答案的全部测试
```

需要 Node.js ≥ 22.13（主线项目使用内置的 `node:sqlite`）。CI 在 Node 22/24 上运行全部测试与构建；推送到 `main` 后，GitHub Actions 会自动部署到 GitHub Pages。

## License

MIT
