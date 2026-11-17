# 高并发与一致性

## 提升吞吐的手段（由易到难）

1. **减少工作**：缓存、批量、只取需要的字段、分页。
2. **并行**：Promise.all 聚合、连接池。
3. **异步化**：非实时任务进消息队列（发邮件、生成报表、同步 ES）。
4. **水平扩展**：无状态 + 多实例 + 负载均衡。
5. **数据层扩展**：读写分离、分库分表、冷热分离。

## 消息队列

```ts
// BullMQ（基于 Redis）
import { Queue, Worker } from 'bullmq'
const q = new Queue('email', { connection })
await q.add('welcome', { userId }, { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000 })

new Worker('email', async job => { await mailer.sendWelcome(job.data.userId) }, { connection, concurrency: 10 })
```

- 选型：BullMQ（轻量）/ RabbitMQ（路由灵活）/ Kafka（高吞吐、日志型、事件流）/ RocketMQ（事务消息）。
- 消费者必须**幂等**（至少一次投递）。
- 死信队列 + 告警，处理最终失败的消息。

## 分布式一致性

| 方案 | 说明 | 适用 |
| --- | --- | --- |
| 本地事务 | 单库 | 首选，尽量把需要一致的数据放同一个库 |
| **本地消息表 / Outbox** | 业务数据与“待发消息”同一事务写入，后台投递 | 跨服务最终一致，最常用 |
| Saga | 多步骤，每步有补偿操作 | 长流程（下单→扣库存→支付） |
| TCC | Try-Confirm-Cancel | 资金等强要求场景 |
| 2PC/XA | 强一致 | 性能差，少用 |

### Outbox 示例

```ts
await prisma.$transaction([
  prisma.order.create({ data: order }),
  prisma.outbox.create({ data: { topic: 'order.created', payload: JSON.stringify(order) } })
])
// 后台任务：轮询 outbox 未发送记录 → 发送到 MQ → 标记已发送（消费者需幂等）
```

## 分布式锁

```ts
const token = crypto.randomUUID()
const ok = await redis.set(`lock:${key}`, token, 'PX', 30000, 'NX')
if (!ok) throw new AppError('BUSY', '请稍后重试', 429)
try { await doWork() }
finally {
  // Lua 保证只删除自己的锁
  await redis.eval(`if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`, 1, `lock:${key}`, token)
}
```

注意：锁超时 < 业务耗时会导致锁失效 → 需要续期（watchdog）或用数据库约束兜底。**能用数据库唯一约束/条件更新解决的，不用分布式锁。**

## 防超卖（库存扣减）

```sql
UPDATE stock SET count = count - 1 WHERE sku_id = ? AND count >= 1;
```

高并发：Redis 预扣（Lua 原子脚本）→ MQ 异步落库 → 对账。

## 限流算法

| 算法 | 特点 |
| --- | --- |
| 固定窗口 | 简单，边界突刺 |
| 滑动窗口 | 平滑（ZSet 实现） |
| 令牌桶 | 允许突发，最常用 |
| 漏桶 | 匀速输出 |

## CAP 与 BASE

分布式系统在网络分区（P）时只能在一致性（C）与可用性（A）间取舍。互联网业务多选 AP + 最终一致（BASE），资金类核心选 CP。
