# 下单：事务、并发与幂等

> 代码：`examples/shop/order-service/orders.js` 中的 `createOrder` · 测试：`test/orders.test.js`、`test/reliability.test.js` · 实验：`experiments/oversell.js`

下单是整个系统里最容易出事故的接口：它同时涉及**并发**（多人抢同一件商品）、**原子性**（多件商品要么全扣要么全不扣）、**重试**（网络不可靠）。

## 1. 先亲眼看到超卖

```bash
node examples/shop/experiments/oversell.js
# naive 库存 1，成交 20，剩余 0 → 超卖 19 件！
# safe  库存 1，成交 1，剩余 0 → 正确
```

错误写法几乎是每个人的第一反应：

```js
const { available } = db.prepare('SELECT available FROM inventory WHERE product_id = ?').get(id)
if (available < 1) return false
await somethingAsync()          // 查价格、调风控、写日志……
db.prepare('UPDATE inventory SET available = ? WHERE product_id = ?').run(available - 1, id)
```

20 个请求都在 `await` 之前读到了 `available = 1`，都“检查通过”，都写回 `0`。**“检查”和“修改”之间只要有间隙，并发就会钻进来**——在 Node 里，这个间隙就是任何一个 `await`。

正确写法把检查和修改合并成**一条原子语句**：

```sql
UPDATE inventory SET available = available - ? WHERE product_id = ? AND available >= ?
-- changes === 1 → 扣减成功；changes === 0 → 库存不足
```

这叫**条件更新**（compare-and-set）。它不需要锁、不需要 Redis，数据库本身保证原子性。

## 2. 多件商品：事务保证“全有或全无”

```js
return tx(db, () => {
  for (const item of items) {           // items 已按 productId 排序
    if (q.reserve.run(item.qty, item.productId, item.qty).changes !== 1) {
      throw new DomainError('OUT_OF_STOCK', ...)   // 抛错 → ROLLBACK，前面扣过的库存全部恢复
    }
    ...
  }
  q.insertOrder.run(...)
  q.insertItem.run(...)
  q.insertIdem.run(...)          // 幂等记录
  emit('order.created', ...)     // outbox 事件
})
```

测试“多商品订单任一商品缺货时整单回滚”验证：p1 有货、p4 没货时，p1 的库存不会被扣。

::: warning 为什么按 productId 排序？
在 PostgreSQL/MySQL 中，`UPDATE` 会对行加锁直到事务结束。订单 A 先锁键盘再锁耳机，订单 B 先锁耳机再锁键盘 → 互相等待 → **死锁**。所有事务按同一顺序加锁，就不会形成环。SQLite 是整库写锁，不会出现这个问题，但代码应该按生产数据库的规则写。
:::

### SQLite 与 PostgreSQL 的关键差异

`node:sqlite` 是**同步** API，`tx()` 里不能 `await`。这带来一个强保证：在单进程内，事务执行期间不会有其他请求插进来。

换成 PostgreSQL（`pg` 驱动是异步的），事务会跨越多个 `await`，**其他请求的查询会在中间穿插执行**。此时：

- 条件更新依然正确（数据库层原子）。
- “先 `SELECT` 再根据结果 `UPDATE`” 必须改为 `SELECT ... FOR UPDATE` 加行锁，或者改写成条件更新。
- 默认隔离级别（Read Committed）下，两个事务可能都读到“不存在”然后都插入——要靠**唯一约束**兜底，并处理冲突错误（`23505 unique_violation`）。

## 3. 幂等：让重试变得安全

用户点击“提交订单”，请求发出后网络断了。订单到底创建了没有？**客户端不知道**。

- 不重试 → 可能丢单。
- 直接重试 → 可能重复下单。

解决办法：客户端为**一次下单意图**生成 `Idempotency-Key`，重试时使用同一个键。服务端：

```js
const previous = q.idem.get(userId, idempotencyKey)
if (previous) {
  if (previous.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_REUSED')  // → 422
  return { order: load(userId, previous.order_id), replayed: true }                           // → 200
}
// ... 创建订单，并在同一个事务中写入 idempotency_keys
```

关键设计点：

| 设计 | 原因 |
| --- | --- |
| 幂等记录与订单**同一个事务**写入 | 不存在“订单建了、幂等记录没写”的中间状态。对比[用 Redis 实现的版本](../architecture/backend-thinking#幂等设计)：Redis 与数据库之间没有原子性 |
| 主键 `(user_id, key)` | 不同用户的键互不影响，也无法用别人的键探测别人的订单 |
| 保存请求指纹 `request_hash` | 同一个键配不同的购物车是客户端 bug，必须暴露出来（422），不能返回一个不相关的旧订单 |
| 只记录**成功**的结果 | 库存不足（409）时事务回滚，幂等记录也不存在；用户补货后用同一个键重试可以成功。代价：失败结果不可“重放” |
| 重放时返回订单**当前**状态 | 而不是首次响应的快照。比如订单已支付，重放会看到 `PAID`。Stripe 等支付平台选择重放快照，各有取舍，需要在 API 文档中写明 |

### 最危险的时刻：已提交，但响应丢了

```bash
node --test --test-name-pattern="响应丢失" "examples/shop/test/*.test.js"
```

测试通过故障注入，让订单服务在**事务提交之后**直接断开连接。BFF 看到网络错误，用同一个幂等键重试一次，命中幂等记录，返回 `200 + idempotent-replayed: true`，数据库里只有一笔订单。

这个测试证明的不是“代码能跑”，而是**系统在最坏时刻的行为是正确的**。

## 4. 越权（IDOR）

每一条订单查询都带 `user_id`：

```sql
SELECT ... FROM orders WHERE id = ? AND user_id = ?
UPDATE orders SET status = ? ... WHERE id = ? AND user_id = ? AND status = ?
```

访问别人的订单返回 **404 而不是 403**：403 等于告诉攻击者“这个订单存在”。

`user_id` 从哪来？订单服务只信任持有 service token 的调用方（BFF）传来的 `x-user-id`，而 BFF 从服务端会话中取得用户身份——**用户身份永远不来自客户端提交的参数**。

## 破坏实验

1. 把 `reserve` 改成先 `SELECT` 再 `UPDATE ... SET available = ?`。并发测试还会失败吗？（同步 SQLite 下不会！想清楚为什么，然后在两步之间加一个 `await`——注意 `tx()` 不允许这么做，你需要把逻辑移出事务。）这就是为什么同步 API 的“正确”不能直接搬到异步驱动上。
2. 在 `createOrder` 中把 `q.insertIdem.run(...)` 移到事务之外（事务提交后执行），然后运行“响应丢失”测试。它还能通过吗？构造一个能让它失败的场景。
3. 删掉幂等键主键中的 `user_id`，看哪个测试失败。

## 练习

1. 幂等记录永久保存会无限增长。增加过期清理（例如 24 小时），并说明清理后同一个键重试会发生什么、是否可接受。
2. 当前幂等检查在“相同请求、首个请求仍在执行”时依赖 SQLite 的写锁串行化。用 PostgreSQL 的思路重写：先 `INSERT ... ON CONFLICT DO NOTHING` 占位，冲突时根据状态返回 `409 IN_PROGRESS` 或重放结果。写出伪代码并分析所有分支。
3. 增加“每人限购 2 件 p4”规则。要求并发安全，并写并发测试（提示：限购计数也需要条件更新或唯一约束）。
