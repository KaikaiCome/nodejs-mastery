# 精通自检清单与面试题

能清楚回答并**动手演示**下面每一项，即达到精通。

## 运行时

- [ ] 画出事件循环阶段图，解释 nextTick / Promise / setImmediate / setTimeout 执行顺序
- [ ] 哪些操作走 libuv 线程池？线程池耗尽有什么表现？
- [ ] V8 新生代/老生代 GC；为什么容器中要设置 `--max-old-space-size`
- [ ] Stream 背压原理；`pipe` 与 `pipeline` 区别
- [ ] CJS 与 ESM 的差异、互操作、循环依赖表现
- [ ] cluster 与 worker_threads 的区别与适用场景
- [ ] AsyncLocalStorage 原理与用途

## 框架

- [ ] 手写 koa-compose，解释为什么要 `i <= index` 检查
- [ ] Express 错误中间件如何识别？Express 4 的 async 错误为什么丢失？
- [ ] Koa 与 Express 中间件模型对比；何时选 NestJS/Fastify
- [ ] NestJS 请求生命周期（Middleware/Guard/Interceptor/Pipe/Filter）

## BFF

- [ ] BFF 的职责边界与反模式
- [ ] 如何设计首页聚合接口，核心与非核心依赖如何区分
- [ ] 超时链路如何设计？什么是 deadline 传递？
- [ ] 重试的前提条件；重试风暴如何避免
- [ ] 熔断器三种状态与参数含义；手写一个
- [ ] DataLoader 原理（同一 tick 批量 + 缓存）与为什么必须每请求新建
- [ ] Web 端登录态方案对比；BFF Token Handler 模式
- [ ] GraphQL 的 N+1、复杂度攻击与持久化查询

## 工程化与架构

- [ ] 分层与依赖方向；如何做依赖注入
- [ ] 统一错误处理与错误码设计
- [ ] 缓存穿透/击穿/雪崩与解决方案
- [ ] 幂等设计；分布式锁的问题；Outbox 模式
- [ ] 限流算法对比
- [ ] 如何估算容量与实例数
- [ ] 模块化单体与微服务拆分时机
- [ ] OWASP：越权、SSRF、原型污染、ReDoS 的防护

## 运维与排障

- [ ] 优雅关闭完整流程；Docker 中 PID 1 问题
- [ ] liveness 与 readiness 的区别，为何 liveness 不应检查下游
- [ ] keepAliveTimeout 导致 502 的原理
- [ ] 内存泄漏定位步骤（三次快照对比 + Retainers）
- [ ] CPU 火焰图怎么读
- [ ] 事件循环延迟如何监控、多大算异常
- [ ] RED 指标、标签基数问题
- [ ] OpenTelemetry 如何跨服务传递上下文

## 高频面试题（附思路）

1. **Node 为什么适合 I/O 密集？** 单线程事件循环 + 非阻塞 I/O，少量线程即可维持大量并发连接，无线程切换开销；CPU 密集会阻塞事件循环。
2. **如何让 Node 利用多核？** 多进程（cluster/PM2/多 Pod），CPU 任务用 worker_threads。
3. **服务内存一直涨怎么排查？** 先确认是否为泄漏（GC 后不回落）→ 区分堆内/堆外 → 快照对比 → Retainers → 修复验证。
4. **BFF 下游一个服务挂了，如何不影响页面？** 超时 + allSettled + 降级默认值 + 熔断 + 舱壁隔离 + 标记 degraded + 告警。
5. **如何保证接口幂等？** 幂等键 + Redis NX + 唯一索引 + 状态机条件更新。
6. **如何做到零停机发布？** 滚动更新 + readiness + preStop + SIGTERM 优雅关闭 + 向后兼容的迁移 + 灰度。
