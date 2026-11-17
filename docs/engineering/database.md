# 数据库与缓存

## 关系型数据库（MySQL / PostgreSQL）

### 必会知识

- **索引**：B+ 树、最左前缀、覆盖索引；用 `EXPLAIN` 看执行计划。
- **事务与隔离级别**：读未提交 / 读已提交 / 可重复读（MySQL 默认）/ 串行化。
- **锁**：行锁、`SELECT ... FOR UPDATE`、乐观锁（`version` 字段）。
- **分页**：深分页 `LIMIT 100000, 20` 慢 → 用游标分页 `WHERE id > ? LIMIT 20`。

### 连接池

```ts
import mysql from 'mysql2/promise'
export const pool = mysql.createPool({
  uri: config.DATABASE_URL,
  connectionLimit: 10,      // 实例数 × 10 不能超过 DB max_connections
  waitForConnections: true,
  queueLimit: 100
})
```

::: warning 连接数计算
20 个 Pod × 每个池 20 连接 = 400 连接，可能直接打满数据库。扩容 Pod 前先算连接数。
:::

### ORM 选择

| 工具 | 特点 |
| --- | --- |
| Prisma | Schema 优先、类型安全、迁移好用；复杂 SQL 用 `$queryRaw` |
| Drizzle | 轻量、SQL-like、类型安全 |
| TypeORM | 装饰器、NestJS 常用；需注意 N+1 与懒加载 |
| Knex | Query Builder，灵活 |

### 事务示例（Prisma）

```ts
await prisma.$transaction(async (tx) => {
  const acc = await tx.account.update({ where: { id: from }, data: { balance: { decrement: amount } } })
  if (acc.balance < 0) throw Errors.Conflict('余额不足') // 抛出即回滚
  await tx.account.update({ where: { id: to }, data: { balance: { increment: amount } } })
})
```

### N+1 问题

```ts
// ❌ 1 次查订单 + N 次查用户
for (const o of orders) o.user = await db.user.findUnique({ where: { id: o.userId } })
// ✅ 批量
const users = await db.user.findMany({ where: { id: { in: orders.map(o => o.userId) } } })
```

### 迁移

迁移脚本纳入版本控制，在 CI/CD 中执行；**向后兼容变更**（先加字段 → 发版 → 再删旧字段），保证滚动发布期间新旧版本共存。

## Redis

### 常用场景

| 场景 | 数据结构 |
| --- | --- |
| 缓存 | String（JSON）/ Hash |
| 会话 | String + TTL |
| 计数/限流 | `INCR` + `EXPIRE`、滑动窗口用 ZSet |
| 排行榜 | ZSet |
| 分布式锁 | `SET key val NX PX 30000` + Lua 校验释放 |
| 简单队列 | List / Stream（推荐 BullMQ） |

### Cache-Aside 模式

```ts
async function getUser(id: string) {
  const key = `user:${id}`
  const cached = await redis.get(key)
  if (cached) return JSON.parse(cached)
  const user = await repo.findById(id)
  // 空值也缓存（短 TTL）防穿透；TTL 加随机值防雪崩
  await redis.set(key, JSON.stringify(user ?? null), 'EX', user ? 300 + Math.floor(Math.random() * 60) : 30)
  return user
}
// 更新：先更新 DB，再删除缓存
```

### 三大缓存问题

| 问题 | 描述 | 方案 |
| --- | --- | --- |
| 穿透 | 查不存在的数据，请求全打 DB | 缓存空值、布隆过滤器、参数校验 |
| 击穿 | 热点 key 过期瞬间大量请求打 DB | 互斥锁 / **请求合并（singleflight）**、逻辑过期 |
| 雪崩 | 大量 key 同时过期 / Redis 宕机 | TTL 随机、多级缓存、熔断降级 |

### singleflight（进程内请求合并）

```ts
const inflight = new Map<string, Promise<unknown>>()
export function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
```

## MongoDB

适合文档型、结构多变的数据（配置、日志、CMS）。注意：建索引、避免无界数组、事务需副本集。

## 练习

实现 `getProduct(id)`：Redis cache-aside + singleflight + 空值缓存，并写测试验证 100 个并发请求只查 1 次 DB。
