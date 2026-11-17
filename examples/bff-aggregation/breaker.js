// 简化版熔断器：CLOSED → OPEN → HALF_OPEN → CLOSED
export class CircuitBreaker {
  constructor(action, {
    name = 'breaker',
    failureThreshold = 0.5, // 失败率阈值
    minimumRequests = 10,   // 窗口内最少请求数才判定
    windowMs = 10_000,      // 统计窗口
    resetTimeoutMs = 5_000, // OPEN 多久后进入 HALF_OPEN
    fallback,
    now = Date.now
  } = {}) {
    Object.assign(this, { action, name, failureThreshold, minimumRequests, windowMs, resetTimeoutMs, fallback, now })
    this.state = 'CLOSED'
    this.openedAt = 0
    this.halfOpenInFlight = false
    this.results = [] // { t, ok }
  }

  async fire(...args) {
    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN'
      } else {
        return this.#reject(new Error(`${this.name} circuit open`))
      }
    }
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenInFlight) return this.#reject(new Error(`${this.name} circuit half-open`))
      this.halfOpenInFlight = true
    }
    try {
      const result = await this.action(...args)
      this.#record(true)
      return result
    } catch (err) {
      this.#record(false)
      return this.#reject(err)
    } finally {
      this.halfOpenInFlight = false
    }
  }

  #reject(err) {
    if (this.fallback) return this.fallback(err)
    throw err
  }

  #record(ok) {
    if (this.state === 'HALF_OPEN') {
      if (ok) { this.state = 'CLOSED'; this.results = [] } else this.#open()
      return
    }
    const t = this.now()
    this.results.push({ t, ok })
    this.results = this.results.filter(r => t - r.t <= this.windowMs)
    const failures = this.results.filter(r => !r.ok).length
    if (this.results.length >= this.minimumRequests && failures / this.results.length >= this.failureThreshold) {
      this.#open()
    }
  }

  #open() {
    this.state = 'OPEN'
    this.openedAt = this.now()
    this.results = []
  }

  stats() {
    return { name: this.name, state: this.state, windowRequests: this.results.length, windowFailures: this.results.filter(r => !r.ok).length }
  }
}
