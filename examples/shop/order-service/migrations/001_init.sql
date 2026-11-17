-- 约束是最后一道防线：即使应用代码有 bug，数据库也拒绝非法数据
CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0)
);

CREATE TABLE inventory (
  product_id TEXT PRIMARY KEY REFERENCES products(id),
  available  INTEGER NOT NULL CHECK (available >= 0)
);

CREATE TABLE orders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 支撑“我的订单”游标分页：WHERE user_id = ? ORDER BY created_at DESC, id DESC
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC, id DESC);

CREATE TABLE order_items (
  order_id         TEXT NOT NULL REFERENCES orders(id),
  product_id       TEXT NOT NULL REFERENCES products(id),
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  PRIMARY KEY (order_id, product_id)
);

-- 幂等记录与订单在同一事务中写入：要么都存在，要么都不存在
CREATE TABLE idempotency_keys (
  user_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_id     TEXT NOT NULL REFERENCES orders(id),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Outbox：业务数据与“待发布事件”同事务提交，由后台任务至少投递一次
CREATE TABLE outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      TEXT NOT NULL UNIQUE,
  topic           TEXT NOT NULL,
  payload         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  published_at    TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error      TEXT
);

CREATE INDEX idx_outbox_due ON outbox (published_at, next_attempt_at, id);
