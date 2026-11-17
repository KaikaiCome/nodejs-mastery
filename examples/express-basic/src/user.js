import { Errors } from './errors.js'

// Repository：数据访问（这里用内存 Map 代替数据库）
export class UserRepository {
  #rows = new Map()
  #seq = 0
  async findById(id) { return this.#rows.get(id) ?? null }
  async findByEmail(email) { return [...this.#rows.values()].find(u => u.email === email) ?? null }
  async list() { return [...this.#rows.values()] }
  async insert(data) {
    const user = { id: String(++this.#seq), ...data, createdAt: new Date().toISOString() }
    this.#rows.set(user.id, user)
    return user
  }
}

// Service：业务规则，不依赖 req/res
export class UserService {
  constructor(repo) { this.repo = repo }

  async getById(id) {
    const user = await this.repo.findById(id)
    if (!user) throw Errors.NotFound('user')
    return user
  }

  async create({ email, name }) {
    if (await this.repo.findByEmail(email)) throw Errors.Conflict('email already registered')
    return this.repo.insert({ email, name })
  }

  list() { return this.repo.list() }
}
