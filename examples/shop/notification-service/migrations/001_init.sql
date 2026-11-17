CREATE TABLE inbox (
  message_id  TEXT PRIMARY KEY,
  topic       TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES inbox(message_id),
  text       TEXT NOT NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notifications_user ON notifications (user_id, id DESC);
