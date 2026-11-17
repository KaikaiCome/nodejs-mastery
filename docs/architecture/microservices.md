# 微服务与网关

## 典型企业架构

```
            ┌─────────── CDN / WAF ───────────┐
用户 ──────►│        API 网关 / Ingress          │  TLS、路由、限流、鉴权初筛
            └───────┬──────────┬──────────────┘
                    ▼          ▼
               BFF-Web     BFF-App           (Node.js，前端团队)
                    │          │
       ┌────────────┼──────────┼───────────┐
       ▼            ▼          ▼           ▼
   用户服务      订单服务    商品服务    搜索/推荐   (Java/Go/Node，领域团队)
       │            │          │
     MySQL        MySQL      MySQL + ES     Redis / MQ / 对象存储
```

## 微服务的代价

- 分布式事务、网络失败、调用链变长。
- 部署、监控、排障复杂度剧增。
- 需要：服务发现、配置中心、链路追踪、统一日志、CI/CD、容器编排。

**拆分时机**：团队 > 2 个且互相阻塞发布；某模块有独立扩缩容需求；技术栈需要不同。

## 服务间通信

| 方式 | 特点 | Node 实现 |
| --- | --- | --- |
| HTTP/JSON | 简单通用 | undici |
| gRPC | 高性能、强类型（protobuf）、流式 | `@grpc/grpc-js` |
| 消息队列 | 解耦、异步、削峰 | BullMQ / kafkajs / amqplib |

```ts
// gRPC 客户端
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
const def = protoLoader.loadSync('user.proto')
const { UserService } = grpc.loadPackageDefinition(def).user as any
const client = new UserService('user-svc:50051', grpc.credentials.createInsecure())
client.GetUser({ id: '1' }, { deadline: Date.now() + 500 }, (err, user) => {})
```

## 网关职责

路由、TLS 终止、认证（JWT 校验）、限流、灰度/金丝雀（按 header/cookie/比例分流）、跨域、请求日志。选型：Nginx/OpenResty、Kong、APISIX、Envoy、云厂商 API Gateway。Node 写网关可行（如 `fastify-http-proxy`），但通常用成熟网关更稳。

## 服务治理

- **服务发现**：K8s Service DNS / Nacos / Consul。
- **配置中心**：Apollo / Nacos / K8s ConfigMap；支持热更新开关（降级开关、灰度比例）。
- **Service Mesh**：Istio/Linkerd 把重试、熔断、mTLS 下沉到 sidecar，业务代码更轻。

## 灰度发布

```
v1 (90%) ◄── 网关按规则 ──► v2 (10%)
观察错误率 / P99 / 业务指标 → 逐步放量 → 全量 / 一键回滚
```

BFF 场景常用：按用户 ID 哈希、按内部员工 Cookie、按 App 版本号灰度。

## 练习

画出你所在公司（或设想项目）的架构图，标注：BFF 的位置、每个下游的超时与降级策略、单点故障点。
