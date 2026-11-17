# Outbox：可靠地通知其他服务

> 代码：`examples/shop/order-service/outbox-relay.js`、`examples/shop/notification-service/server.js` · 测试：`test/reliability.test.js`

下单成功后要给用户发通知。最直观的写法：

```js
const order = createOrder(...)          // 1. 写数据库
await notificationService.send(order)   // 2. 调用通知服务
```

这里有**双写问题**：

| 情况 | 结果 |
| --- | --- |
| 1 成功，2 失败（通知服务挂了） | 订单存在，通知永远不会发 |
| 1 成功，进程在 2 之前崩溃 | 同上 |
| 先 2 后 1，1 失败 | 用户收到了一个不存在订单的通知 |
| 把 2 放进事务里 | 事务持有锁等待网络调用；通知服务慢 → 数据库连接池耗尽 → 整个下单接口挂掉 |

数据库和通知服务之间**不存在**一个能同时提交两边的原子操作（分布式事务/2PC 理论上可以，但实际几乎不用）。

## 1. Outbox 模式

把“要发送的事件”当作业务数据的一部分，**写进同一个数据库、同一个事务**：

```js
tx(db, () => {
  q.insertOrder.run(...)
  q.outbox.run(randomUUID(), 'order.created', JSON.stringify(payload), at, at)
})
```

然后由后台任务（relay）读取未发布的事件并投递：

```js
const rows = due.all(now, batchSize)        // published_at IS NULL AND next_attempt_at <= now
for (const row of rows) {
  try {
    await publish(message)
    markPublished.run(...)
  } catch (err) {
    markFailed.run(nextAttemptAt, err.message, row.id)   // 指数退避
  }
}
```

现在：订单与事件**要么都存在，要么都不存在**；通知服务挂掉只会让事件延迟，不会丢失，也不会拖慢下单。

## 2. 至少一次 ⇒ 消费者必须去重

relay 在 `publish` 成功之后、`markPublished` 之前崩溃怎么办？重启后这条消息会被**再投递一次**。这无法避免——你只能在“可能丢失”（至多一次）和“可能重复”（至少一次）之间选择，业务事件几乎总是选后者。

所以消费者用 **Inbox** 去重：

```js
tx(db, () => {
  if (q.inbox.run(messageId, topic, at).changes === 0) return 'duplicate'   // ON CONFLICT DO NOTHING
  q.insert.run(...)                                                         // 真正的业务处理
})
```

`message_id` 去重与业务处理在**同一个事务**中，所以不存在“记了已处理但没处理”或反过来的情况。

```bash
node --test --test-name-pattern="至少一次" "examples/shop/test/*.test.js"
```

这个测试用 `hooks.afterPublish` 抛错模拟“已送达但未标记”，验证重投后通知只有一条。

::: tip “恰好一次”其实是“至少一次 + 幂等处理”
任何声称端到端“exactly once”的系统，本质都是这两者的组合。面试中能说清这一点，比背诵 Kafka 配置更有说服力。
:::

## 3. 其他必须想清楚的问题

**未知事件也要确认。** 通知服务收到不认识的 `topic` 时返回成功（`ignored`）。如果返回错误，relay 会永远重试这条消息，占用重试预算。真实系统中这类消息应进入**死信队列**并告警。

**顺序不保证。** 消息 A 失败进入退避，消息 B 先成功了。如果消费者依赖顺序（比如先 `created` 后 `paid`），需要：按聚合 ID 分区串行投递，或者消费者容忍乱序（例如用版本号丢弃旧事件）。

**relay 不能重叠执行。** 用“完成后再调度下一轮”的 `setTimeout` 链，而不是 `setInterval`——后者在一轮耗时超过间隔时会并发执行。`stop()` 要等待当前一轮结束，否则优雅关闭时会在投递中途关闭数据库。

**多实例部署。** 两个实例的 relay 会同时读到同一批消息。PostgreSQL 中：

```sql
SELECT ... FROM outbox
WHERE published_at IS NULL AND next_attempt_at <= now()
ORDER BY id LIMIT 20
FOR UPDATE SKIP LOCKED
```

`SKIP LOCKED` 让每个实例拿到不同的行。注意锁只在事务内有效，要么在事务内完成投递（持锁时间长），要么用“租约”字段（`locked_until`）。

**清理。** 已发布的消息要定期归档或删除，否则 outbox 表无限增长。

## 4. 用 CDC 替代轮询

轮询有延迟（本项目 200ms）且持续消耗数据库资源。生产中常用 **CDC（Change Data Capture）**：Debezium 读取数据库的 WAL/binlog，把 outbox 表的插入转成 Kafka 消息。原理相同，只是 relay 换成了基础设施。

## 破坏实验

1. 在 `createOrder` 中把 `emit(...)` 移到 `tx()` 之后执行，并在两者之间 `throw new Error('crash')`。订单存在吗？事件存在吗？
2. 去掉通知服务的 `ON CONFLICT DO NOTHING`（改成普通 `INSERT`），运行“至少一次”测试，观察 relay 如何对待一个**永远**处理失败的消息，`attempts` 和 `next_attempt_at` 如何变化。
3. 把 relay 的 `schedule` 改成 `setInterval`，并让 `publish` 耗时超过间隔，运行“不会重叠执行”测试。

## 练习

1. 增加最大重试次数：超过 10 次的消息标记为 `dead`，暴露为 `/metrics` 中的 `outbox_dead_total`，并写测试。
2. 实现“按 `orderId` 保序”：同一订单的事件必须按顺序投递，一条失败时阻塞后续同订单事件，但不阻塞其他订单。
3. 写一个 `/metrics` 指标 `outbox_lag_seconds`：最老的未发布消息已等待多久。说明它为什么比“未发布消息数量”更适合作为告警指标。
