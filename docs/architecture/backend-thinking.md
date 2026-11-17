# 后端开发思维

后端能力 = 技术 × 思维。本章给出可以反复练习的思维模型。

## 1. 从“功能正确”到“系统正确”

| 维度 | 关键问题 | 工具 |
| --- | --- | --- |
| 正确性 | 并发、重试、部分失败下数据还对吗？ | 事务、幂等、锁、状态机 |
| 可用性 | 依赖挂了我还能服务吗？ | 超时、熔断、降级、冗余 |
| 性能 | 延迟分布、吞吐、资源上限是多少？ | 压测、Profiling、缓存 |
| 可扩展 | 流量 ×10 时瓶颈在哪？ | 无状态、水平扩展、分片 |
| 可观测 | 出问题多久能发现、多久能定位？ | 日志、指标、追踪、告警 |
| 可演进 | 需求变化时改动范围多大？ | 分层、模块边界、契约 |
| 安全 | 恶意输入会怎样？ | 校验、鉴权、最小权限 |

## 2. 用数字思考（估算能力）

需要记住的数量级：

| 操作 | 耗时 |
| --- | --- |
| 内存访问 | ~100 ns |
| Redis（同机房） | ~0.5 ms |
| 内网 RPC | 1~5 ms |
| MySQL 索引查询 | 1~10 ms |
| 跨地域网络 | 30~150 ms |

**练习估算**：日活 100 万，每人每天访问首页 10 次 → 1000 万次/天 ≈ 116 QPS 均值，峰值按 5~10 倍 ≈ 1000 QPS。单个 Node 实例（聚合 4 个下游，P99 100ms）约能扛 500~1500 QPS → 需要 2~4 个实例 + 冗余 → 部署 4~6 个。

## 3. 一切都会失败（Design for Failure）

- 网络会超时、会重复、会乱序。
- 进程会被杀、机器会宕。
- 下游会变慢（比挂掉更危险）。

对应原则：**超时 + 幂等 + 可重试 + 降级 + 可恢复**。

### 幂等设计

```ts
// 客户端为“一次下单意图”生成 Idempotency-Key；结果未知时用同一个键重试
app.post('/orders', async (req, res) => {
  const key = req.get('Idempotency-Key')
  if (!key || !/^[\w-]{16,64}$/.test(key)) return res.status(400).json({ code: 'IDEMPOTENCY_KEY_REQUIRED' })
  const redisKey = `idem:${req.user.id}:${key}`            // 按用户隔离，避免不同用户的键互相命中
  const fingerprint = sha256(stableStringify(req.body))      // 同一个键只能用于同一份请求内容

  // PROCESSING 的 TTL 只需略长于请求超时：进程崩溃后锁能自动释放，而不是锁住一整天
  const ok = await redis.set(redisKey, JSON.stringify({ state: 'PROCESSING', fingerprint }), 'NX', 'EX', 60)
  if (!ok) {
    const prev = JSON.parse((await redis.get(redisKey))!)
    if (prev.fingerprint !== fingerprint) return res.status(422).json({ code: 'IDEMPOTENCY_KEY_REUSED' })
    if (prev.state === 'PROCESSING') return res.status(409).json({ code: 'IN_PROGRESS' })
    return res.status(prev.status).json(prev.body)
  }
  try {
    const result = await orderService.create(req.user.id, req.body)
    await redis.set(redisKey, JSON.stringify({ state: 'DONE', fingerprint, status: 201, body: result }), 'EX', 86400)
    res.status(201).json(result)
  } catch (e) {
    await redis.del(redisKey) // 只缓存成功结果：失败后允许用同一个键重试
    throw e
  }
})
```

::: warning 这个版本仍有缺口
如果 `orderService.create` 已提交、但写回 `DONE` 之前进程崩溃，60 秒后锁过期，重试会**再创建一笔订单**。Redis 与数据库之间没有原子性。

最稳妥的做法是把幂等记录与订单写在**同一个数据库事务**里（唯一约束 `(user_id, key)`），这正是主线项目的实现：[下单：事务、并发与幂等](/mainline/ordering)。
:::

数据库层兜底：唯一索引（如 `order_no`）。

### 状态机

订单、审批、支付等用显式状态机，状态迁移用条件更新保证并发安全：

```sql
UPDATE orders SET status='PAID' WHERE id=? AND status='PENDING'; -- affectedRows=0 说明已被处理
```

## 4. 权衡（Trade-off）思维

没有银弹，每个决策写下“得到什么、失去什么”：

- 缓存：得到性能，失去一致性 → 能接受多久的不一致？
- 微服务：得到独立部署，失去简单性 → 团队规模是否需要？
- 强一致：得到正确，失去可用性/性能 → 业务能否接受最终一致？

### ADR（架构决策记录）模板

```md
# ADR-007: BFF 会话存储使用 Redis
## 背景  需要多实例共享会话，并支持强制下线。
## 决策  使用 Redis 存储会话，sid 放 HttpOnly Cookie。
## 备选  JWT 前端持有（难吊销，XSS 风险）；数据库会话（性能差）。
## 后果  引入 Redis 依赖，需要高可用部署；Redis 故障时所有用户需重新登录 → 降级方案：……
```

## 5. 演进式架构

先单体（模块化单体），边界清晰后再拆。**过早拆分微服务是最常见的架构错误**。

## 6. 运维意识（You build it, you run it）

- 上线前：监控、告警、回滚方案、灰度计划、容量评估。
- 上线后：看指标、看错误日志、看业务数据。
- 事故后：写复盘（时间线、根因、改进项），对事不对人。

## 练习

为“秒杀下单”写一份一页的设计：QPS 估算、防超卖方案、幂等、限流、降级、监控指标。
