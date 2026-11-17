# 订单状态机

> 代码：`examples/shop/order-service/orders.js` 中的 `TRANSITIONS` 与 `transition()` · 测试：`test/orders.test.js`

```text
          pay            
PENDING ───────► PAID
   │
   │ cancel（释放库存）
   ▼
CANCELLED
```

## 1. 显式状态机

```js
export const TRANSITIONS = { PENDING: ['PAID', 'CANCELLED'], PAID: [], CANCELLED: [] }
```

只有表中列出的迁移是合法的。不要在代码里散落 `if (order.status !== 'PAID' && ...)` ——状态一多，没人能说清楚哪些组合是合法的。

数据库再加一道 `CHECK (status IN (...))`，防止出现拼写错误的状态值。

## 2. 条件更新 = 乐观并发控制

```sql
UPDATE orders SET status = 'CANCELLED', updated_at = ?
WHERE id = ? AND user_id = ? AND status = 'PENDING'
```

- `changes = 1`：迁移成功，**在同一事务中**释放库存、写 outbox 事件。
- `changes = 0`：要么订单不存在（404），要么已经不是 `PENDING`。

用户同时点了“支付”和“取消”，或者网络重试导致同一个取消请求到达三次，最多只有一个能把状态从 `PENDING` 改走。测试“并发取消也只能释放一次库存”用 3 个并发取消请求验证库存只恢复一次。

::: tip 为什么不先查状态再更新？
和[超卖](./ordering)完全同构：“检查”和“修改”之间的间隙会被并发钻空子。条件更新把两者合并成一个原子操作。
:::

## 3. 重复请求的语义：幂等成功，而不是报错

| 当前状态 | 请求 | 结果 | 理由 |
| --- | --- | --- | --- |
| PENDING | pay | 200，状态 PAID | 正常迁移 |
| PAID | pay | **200**，状态 PAID | 重复请求（重试、双击）。目标状态已达成，报错会让客户端误以为失败 |
| CANCELLED | pay | 409 `INVALID_STATE` | 真正的冲突，客户端需要提示用户 |
| PAID | cancel | 409 `INVALID_STATE` | 已支付订单的取消是“退款”，是另一个业务流程 |
| 不存在/别人的 | 任意 | 404 | 不泄漏存在性 |

因为状态迁移天然幂等，BFF 可以安全地对它们**自动重试一次**（见 `bff/server.js` 的 `transition()`）。这就是“幂等”在架构上的价值：它把“能不能重试”从需要讨论的问题变成了确定的答案。

## 4. 副作用与状态变化原子绑定

取消订单时有三件事：改状态、还库存、发事件。它们在同一个事务中：

```js
tx(db, () => {
  const changed = ... // 条件更新
  if (to === 'CANCELLED') for (const item of items) q.release.run(item.qty, item.product_id)
  emit(`order.${to.toLowerCase()}`, { orderId, userId }, at)
})
```

库存释放写在“条件更新成功之后”，所以重复取消不会重复释放。事件写进 outbox 表而不是直接调用通知服务——原因见下一章 [Outbox](./outbox)。

## 破坏实验

1. 把取消的条件更新改为 `WHERE id = ? AND user_id = ?`（去掉 `status` 条件），运行测试。哪些断言失败？库存变成了多少？
2. 让“已支付再支付”返回 409。然后思考：BFF 的自动重试会出现什么用户可见的问题？（提示：第一次请求成功但响应丢失。）

## 练习

1. **超时自动取消**：`PENDING` 超过 15 分钟自动取消并释放库存。要求：
   - 与用户支付并发时不会出现“既支付又取消”；
   - 多个实例同时运行扫描任务也不会重复释放库存；
   - 为“支付与超时取消竞争”写测试。
2. **退款 saga**：`PAID → REFUNDING → REFUNDED`，退款需要调用（模拟的）支付服务，可能失败或超时。设计状态、补偿动作和重试策略，画出状态图，再实现。
3. 把状态机做成可复用的工具：给定 `TRANSITIONS` 与钩子，自动生成条件更新和事件，并用表驱动测试覆盖所有“状态 × 动作”组合。
