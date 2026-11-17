// Outbox relay：把已提交的事件投递给下游。
// 语义是“至少一次”：发布成功但标记失败（进程崩溃、hooks.afterPublish 抛错）时会重复投递，
// 因此消费者必须按 message_id 去重。不保证全局顺序：失败重试的消息可能晚于后续消息到达。
export function createOutboxRelay(db, {
  publish,
  batchSize = 20,
  now = () => new Date(),
  backoffMs = attempts => Math.min(30_000, 200 * 2 ** attempts),
  hooks = {},
  logger
}) {
  const due = db.prepare(`SELECT id, message_id, topic, payload, attempts FROM outbox
    WHERE published_at IS NULL AND next_attempt_at <= ? ORDER BY id LIMIT ?`)
  const markPublished = db.prepare('UPDATE outbox SET published_at = ?, attempts = attempts + 1 WHERE id = ?')
  const markFailed = db.prepare('UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?')

  // 单实例假设。多实例部署时需要 SELECT ... FOR UPDATE SKIP LOCKED（PostgreSQL）或租约字段，避免重复抢同一批消息。
  async function relayOnce() {
    const rows = due.all(now().toISOString(), batchSize)
    let published = 0
    for (const row of rows) {
      const message = { messageId: row.message_id, topic: row.topic, payload: JSON.parse(row.payload) }
      try {
        await publish(message)
        await hooks.afterPublish?.(message)
        markPublished.run(now().toISOString(), row.id)
        published++
      } catch (err) {
        const next = new Date(now().getTime() + backoffMs(row.attempts + 1)).toISOString()
        markFailed.run(next, String(err?.message ?? err).slice(0, 500), row.id)
        logger?.warn('outbox publish failed', { messageId: row.message_id, attempts: row.attempts + 1, err })
      }
    }
    return { scanned: rows.length, published }
  }

  let timer = null
  let running = null
  let stopped = true

  // 用“完成后再调度下一轮”代替 setInterval，保证同一时刻只有一轮在执行
  function schedule(intervalMs) {
    if (stopped) return
    timer = setTimeout(() => {
      running = relayOnce()
        .catch(err => logger?.error('outbox relay crashed', { err }))
        .finally(() => { running = null; schedule(intervalMs) })
    }, intervalMs)
  }

  return {
    relayOnce,
    start(intervalMs = 500) {
      if (!stopped) return
      stopped = false
      schedule(intervalMs)
    },
    async stop() {
      stopped = true
      clearTimeout(timer)
      await running
    },
    pending: () => db.prepare('SELECT COUNT(*) AS n FROM outbox WHERE published_at IS NULL').get().n
  }
}
