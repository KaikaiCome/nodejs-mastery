import { randomUUID, createHash } from 'node:crypto'
import { tx } from '../lib/db.js'

// 领域错误只描述“业务上发生了什么”，HTTP 状态码由适配层（server.js）决定
export class DomainError extends Error {
  constructor(code, message, details) {
    super(message)
    this.code = code
    this.details = details
  }
}

export const LIMITS = { maxLines: 10, maxQty: 5, maxPageSize: 50 }

// 显式状态机：只有这里列出的迁移是合法的
export const TRANSITIONS = { PENDING: ['PAID', 'CANCELLED'], PAID: [], CANCELLED: [] }

const SEED = [
  { id: 'p1', name: '机械键盘', priceCents: 39900, stock: 20 },
  { id: 'p2', name: '降噪耳机', priceCents: 129900, stock: 5 },
  { id: 'p3', name: 'USB-C 数据线', priceCents: 4900, stock: 200 },
  { id: 'p4', name: '限量版手办', priceCents: 59900, stock: 1 }
]

export function seedProducts(db, products = SEED) {
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0) return false
  tx(db, () => {
    const insertProduct = db.prepare('INSERT INTO products (id, name, price_cents) VALUES (?, ?, ?)')
    const insertStock = db.prepare('INSERT INTO inventory (product_id, available) VALUES (?, ?)')
    for (const p of products) {
      insertProduct.run(p.id, p.name, p.priceCents)
      insertStock.run(p.id, p.stock)
    }
  })
  return true
}

const invalid = message => new DomainError('VALIDATION_ERROR', message)

export function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > LIMITS.maxLines) {
    throw invalid(`items 必须是 1~${LIMITS.maxLines} 项的数组`)
  }
  const seen = new Set()
  return items.map((item, i) => {
    if (typeof item?.productId !== 'string' || !/^[\w-]{1,64}$/.test(item.productId)) throw invalid(`items[${i}].productId 不合法`)
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > LIMITS.maxQty) throw invalid(`items[${i}].qty 必须是 1~${LIMITS.maxQty} 的整数`)
    if (seen.has(item.productId)) throw invalid(`商品 ${item.productId} 重复出现`)
    seen.add(item.productId)
    return { productId: item.productId, qty: item.qty }
  })
}

const byProductId = (a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)

const encodeCursor = row => Buffer.from(JSON.stringify([row.created_at, row.id])).toString('base64url')
function decodeCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'string')) return value
  } catch {}
  throw new DomainError('INVALID_CURSOR', '分页游标不合法')
}

const ORDER_COLUMNS = 'id, user_id, status, total_cents, currency, created_at, updated_at'

export function createOrderStore(db, { now = () => new Date(), newId = randomUUID } = {}) {
  const q = {
    product: db.prepare('SELECT id, name, price_cents FROM products WHERE id = ?'),
    products: db.prepare('SELECT p.id, p.name, p.price_cents, i.available FROM products p JOIN inventory i ON i.product_id = p.id ORDER BY p.id'),
    // 条件更新：“检查库存”和“扣减库存”是同一条原子语句，并发下不会超卖
    reserve: db.prepare('UPDATE inventory SET available = available - ? WHERE product_id = ? AND available >= ?'),
    release: db.prepare('UPDATE inventory SET available = available + ? WHERE product_id = ?'),
    insertOrder: db.prepare(`INSERT INTO orders (${ORDER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    insertItem: db.prepare('INSERT INTO order_items (order_id, product_id, qty, unit_price_cents) VALUES (?, ?, ?, ?)'),
    idem: db.prepare('SELECT request_hash, order_id FROM idempotency_keys WHERE user_id = ? AND key = ?'),
    insertIdem: db.prepare('INSERT INTO idempotency_keys (user_id, key, request_hash, order_id, created_at) VALUES (?, ?, ?, ?, ?)'),
    // 所有读取都带 user_id 条件：防止越权（IDOR）读取他人订单
    order: db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ? AND user_id = ?`),
    items: db.prepare('SELECT oi.order_id, oi.product_id, p.name, oi.qty, oi.unit_price_cents FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.product_id'),
    transition: db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = ?'),
    outbox: db.prepare('INSERT INTO outbox (message_id, topic, payload, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?)'),
    firstPage: db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`),
    nextPage: db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE user_id = ? AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`)
  }

  const toItem = r => ({ productId: r.product_id, name: r.name, qty: r.qty, unitPriceCents: r.unit_price_cents })
  const toOrder = (row, items) => ({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    totalCents: row.total_cents,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(toItem)
  })

  function load(userId, orderId) {
    const row = q.order.get(orderId, userId)
    if (!row) throw new DomainError('NOT_FOUND', '订单不存在')
    return toOrder(row, q.items.all(orderId))
  }

  function emit(topic, payload, at) {
    q.outbox.run(randomUUID(), topic, JSON.stringify(payload), at, at)
  }

  function createOrder(userId, idempotencyKey, rawItems) {
    const items = validateItems(rawItems).sort(byProductId)
    const requestHash = createHash('sha256').update(JSON.stringify(items)).digest('hex')

    return tx(db, () => {
      const previous = q.idem.get(userId, idempotencyKey)
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new DomainError('IDEMPOTENCY_KEY_REUSED', '同一个幂等键不能用于内容不同的请求')
        }
        return { order: load(userId, previous.order_id), replayed: true }
      }

      const at = now().toISOString()
      const orderId = newId()
      let totalCents = 0
      const lines = []
      // 按固定顺序（productId）扣减：在 PostgreSQL/MySQL 的行锁下可避免两笔订单互相等待造成死锁
      for (const item of items) {
        const product = q.product.get(item.productId)
        if (!product) throw new DomainError('PRODUCT_NOT_FOUND', `商品 ${item.productId} 不存在`, { productId: item.productId })
        if (q.reserve.run(item.qty, item.productId, item.qty).changes !== 1) {
          // 抛错 → tx() 回滚，前面已扣减的商品也一并恢复
          throw new DomainError('OUT_OF_STOCK', `${product.name} 库存不足`, { productId: item.productId })
        }
        totalCents += product.price_cents * item.qty
        lines.push([item.productId, item.qty, product.price_cents])
      }

      q.insertOrder.run(orderId, userId, 'PENDING', totalCents, 'CNY', at, at)
      for (const [productId, qty, price] of lines) q.insertItem.run(orderId, productId, qty, price)
      q.insertIdem.run(userId, idempotencyKey, requestHash, orderId, at)
      emit('order.created', { orderId, userId, totalCents }, at)
      return { order: load(userId, orderId), replayed: false }
    })
  }

  function transition(userId, orderId, to) {
    const fromStates = Object.keys(TRANSITIONS).filter(s => TRANSITIONS[s].includes(to))
    return tx(db, () => {
      const at = now().toISOString()
      // 条件更新 = 乐观并发控制：只有仍处于预期状态时才会修改成功
      const changed = fromStates.some(from => q.transition.run(to, at, orderId, userId, from).changes === 1)
      if (!changed) {
        const current = q.order.get(orderId, userId)
        if (!current) throw new DomainError('NOT_FOUND', '订单不存在')
        if (current.status === to) return load(userId, orderId) // 重复请求：返回当前结果，保持幂等
        throw new DomainError('INVALID_STATE', `订单状态为 ${current.status}，不能变更为 ${to}`, { status: current.status })
      }
      if (to === 'CANCELLED') {
        for (const item of q.items.all(orderId)) q.release.run(item.qty, item.product_id)
      }
      emit(`order.${to.toLowerCase()}`, { orderId, userId }, at)
      return load(userId, orderId)
    })
  }

  function listOrders(userId, { cursor, limit = 10 } = {}) {
    const size = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), LIMITS.maxPageSize)
    const rows = cursor
      ? q.nextPage.all(userId, ...decodeCursor(cursor), size + 1)
      : q.firstPage.all(userId, size + 1)
    const page = rows.slice(0, size)
    // 一次查询取回本页所有订单项，避免 N+1
    const itemsByOrder = new Map(page.map(r => [r.id, []]))
    if (page.length) {
      const placeholders = page.map(() => '?').join(', ')
      const all = db.prepare(`SELECT oi.order_id, oi.product_id, p.name, oi.qty, oi.unit_price_cents FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (${placeholders}) ORDER BY oi.product_id`).all(...page.map(r => r.id))
      for (const item of all) itemsByOrder.get(item.order_id).push(item)
    }
    return {
      items: page.map(r => toOrder(r, itemsByOrder.get(r.id))),
      nextCursor: rows.length > size ? encodeCursor(page.at(-1)) : null
    }
  }

  return {
    listProducts: () => q.products.all().map(p => ({ id: p.id, name: p.name, priceCents: p.price_cents, available: p.available })),
    createOrder,
    getOrder: load,
    pay: (userId, orderId) => transition(userId, orderId, 'PAID'),
    cancel: (userId, orderId) => transition(userId, orderId, 'CANCELLED'),
    listOrders
  }
}
