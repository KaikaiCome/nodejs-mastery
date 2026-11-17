// 实验：同样的“检查库存再扣减”，两种写法在并发下的差异。
// node examples/shop/experiments/oversell.js
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as yieldToLoop } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { openDb } from '../lib/db.js'

function setup(file, stock) {
  const db = openDb(file)
  db.exec('CREATE TABLE inventory (product_id TEXT PRIMARY KEY, available INTEGER NOT NULL)')
  db.prepare('INSERT INTO inventory VALUES (?, ?)').run('p4', stock)
  db.close()
}

// 错误写法：读 → await（模拟查价格、调用风控等异步步骤）→ 用旧值写回。
// 所有请求都在 await 之前读到了同一个库存，于是都“检查通过”。
async function naiveBuy(db) {
  const { available } = db.prepare('SELECT available FROM inventory WHERE product_id = ?').get('p4')
  if (available < 1) return false
  await yieldToLoop()
  db.prepare('UPDATE inventory SET available = ? WHERE product_id = ?').run(available - 1, 'p4')
  return true
}

// 正确写法：把“检查”和“扣减”合并成一条条件更新，由数据库保证原子性
async function safeBuy(db) {
  await yieldToLoop()
  return db.prepare('UPDATE inventory SET available = available - 1 WHERE product_id = ? AND available >= 1').run('p4').changes === 1
}

export async function runOversell({ buyers = 20, stock = 1, strategy }) {
  const dir = mkdtempSync(join(tmpdir(), 'oversell-'))
  const file = join(dir, 'shop.db')
  setup(file, stock)
  // 每个“请求”一条独立连接，更接近多个服务实例共享同一个数据库
  const conns = Array.from({ length: buyers }, () => openDb(file))
  try {
    const buy = strategy === 'naive' ? naiveBuy : safeBuy
    const results = await Promise.all(conns.map(db => buy(db)))
    const sold = results.filter(Boolean).length
    const { available } = conns[0].prepare('SELECT available FROM inventory WHERE product_id = ?').get('p4')
    return { strategy, stock, sold, available }
  } finally {
    for (const db of conns) db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const strategy of ['naive', 'safe']) {
    const r = await runOversell({ strategy })
    const verdict = r.sold > r.stock ? `超卖 ${r.sold - r.stock} 件！` : '正确'
    console.log(`${strategy.padEnd(5)} 库存 ${r.stock}，成交 ${r.sold}，剩余 ${r.available} → ${verdict}`)
  }
}
