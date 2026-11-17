import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, migrate } from '../lib/db.js'

const dir = fileURLToPath(new URL('../order-service/migrations', import.meta.url))

test('迁移可重复执行：第二次不会重跑任何文件', () => {
  const db = openDb()
  assert.deepEqual(migrate(db, dir), ['001_init.sql', '002_order_currency.sql'])
  assert.deepEqual(migrate(db, dir), [])
  db.close()
})

test('已执行的迁移被修改时拒绝启动', t => {
  const tmp = mkdtempSync(join(tmpdir(), 'mig-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  cpSync(dir, tmp, { recursive: true })
  const db = openDb()
  migrate(db, tmp)
  writeFileSync(join(tmp, '001_init.sql'), '-- 有人偷偷改了已发布的迁移\n', { flag: 'a' })
  assert.throws(() => migrate(db, tmp), /was modified/)
  db.close()
})

test('失败的迁移整体回滚，不留下半张表', t => {
  const tmp = mkdtempSync(join(tmpdir(), 'mig-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  writeFileSync(join(tmp, '001_bad.sql'), 'CREATE TABLE a (id INTEGER);\nTHIS IS NOT SQL;')
  const db = openDb()
  assert.throws(() => migrate(db, tmp))
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'a'").get().n, 0)
  db.close()
})

test('expand 迁移向后兼容：旧版本代码不带 currency 的 INSERT 仍然有效', () => {
  const db = openDb()
  migrate(db, dir)
  db.prepare("INSERT INTO orders (id, user_id, status, total_cents, created_at, updated_at) VALUES ('o1', 'u1', 'PENDING', 100, 'now', 'now')").run()
  assert.equal(db.prepare("SELECT currency FROM orders WHERE id = 'o1'").get().currency, 'CNY')
  db.close()
})

test('约束是最后一道防线：库存不能为负、状态只能是枚举值', () => {
  const db = openDb()
  migrate(db, dir)
  db.exec("INSERT INTO products VALUES ('p', 'x', 1); INSERT INTO inventory VALUES ('p', 0)")
  assert.throws(() => db.exec("UPDATE inventory SET available = -1 WHERE product_id = 'p'"), /CHECK/)
  assert.throws(() => db.exec("INSERT INTO orders (id, user_id, status, total_cents, created_at, updated_at) VALUES ('o', 'u', 'SHIPPED', 1, 'n', 'n')"), /CHECK/)
  db.close()
})

test('“我的订单”分页查询命中复合索引', () => {
  const db = openDb()
  migrate(db, dir)
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM orders WHERE user_id = ? AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT 10")
    .all('u', 'x', 'y').map(r => r.detail).join('\n')
  assert.match(plan, /idx_orders_user_created/)
  assert.doesNotMatch(plan, /TEMP B-TREE/, '排序应由索引提供，而不是额外排序')
  db.close()
})
