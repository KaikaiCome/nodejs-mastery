import { timingSafeEqual, createHash } from 'node:crypto'
import { createRouter, createService, readJson, HttpError } from '../lib/http.js'
import { tx } from '../lib/db.js'

const TEXT = {
  'order.created': p => `订单 ${p.orderId.slice(0, 8)} 已创建，合计 ¥${(p.totalCents / 100).toFixed(2)}`,
  'order.paid': p => `订单 ${p.orderId.slice(0, 8)} 支付成功`,
  'order.cancelled': p => `订单 ${p.orderId.slice(0, 8)} 已取消，库存已释放`
}

export function createNotificationStore(db, { now = () => new Date() } = {}) {
  const q = {
    inbox: db.prepare('INSERT INTO inbox (message_id, topic, received_at) VALUES (?, ?, ?) ON CONFLICT (message_id) DO NOTHING'),
    insert: db.prepare('INSERT INTO notifications (user_id, message_id, text, created_at) VALUES (?, ?, ?, ?)'),
    list: db.prepare('SELECT id, text, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'),
    unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
  }
  return {
    // Inbox 去重：message_id 写入与业务处理同一事务，重复投递只会被确认、不会重复处理
    handle({ messageId, topic, payload }) {
      return tx(db, () => {
        const at = now().toISOString()
        if (q.inbox.run(messageId, topic, at).changes === 0) return 'duplicate'
        const render = TEXT[topic]
        if (!render || typeof payload?.userId !== 'string') return 'ignored' // 未知事件也要确认，否则会被无限重投
        q.insert.run(payload.userId, messageId, render(payload), at)
        return 'processed'
      })
    },
    list(userId, limit = 5) {
      return {
        unread: q.unread.get(userId).n,
        items: q.list.all(userId, limit).map(r => ({ id: r.id, text: r.text, read: r.read_at !== null, createdAt: r.created_at }))
      }
    }
  }
}

const digest = s => createHash('sha256').update(String(s)).digest()

export function createNotificationServer({ store, serviceToken, logger, metrics, lifecycle, faults = { failNextEvents: 0 } }) {
  const processed = metrics.counter('notification_events_total', 'Events received by the notification service')
  const auth = req => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    if (!timingSafeEqual(digest(token), digest(serviceToken))) throw new HttpError(401, 'UNAUTHENTICATED', '缺少或无效的服务凭证')
  }
  const router = createRouter()
    .add('POST', '/events', async ({ req }) => {
      auth(req)
      const event = await readJson(req)
      if (typeof event?.messageId !== 'string' || typeof event?.topic !== 'string') {
        throw new HttpError(400, 'VALIDATION_ERROR', '事件必须包含 messageId 和 topic')
      }
      if (faults.failNextEvents > 0) {
        faults.failNextEvents--
        throw new HttpError(503, 'TEMPORARILY_UNAVAILABLE', 'injected failure', { expose: true })
      }
      const result = store.handle(event)
      processed.inc({ topic: event.topic, result })
      return { result }
    })
    .add('GET', '/notifications', ({ req }) => {
      auth(req)
      const userId = req.headers['x-user-id']
      if (typeof userId !== 'string' || !userId) throw new HttpError(400, 'MISSING_USER', '缺少 x-user-id')
      return store.list(userId)
    })

  return createService({ name: 'notification-service', router, logger, metrics, isReady: lifecycle?.isReady, isShuttingDown: lifecycle?.isShuttingDown })
}
