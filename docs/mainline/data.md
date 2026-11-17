# 数据建模与迁移

> 代码：`examples/shop/order-service/migrations/`、`examples/shop/lib/db.js` · 测试：`test/migrations.test.js`

前端工程师最容易低估的一件事：**数据比代码活得久**。代码写错了可以回滚，数据写错了只能修复，而且往往无法完整修复。

## 1. 让数据库替你守住不变量

```sql
CREATE TABLE inventory (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  available  INTEGER NOT NULL CHECK (available >= 0)
);

CREATE TABLE orders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  ...
);
```

几条原则：

- **金额用整数分**（`price_cents`），永远不要用浮点数。`0.1 + 0.2 !== 0.3` 在账务里是事故。展示层（BFF）再格式化成 `¥399.00`。
- **约束是最后一道防线**。应用代码会有 bug，会有人直接连库改数据，会有新同事写了绕过校验的脚本。`CHECK (available >= 0)` 保证无论如何库存都不会变成负数。
- **订单行保存价格快照**（`order_items.unit_price_cents`）。商品改价后，历史订单金额不能跟着变。
- **外键与 `NOT NULL` 默认都要有**，除非你能说出不要的理由。SQLite 的外键需要 `PRAGMA foreign_keys = ON`（见 `openDb`），这是一个经典的“以为有、其实没有”的坑。

```bash
node --test --test-name-pattern="约束" "examples/shop/test/*.test.js"
```

## 2. 索引为查询而建

“我的订单”页面的查询：

```sql
SELECT ... FROM orders
WHERE user_id = ? AND (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 11  -- 多取一条，用来判断是否还有下一页
```

复合索引 `(user_id, created_at DESC, id DESC)` 同时满足**过滤**和**排序**。测试用 `EXPLAIN QUERY PLAN` 断言命中索引、且没有额外排序：

```js
const plan = db.prepare('EXPLAIN QUERY PLAN SELECT ...').all(...).map(r => r.detail).join('\n')
assert.match(plan, /idx_orders_user_created/)
assert.doesNotMatch(plan, /TEMP B-TREE/)
```

::: tip 把“性能假设”写成测试
索引被误删、查询被改写导致索引失效，往往要等线上数据量上来才暴露。用 `EXPLAIN` 写断言，CI 就能提前发现。PostgreSQL 中对应 `EXPLAIN (FORMAT JSON)`。
:::

### 为什么是游标分页而不是 OFFSET

| | `LIMIT 10 OFFSET 10000` | 游标 `(created_at, id) < (?, ?)` |
| --- | --- | --- |
| 深分页性能 | 扫描并丢弃 10000 行 | 索引直接定位 |
| 翻页期间有新订单插入 | 出现重复或遗漏 | 稳定 |
| 能否跳到第 N 页 | 能 | 不能（信息流、订单列表通常不需要） |

游标里带上 `id` 作为**并列条件**：同一毫秒创建的两笔订单 `created_at` 相同，只按时间会漏数据。游标对客户端是不透明的 base64url 字符串，解码失败返回 `400 INVALID_CURSOR` 而不是 500——**任何来自客户端的输入都可能是垃圾**。

### N+1 查询

列表页每笔订单都有订单项。逐条查询是 N+1 次往返；`listOrders` 用一次 `WHERE order_id IN (...)` 取回整页的订单项，再在内存中分组。这与 [DataLoader](../bff/aggregation) 解决的是同一个问题，只是发生在数据库层。

## 3. 版本化迁移

`lib/db.js` 中的 `migrate()` 只有 30 行，却包含了生产迁移工具（Flyway、Prisma Migrate、Knex）的核心规则：

1. 迁移文件按 `001_xxx.sql`、`002_xxx.sql` 顺序执行，每个文件一个事务。
2. 执行记录写入 `schema_migrations`，包含**校验和**。
3. **已执行的迁移被修改 → 拒绝启动**。已发布的迁移是历史，修正只能追加新文件。
4. 迁移失败整体回滚，不留下半张表。SQLite 与 PostgreSQL 支持事务性 DDL；**MySQL 不支持**，DDL 会隐式提交——这是选库时要考虑的点。

```bash
node --test --test-name-pattern="迁移" "examples/shop/test/*.test.js"
```

::: details 为什么计算校验和前要把 CRLF 换成 LF？
Windows 上 Git 可能把换行转换成 CRLF。如果不规范化，同一个迁移文件在 Windows 开发机和 Linux 服务器上的校验和不同，会被误判为“被篡改”。
:::

## 4. 零停机变更：expand / contract

滚动发布期间，**新旧两个版本的代码同时运行并访问同一个数据库**。所以任何 schema 变更都必须同时兼容两个版本。

`002_order_currency.sql` 是 expand 阶段：

```sql
ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'CNY';
```

带默认值的新列，旧代码的 `INSERT`（不带 `currency`）依然成功——测试“expand 迁移向后兼容”证明了这一点。

一次“重命名列”的完整流程：

| 步骤 | 迁移 | 代码 |
| --- | --- | --- |
| 1. expand | 新增 `amount_cents`，允许为空 | 双写 `total_cents` 与 `amount_cents` |
| 2. backfill | 分批回填历史数据（避免长事务锁表） | 同上 |
| 3. 切读 | — | 读 `amount_cents` |
| 4. contract | 删除 `total_cents` | 只写新列（此时所有旧版本已下线） |

每一步都可以独立发布和回滚。**把“改个列名”拆成四次发布**，是资深与初级的显著区别。

## 破坏实验

1. 删掉 `001_init.sql` 中的 `CHECK (available >= 0)`，删除内存库无关紧要（测试每次新建），运行 `npm run test:shop`。哪个测试失败？为什么并发下单的测试**仍然**通过？（提示：是哪一层在防止超卖？两层防线各自防的是什么？）
2. 先 `npm run shop` 生成 `.data`，停止后给 `001_init.sql` 末尾加一个注释，再启动。观察启动报错，并思考：为什么“拒绝启动”比“静默继续”好？
3. 删掉索引 `idx_orders_user_created`，看 `EXPLAIN` 测试的失败信息。

## 练习

1. 新增迁移 `003_order_note.sql`：给订单增加可选备注（≤ 200 字），用数据库约束限制长度；为它写测试。
2. 设计 `total_cents` → `amount_cents` 重命名的完整迁移序列（每一步的 SQL + 代码变更说明），并写一个测试模拟“旧版本代码 + 新 schema”同时运行。
3. 订单列表支持按状态筛选：设计新的索引，并用 `EXPLAIN` 测试证明它被使用。

## PostgreSQL 对照

| 本项目（SQLite） | PostgreSQL |
| --- | --- |
| `TEXT` 时间（ISO 字符串，字典序即时间序） | `timestamptz` |
| `INTEGER` 金额 | `bigint`（分）或 `numeric` |
| `ADD COLUMN ... DEFAULT` | PG 11+ 常量默认值不重写表，可安全执行 |
| 建索引会锁表（数据量小无感） | 生产用 `CREATE INDEX CONCURRENTLY`（不能放在事务里，迁移工具需特殊处理） |
| 迁移：单进程启动时执行 | 多实例同时启动时用 advisory lock，或在发布流水线中单独执行迁移 |
