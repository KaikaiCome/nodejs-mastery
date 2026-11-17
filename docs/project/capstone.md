# 毕业项目：企业级电商 Web BFF

把全部知识串联起来，**独立**完成一个可部署、可观测、可排障的 BFF。这是证据等级 **L4** 的检验：[全栈主线项目](../mainline/overview)给了你完整的参考实现，毕业项目要求你在没有现成代码的情况下，用不同的技术栈（TypeScript、Express/Koa/NestJS、Redis、真实容器）重新做出同等质量的系统。

::: tip 和主线项目的区别
主线项目是“读懂并改造”，毕业项目是“从零设计并自证”。可以参考主线项目的设计，但不要复制代码——评分重点是你能否**用测试、压测数据和演练报告证明**系统是可靠的。
:::

## 业务场景

为电商 Web 端开发 BFF，下游（可用 mock 服务模拟）：用户服务、商品服务、订单服务、推荐服务、库存服务。

## 功能需求

| 接口 | 要求 |
| --- | --- |
| `GET /bff/login` `/callback` `/logout` | OIDC 登录（可用模拟 SSO），Redis 会话，HttpOnly Cookie |
| `GET /bff/me` | 当前用户 |
| `GET /bff/pages/home` | 聚合 用户 + Banner + 推荐 + 未读消息；非核心降级 |
| `GET /bff/pages/product/:id` | 商品 + 库存 + 推荐；商品详情 Redis 缓存 + singleflight |
| `GET /bff/orders?cursor=` | 订单列表，DataLoader 批量补全商品信息，游标分页 |
| `POST /bff/orders` | 下单：参数校验、幂等键、调用订单服务（不重试） |
| `GET /bff/orders/export` | 流式导出 CSV |
| `GET /bff/notifications/stream` | SSE 推送 |

## 非功能需求（验收标准）

- **工程**：TypeScript strict；分层（controller/service/client）；ESLint；统一错误码；zod 校验配置与入参。
- **稳定性**：每个下游有超时、并发上限；推荐服务熔断 + 降级；请求 deadline；限流 `/bff/orders` POST。
- **安全**：helmet、CSRF 防护（SameSite + Origin 校验）、越权测试、日志脱敏。
- **可观测**：pino 结构化日志带 traceId；`/metrics`（HTTP + 下游 + 事件循环）；OpenTelemetry 追踪。
- **测试**：单元测试 + supertest 接口测试 + undici MockAgent 模拟下游失败；覆盖降级路径。
- **部署**：多阶段 Dockerfile、docker-compose（BFF + Redis + mock 服务 + Prometheus + Jaeger）、K8s 清单（探针、preStop、资源限制）、GitHub Actions CI。
- **性能**：给出 autocannon 压测报告：首页接口 QPS 与 P99；推荐服务注入 1s 延迟时首页 P99 仍 < 600ms。
- **文档**：README、架构图、3 篇 ADR、错误码文档、一份故障演练报告。

## 推荐目录

```
bff-web/
├── src/
│   ├── main.ts / app.ts / tracing.ts
│   ├── config/  common/{errors,logger,middleware}/
│   ├── infra/{redis,http-client,breaker,metrics}.ts
│   ├── clients/{user,product,order,rec}.client.ts
│   ├── modules/{auth,home,product,order,notification}/
│   └── types/
├── mock-services/
├── test/
├── deploy/{Dockerfile,docker-compose.yml,k8s/}
└── docs/{adr/,errors.md,runbook.md}
```

## 里程碑

1. **第 1 周**：脚手架 + 配置/日志/错误/校验 + mock 下游 + 首页聚合。
2. **第 2 周**：登录会话 + 订单 + 缓存 + 熔断降级 + 测试。
3. **第 3 周**：可观测 + Docker/K8s + 压测 + 故障演练 + 文档。

## 故障演练清单

- [ ] 推荐服务延迟 2s → 首页仍可用且标记 degraded
- [ ] Redis 宕机 → 登录态如何表现？是否有清晰错误与告警
- [ ] 注入内存泄漏 → 用 heap snapshot 定位
- [ ] 注入同步阻塞 → 用火焰图定位
- [ ] 滚动发布期间压测 → 无 5xx
- [ ] 订单服务提交成功但响应丢失 → 前端重试不产生重复订单
- [ ] 100 个并发请求抢购库存为 1 的商品 → 恰好 1 单成功

## 评分标准（满分 100，≥ 80 视为达到 L4）

每一项都需要**可检查的证据**（测试、命令输出、报告、截图），没有证据的项记 0 分。

| 维度 | 分值 | 满分要求 | 证据 |
| --- | --- | --- | --- |
| 正确性 | 20 | 防超卖、幂等下单、状态机并发安全，均有并发测试；越权访问被拒绝 | 测试代码 + CI 通过记录 |
| 稳定性 | 15 | 每个下游有超时与 deadline；非核心依赖降级且可见；熔断器三态有测试；只重试幂等请求 | 测试 + 故障演练报告 |
| 安全 | 10 | 会话 Cookie 属性正确、CSRF 防护、登录限流、日志脱敏、错误不泄漏内部信息 | 测试 + 响应样例 |
| 可观测性 | 10 | 结构化日志带 traceId、RED 指标（路由模板标签）、事件循环指标、跨服务追踪截图 | `/metrics` 输出 + Jaeger 截图 |
| 性能 | 10 | 压测报告含测试条件、QPS、P50/P99；推荐服务注入 1s 延迟时首页 P99 < 600ms；至少一次基于火焰图的优化及前后数据 | 压测报告 |
| 部署与运维 | 15 | 多阶段镜像、非 root、优雅关闭（滚动发布期间无 5xx）、探针配置合理、CI 全绿、runbook | 清单 + 发布期间压测结果 |
| 测试质量 | 10 | 覆盖失败路径（下游超时、5xx、网络错误、重复请求），而不只是成功路径；测试稳定不随机失败 | 测试代码 |
| 设计与文档 | 10 | 架构图、≥ 3 篇 ADR（含备选方案与推翻条件）、错误码文档、一次故障复盘 | `docs/` |

::: warning 自评容易偏高
建议请一位有后端经验的同事按上表评审，或者把项目公开后请社区 review。**能经受他人质疑的设计**才是资深工程师的设计。
:::

起点代码参考：`examples/bff-aggregation`（入门）与 `examples/shop`（[主线项目](../mainline/overview)，完整参考）。
