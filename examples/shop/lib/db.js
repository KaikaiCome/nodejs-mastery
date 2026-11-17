import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
  }
  return db
}

// node:sqlite 是同步 API：事务内不能出现 await，事务天然不会与本进程其他请求交错。
// BEGIN IMMEDIATE 立即获取写锁，多个进程同时写时由 SQLite 串行化。
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// 版本化迁移：按文件名顺序执行，每个迁移在独立事务中执行并记录校验和。
// 已执行的迁移被修改时拒绝启动——已发布的迁移只能追加新文件来修正。
export function migrate(db, dir) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const applied = new Map(db.prepare('SELECT version, checksum FROM schema_migrations').all().map(r => [r.version, r.checksum]))
  const files = readdirSync(dir).filter(f => /^\d{3}_[\w-]+\.sql$/.test(f)).sort()
  const seen = new Set()
  const ran = []
  for (const file of files) {
    const version = file.slice(0, 3)
    if (seen.has(version)) throw new Error(`duplicate migration version ${version}`)
    seen.add(version)
    const sql = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n')
    const checksum = createHash('sha256').update(sql).digest('hex')
    if (applied.has(version)) {
      if (applied.get(version) !== checksum) throw new Error(`migration ${file} was modified after being applied`)
      continue
    }
    tx(db, () => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(version, file, checksum, new Date().toISOString())
    })
    ran.push(file)
  }
  return ran
}
