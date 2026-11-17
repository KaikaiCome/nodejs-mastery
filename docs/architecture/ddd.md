# 分层、DDD 与整洁架构

## 为什么需要架构

代码量小时怎么写都行；项目活 3 年、10 个人维护后，**架构决定改需求的成本**。

## 三种常见结构

### 1. 经典三层

Controller → Service → Repository。简单、适合大多数 CRUD 与 BFF。问题：Service 容易膨胀成“上帝类”，业务规则散落。

### 2. 整洁架构 / 六边形架构（端口与适配器）

```
          ┌──────────── 适配器（HTTP/MQ/CLI）────────────┐
          │   ┌──────── 应用层（用例 UseCase）───────┐   │
          │   │   ┌──── 领域层（实体/值对象/规则）─┐  │   │
          │   │   └──────────────────────────────┘  │   │
          │   └──────────────────────────────────────┘   │
          └──────────── 适配器（DB/Redis/HTTP Client）────┘
依赖方向：外层 → 内层；领域层不依赖任何框架与数据库
```

```ts
// domain/order.ts —— 纯业务，无框架
export class Order {
  constructor(public id: string, private status: 'PENDING' | 'PAID' | 'CANCELLED', private items: Item[]) {}
  pay() {
    if (this.status !== 'PENDING') throw new DomainError('只能支付待支付订单')
    this.status = 'PAID'
  }
  get total() { return this.items.reduce((s, i) => s + i.price * i.qty, 0) }
}

// application/pay-order.ts —— 用例编排
export class PayOrder {
  constructor(private orders: OrderRepository, private payment: PaymentGateway) {} // 端口（接口）
  async exec(orderId: string) {
    const order = await this.orders.get(orderId)
    await this.payment.charge(order.id, order.total)
    order.pay()
    await this.orders.save(order)
  }
}

// infra/order.repository.prisma.ts —— 适配器实现端口
```

好处：领域逻辑可单测（无需 DB）；替换框架/数据库不影响业务。

### 3. DDD（领域驱动设计）

**战略设计**（更重要）：
- **限界上下文**：同一个词在不同上下文含义不同（“商品”在商品中心 vs 订单快照）。上下文边界 ≈ 服务/模块边界。
- **通用语言**：代码命名与业务语言一致。
- **上下文映射**：防腐层（ACL）——BFF 本身就是前端与领域之间的一种防腐层。

**战术设计**：实体、值对象、聚合（一致性边界，一个事务只改一个聚合）、领域事件、仓储。

## 如何选择

| 项目 | 推荐 |
| --- | --- |
| BFF、简单 CRUD | 三层 + 模块化目录 |
| 中等复杂业务 | 三层 + 富领域模型（规则放实体） |
| 复杂核心域（交易、计费） | 整洁架构 + DDD 战术 |

## 模块化单体

在一个进程内按领域划分模块，模块之间**只通过公开接口（index.ts）交互**，禁止跨模块直接访问对方的表。用 ESLint 规则（`eslint-plugin-boundaries`）或 dependency-cruiser 强制边界。这为未来拆分微服务做好准备。

## 练习

把 `examples/express-basic` 的用户模块重构为 domain / application / infra 三层，并为领域对象写不依赖 DB 的单测。
