# 毕业项目：企业级电商 Web BFF

把全部知识串联起来，独立完成一个**可部署、可观测、可排障**的 BFF。

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

起点代码参考：`examples/bff-aggregation`。
