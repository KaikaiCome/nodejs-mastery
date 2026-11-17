import { scrypt as scryptCb, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)
const KEY_LEN = 32

export const DEMO_USERS = [
  { id: 'u_alice', username: 'alice', password: 'alice123', name: 'Alice' },
  { id: 'u_bob', username: 'bob', password: 'bob123', name: 'Bob' }
]

// 只保存 salt + hash，永远不保存明文。启动时同步计算一次可以接受；请求路径上必须用异步版本，避免阻塞事件循环。
export function createUserStore(users = DEMO_USERS) {
  const byName = new Map(users.map(u => {
    const salt = randomBytes(16)
    return [u.username, { id: u.id, name: u.name, salt, hash: scryptSync(u.password, salt, KEY_LEN) }]
  }))
  const dummy = { salt: randomBytes(16), hash: randomBytes(KEY_LEN) }

  return {
    async verify(username, password) {
      const user = byName.get(username)
      // 用户不存在时也做一次同样代价的哈希，避免通过响应时间枚举用户名
      const record = user ?? dummy
      const hash = await scrypt(String(password), record.salt, KEY_LEN)
      return user && timingSafeEqual(hash, user.hash) ? { id: user.id, name: user.name } : null
    }
  }
}

// 内存会话：演示用。多实例部署必须换成 Redis 等共享存储，否则请求落到别的实例就“掉登录”。
export function createSessionStore({ ttlMs = 30 * 60_000, now = () => Date.now() } = {}) {
  const sessions = new Map()
  return {
    create(user) {
      const sid = randomBytes(32).toString('base64url')
      sessions.set(sid, { user, expiresAt: now() + ttlMs })
      return sid
    },
    get(sid) {
      const s = sid && sessions.get(sid)
      if (!s) return null
      if (s.expiresAt <= now()) { sessions.delete(sid); return null }
      s.expiresAt = now() + ttlMs // 滑动过期
      return s.user
    },
    destroy(sid) { sessions.delete(sid) },
    size: () => sessions.size
  }
}

// 固定窗口的尝试计数：按 IP + 用户名限流，防止撞库/爆破。多实例时同样需要共享存储。
// 必须在耗时的密码校验“之前”计数：先检查、await 校验、失败后再计数的写法，
// 会让同时到达的 N 个请求全部通过检查，限流形同虚设。
export function createLoginLimiter({ max = 5, windowMs = 60_000, now = () => Date.now() } = {}) {
  const attempts = new Map()
  return {
    // 同步地“检查 + 计数”，中间没有 await，所以并发请求无法同时溜过。返回需要等待的秒数，0 表示放行
    hit(key) {
      let entry = attempts.get(key)
      if (!entry || entry.resetAt <= now()) {
        entry = { count: 0, resetAt: now() + windowMs }
        attempts.set(key, entry)
      }
      if (entry.count >= max) return Math.max(1, Math.ceil((entry.resetAt - now()) / 1000))
      entry.count++
      return 0
    },
    reset(key) { attempts.delete(key) }
  }
}

export function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()) } catch {}
    }
  }
  return out
}
