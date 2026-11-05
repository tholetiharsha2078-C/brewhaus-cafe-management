-- Brewhaus Cafe Management System — normalized schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS kitchen_stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#b07d4f',
  target_minutes INTEGER NOT NULL DEFAULT 12,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','supervisor','kitchen','waiter')),
  phone TEXT,
  station_id INTEGER REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  last_visit_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_created ON customers(created_at);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_type TEXT NOT NULL CHECK (user_type IN ('staff','customer')),
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_type TEXT NOT NULL CHECK (user_type IN ('staff','customer')),
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cafe_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  address TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  latitude REAL,
  longitude REAL,
  map_url TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  tax_rate REAL NOT NULL DEFAULT 5,
  service_charge_rate REAL NOT NULL DEFAULT 0,
  tax_inclusive INTEGER NOT NULL DEFAULT 0,
  prepayment_required INTEGER NOT NULL DEFAULT 0,
  takeaway_enabled INTEGER NOT NULL DEFAULT 1,
  reservation_hold_minutes INTEGER NOT NULL DEFAULT 10,
  reservation_slot_minutes INTEGER NOT NULL DEFAULT 90,
  opening_time TEXT NOT NULL DEFAULT '08:00',
  closing_time TEXT NOT NULL DEFAULT '23:00',
  loyalty_enabled INTEGER NOT NULL DEFAULT 1,
  loyalty_points_per_100 REAL NOT NULL DEFAULT 5,
  loyalty_point_value REAL NOT NULL DEFAULT 0.25,
  loyalty_min_redeem INTEGER NOT NULL DEFAULT 100,
  review_moderation INTEGER NOT NULL DEFAULT 0,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS floor_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 1000,
  height INTEGER NOT NULL DEFAULT 620,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cafe_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  floor_plan_id INTEGER NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 2,
  x REAL NOT NULL DEFAULT 40,
  y REAL NOT NULL DEFAULT 40,
  width REAL NOT NULL DEFAULT 110,
  height REAL NOT NULL DEFAULT 110,
  shape TEXT NOT NULL DEFAULT 'round' CHECK (shape IN ('round','square','rect','booth')),
  zone TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','occupied','cleaning','out_of_service')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (floor_plan_id, label)
);
CREATE INDEX IF NOT EXISTS idx_tables_floor ON cafe_tables(floor_plan_id);

CREATE TABLE IF NOT EXISTS table_holds (
  id TEXT PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES cafe_tables(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  party_size INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_holds_slot ON table_holds(slot_date, slot_time);
CREATE INDEX IF NOT EXISTS idx_holds_expiry ON table_holds(expires_at);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  guest_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  reservation_date TEXT NOT NULL,
  reservation_time TEXT NOT NULL,
  party_size INTEGER NOT NULL,
  table_id INTEGER REFERENCES cafe_tables(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','seated','completed','cancelled','no_show')),
  special_requests TEXT,
  source TEXT NOT NULL DEFAULT 'management' CHECK (source IN ('management','online','phone','walk_in')),
  created_by_type TEXT NOT NULL DEFAULT 'staff' CHECK (created_by_type IN ('staff','customer')),
  created_by_id INTEGER,
  cancelled_reason TEXT,
  confirmed_at TEXT,
  seated_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_res_date ON reservations(reservation_date, reservation_time);
CREATE INDEX IF NOT EXISTS idx_res_table ON reservations(table_id, reservation_date);
CREATE INDEX IF NOT EXISTS idx_res_customer ON reservations(customer_id);
CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);

CREATE TABLE IF NOT EXISTS menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
  station_id INTEGER REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL CHECK (price >= 0),
  prep_time INTEGER NOT NULL DEFAULT 10,
  image_url TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  dietary TEXT CHECK (dietary IN ('veg','non_veg','vegan','egg')),
  tags TEXT,
  ingredients_text TEXT,
  is_special INTEGER NOT NULL DEFAULT 0,
  is_recommended INTEGER NOT NULL DEFAULT 0,
  sku TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_menu_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_available ON menu_items(available);
CREATE INDEX IF NOT EXISTS idx_menu_station ON menu_items(station_id);

CREATE TABLE IF NOT EXISTS menu_option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  selection_type TEXT NOT NULL DEFAULT 'single' CHECK (selection_type IN ('single','multi')),
  required INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_option_groups_item ON menu_option_groups(menu_item_id);

CREATE TABLE IF NOT EXISTS menu_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES menu_option_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_delta REAL NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_options_group ON menu_options(group_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
  table_id INTEGER REFERENCES cafe_tables(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'dine_in' CHECK (type IN ('dine_in','takeaway','preorder')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','preparing','ready','collected','served','completed','cancelled','on_hold')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','partially_refunded','refunded','failed')),
  subtotal REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  service_charge REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  loyalty_discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  guest_name TEXT,
  guest_phone TEXT,
  notes TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  eta_minutes INTEGER NOT NULL DEFAULT 20,
  estimated_ready_at TEXT,
  validated INTEGER NOT NULL DEFAULT 1,
  validation_notes TEXT,
  hold_reason TEXT,
  idempotency_key TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'management' CHECK (source IN ('management','customer','kitchen','waiter')),
  created_by_type TEXT NOT NULL DEFAULT 'staff' CHECK (created_by_type IN ('staff','customer','system')),
  created_by_id INTEGER,
  waiter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  collected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  placed_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  prep_started_at TEXT,
  ready_at TEXT,
  collected_at TEXT,
  served_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  actual_prep_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_placed ON orders(placed_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_reservation ON orders(reservation_id);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders(payment_status);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  station_id INTEGER REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price REAL NOT NULL,
  options_json TEXT,
  options_total REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','served','cancelled')),
  special_instructions TEXT,
  allergy_flag INTEGER NOT NULL DEFAULT 0,
  assigned_staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT,
  ready_at TEXT,
  served_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_station ON order_items(station_id, status);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  actor_type TEXT NOT NULL DEFAULT 'staff',
  actor_id INTEGER,
  actor_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_ref TEXT NOT NULL UNIQUE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  refunded_amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','upi','card','other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','partially_refunded')),
  gateway_ref TEXT,
  notes TEXT,
  paid_at TEXT,
  created_by_type TEXT NOT NULL DEFAULT 'staff' CHECK (created_by_type IN ('staff','customer','system')),
  created_by_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  note TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_events ON payment_events(payment_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  expense_date TEXT NOT NULL,
  is_estimated INTEGER NOT NULL DEFAULT 0,
  vendor TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'General',
  unit TEXT NOT NULL DEFAULT 'g',
  stock_qty REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  cost_per_unit REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ingredients_low ON ingredients(stock_qty, min_stock);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  notes TEXT,
  UNIQUE (menu_item_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_recipes_item ON recipes(menu_item_id);

CREATE TABLE IF NOT EXISTS purchase_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_date TEXT NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('ordered','received','cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchase_records(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase','consumption','wastage','adjustment','return')),
  qty_change REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id INTEGER,
  note TEXT,
  created_by_type TEXT NOT NULL DEFAULT 'staff',
  created_by_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_ingredient ON inventory_movements(ingredient_id, created_at);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  points INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earn','redeem','adjust','expire')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON loyalty_transactions(customer_id, created_at);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  food_rating INTEGER NOT NULL CHECK (food_rating BETWEEN 1 AND 5),
  service_rating INTEGER NOT NULL CHECK (service_rating BETWEEN 1 AND 5),
  overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  comment TEXT,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  moderated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audience TEXT NOT NULL CHECK (audience IN ('staff','kitchen','customer','all')),
  user_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_audience ON notifications(audience, created_at);

CREATE TABLE IF NOT EXISTS availability_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  station_id INTEGER REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'temporarily_unavailable' CHECK (kind IN ('temporarily_unavailable','ingredient_shortage','equipment_issue','restock_needed')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  reported_by INTEGER,
  reported_by_name TEXT,
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_availability_status ON availability_reports(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  meta TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS settings_flags (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
