ALTER TABLE orders ADD COLUMN tracking_token TEXT;
ALTER TABLE orders ADD COLUMN offer_code TEXT;

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','flat')),
  value REAL NOT NULL,
  min_order REAL NOT NULL DEFAULT 0,
  max_discount REAL,
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (customer_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_token);
CREATE INDEX IF NOT EXISTS idx_favorites_customer ON favorites(customer_id);
