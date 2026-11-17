# 学习路线与精通标准

本课程面向**已有扎实 JS/TS 与前端工程化基础**的开发者。目标不是“会写接口”，而是：

1. 能解释 Node.js 运行时行为（为什么慢、为什么泄漏、为什么挂）。
2. 能用 Express / Koa（以及 NestJS/Fastify）搭建**企业级**服务。
3. 能独立设计并落地 **BFF 层**：聚合、鉴权、稳定性、可观测。
4. 具备后端架构思维：容量、一致性、可用性、演进。
5. 能定位并解决线上疑难问题。

## 学习路线

| 阶段 | 内容 | 建议时长 | 产出 |
| --- | --- | --- | --- |
| 0 | [思维转变](./mindset) | 0.5 天 | 写下你对“可靠服务”的理解 |
| 1 | [核心原理](../core/event-loop)：事件循环、模块、异步、Stream、HTTP、进程 | 2 周 | 手写静态服务器、流式文件上传 |
| 2 | [Express](../framework/express) / [Koa](../framework/koa) / [选型](../framework/compare) | 1 周 | 手写 mini-koa（≤100 行） |
| 3 | [工程化](../engineering/structure)：分层、配置、日志、错误、DB、测试、安全 | 2 周 | 一个带测试的 CRUD 服务脚手架 |
| 4 | [BFF 专题](../bff/overview) | 2 周 | 聚合 + 鉴权 + 熔断的 BFF |
| 5 | [架构与后端思维](../architecture/backend-thinking) | 1 周 | 一份架构设计文档（ADR） |
| 6 | [部署与可观测](../ops/deploy) | 1 周 | Docker 化 + 指标 + 链路追踪 |
| 7 | [疑难杂症](../troubleshooting/playbook) | 持续 | 复现并修复 3 类线上问题 |
| 8 | [毕业项目](../project/capstone) | 2~3 周 | 可部署的企业级 BFF |

::: tip 学习方法
每章三步走：**读原理 → 跑示例（`examples/` 目录）→ 做练习**。每章末尾点击“标记本章为已学完”记录进度。
:::

## 精通标准（自测）

- **入门**：会用 Express 写 REST 接口，会连数据库。
- **熟练**：理解中间件机制、统一错误处理、日志、配置、测试；能 Docker 部署。
- **精通**：
  - 能画出事件循环各阶段并解释 `setImmediate` vs `setTimeout` 顺序；
  - 能定位内存泄漏（heapdump 对比）与 CPU 热点（火焰图）；
  - 能设计带超时/重试/熔断/缓存的 BFF，并给出 SLO；
  - 能解释 keep-alive 超时导致 502 的根因并修复；
  - 能为一个业务给出分层/领域划分、数据一致性方案、灰度与回滚方案。

完整清单见 [精通自检清单](../project/checklist)。

## 学习进度

<ProgressBoard />
