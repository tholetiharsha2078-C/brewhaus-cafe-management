// First-run seed data. Everything here becomes real rows in D1; dashboard figures are
// always computed from these records, never hardcoded in the UI.
import { hashPassword } from './lib/auth.js';
import { addDays, istDateStr, istDateTimeISO, istDayStart, money } from './lib/utils.js';

let seeded = false;
let seeding = null;

export async function ensureSeeded(env) {
  if (seeded) return;
  if (seeding) return seeding;
  seeding = (async () => {
    const flag = await env.DB.prepare("SELECT value FROM settings_flags WHERE key='seed_version'").first();
    if (flag) {
      seeded = true;
      return;
    }
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    if (count?.n > 0) {
      await env.DB.prepare("INSERT OR REPLACE INTO settings_flags (key, value) VALUES ('seed_version','1')").run();
      seeded = true;
      return;
    }
    await seedDatabase(env);
    seeded = true;
  })().finally(() => {
    seeding = null;
  });
  return seeding;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20261105);
const rand = (min, max) => min + rng() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

async function runBatches(db, statements, size = 40) {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

async function seedDatabase(env) {
  const db = env.DB;
  const now = new Date();
  const today = istDateStr(now);
  const nowIso = now.toISOString();

  const adminHash = await hashPassword('Admin@123');
  const managerHash = await hashPassword('Manager@123');
  const kitchenHash = await hashPassword('Kitchen@123');
  const waiterHash = await hashPassword('Waiter@123');
  const customerHash = await hashPassword('Customer@123');

  // ---- Stations ------------------------------------------------------------
  const stations = [
    [1, 'Beverage Station', 'Coffee, tea and all cold drinks', '#b07d4f', 8, 1, 1],
    [2, 'Bakery Station', 'Bakes, desserts and breads', '#a26769', 6, 1, 2],
    [3, 'Main Course Station', 'Pizza, pasta, burgers and plates', '#6f7d5c', 18, 1, 3],
    [4, 'Snacks Station', 'Fries, sandwiches and small plates', '#8a6a4b', 12, 1, 4],
  ];
  const stmts = stations.map((s) =>
    db.prepare('INSERT INTO kitchen_stations (id,name,description,color,target_minutes,active,sort_order) VALUES (?,?,?,?,?,?,?)').bind(...s)
  );

  // ---- Staff ---------------------------------------------------------------
  stmts.push(
    db.prepare('INSERT INTO users (id,name,email,password_hash,role,phone,station_id,active) VALUES (?,?,?,?,?,?,?,1)').bind(1, 'Aarav Mehta', 'admin@brewhaus.cafe', adminHash, 'owner', '+91 98860 11223', null),
    db.prepare('INSERT INTO users (id,name,email,password_hash,role,phone,station_id,active) VALUES (?,?,?,?,?,?,?,1)').bind(2, 'Nisha Rao', 'nisha@brewhaus.cafe', managerHash, 'manager', '+91 98860 44556', null),
    db.prepare('INSERT INTO users (id,name,email,password_hash,role,phone,station_id,active) VALUES (?,?,?,?,?,?,?,1)').bind(3, 'Kabir Shah', 'kitchen@brewhaus.cafe', kitchenHash, 'kitchen', '+91 98860 77889', 1),
    db.prepare('INSERT INTO users (id,name,email,password_hash,role,phone,station_id,active) VALUES (?,?,?,?,?,?,?,1)').bind(4, 'Meera Iyer', 'meera@brewhaus.cafe', kitchenHash, 'supervisor', '+91 98860 33445', 2),
    db.prepare('INSERT INTO users (id,name,email,password_hash,role,phone,station_id,active) VALUES (?,?,?,?,?,?,?,1)').bind(5, 'Rohan Das', 'waiter@brewhaus.cafe', waiterHash, 'waiter', '+91 98860 66778', null)
  );

  // ---- Customers -----------------------------------------------------------
  const customerSeeds = [
    [1, 'Priya Sharma', 'priya@example.com', '+91 98450 10101', 1, 0, 'Oat milk cappuccino, no sugar.'],
    [2, 'Arjun Nair', 'arjun.nair@example.com', '+91 98450 20202', 1, 0, ''],
    [3, 'Sneha Kulkarni', 'sneha.k@example.com', '+91 98450 30303', 1, 1, 'Prefers window seating.'],
    [4, 'Vikram Shetty', 'vikram.s@example.com', '+91 98450 40404', 1, 0, ''],
    [5, 'Ananya Reddy', 'ananya.r@example.com', '+91 98450 50505', 1, 1, 'Vegetarian only.'],
    [6, 'Rahul Menon', 'rahul.menon@example.com', '+91 98450 60606', 1, 0, ''],
    [7, 'Divya Bhat', 'divya.bhat@example.com', '+91 98450 70707', 1, 0, ''],
    [8, 'Karthik Suresh', 'karthik.s@example.com', '+91 98450 80808', 1, 0, ''],
    [9, 'Neha Joshi', 'neha.joshi@example.com', '+91 98450 90909', 1, 1, ''],
    [10, 'Sameer Khan', 'sameer.khan@example.com', '+91 98451 01010', 1, 0, ''],
    [11, 'Ishita Bose', 'ishita.bose@example.com', '+91 98451 11111', 1, 0, ''],
    [12, 'Aditya Rao', 'aditya.rao@example.com', '+91 98451 21212', 1, 0, ''],
  ];
  for (const c of customerSeeds) {
    stmts.push(
      db.prepare('INSERT INTO customers (id,name,email,phone,password_hash,loyalty_points,marketing_opt_in,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(
        c[0], c[1], c[2], c[3], customerHash, 0, c[5], c[6], new Date(Date.now() - (120 - c[0] * 7) * 86400000).toISOString()
      )
    );
  }

  // ---- Settings ------------------------------------------------------------
  stmts.push(
    db.prepare(`INSERT INTO cafe_settings (id,name,tagline,description,address,phone,email,latitude,longitude,currency,tax_rate,service_charge_rate,prepayment_required,takeaway_enabled,reservation_hold_minutes,reservation_slot_minutes,opening_time,closing_time,loyalty_enabled,loyalty_points_per_100,loyalty_point_value,loyalty_min_redeem,review_moderation,ai_enabled)
      VALUES (1,?,?,?,?,?,?,?,?,'INR',5,0,0,1,10,90,'08:00','23:00',1,5,0.25,100,0,1)`).bind(
      'Brewhaus Coffee & Kitchen',
      'Slow mornings, honest food.',
      'A neighbourhood coffee house and kitchen on Lavelle Road. Single-origin coffee, wood-fired plates and a quiet corner to linger in.',
      '18 Lavelle Road, Ashok Nagar, Bengaluru, Karnataka 560001',
      '+91 80 4123 8890',
      'hello@brewhaus.cafe',
      12.9698,
      77.5963
    )
  );

  stmts.push(
    db.prepare("INSERT INTO offers (title,description,code,discount_type,value,min_order,max_discount,active) VALUES (?,?,?,?,?,?,?,1)").bind(
      '10% off your table', 'A little thank-you for dining in. Valid on orders above ₹500.', 'BREW10', 'percent', 10, 500, 150
    ),
    db.prepare("INSERT INTO offers (title,description,code,discount_type,value,min_order,max_discount,active) VALUES (?,?,?,?,?,?,?,1)").bind(
      'Weekend ₹150 off', 'Flat ₹150 off weekend orders above ₹800.', 'WEEKEND150', 'flat', 150, 800, 150
    )
  );

  // ---- Floor plan + tables -------------------------------------------------
  stmts.push(db.prepare("INSERT INTO floor_plans (id,name,width,height,active) VALUES (1,'Main Floor',1000,620,1)"));
  const tableSeeds = [
    [1, 'T1', 2, 60, 60, 96, 96, 'round', 'Window'],
    [2, 'T2', 2, 200, 60, 96, 96, 'round', 'Window'],
    [3, 'T3', 4, 340, 58, 120, 100, 'rect', 'Window'],
    [4, 'T4', 4, 510, 58, 120, 100, 'rect', 'Window'],
    [5, 'T5', 2, 690, 60, 96, 96, 'round', 'Window'],
    [6, 'T6', 6, 830, 48, 130, 120, 'booth', 'Window'],
    [7, 'T7', 4, 62, 245, 118, 118, 'square', 'Main'],
    [8, 'T8', 4, 225, 245, 118, 118, 'square', 'Main'],
    [9, 'T9', 6, 388, 238, 150, 130, 'rect', 'Main'],
    [10, 'T10', 4, 580, 245, 118, 118, 'round', 'Main'],
    [11, 'T11', 2, 745, 255, 96, 96, 'round', 'Main'],
    [12, 'T12', 4, 60, 445, 140, 110, 'booth', 'Garden'],
    [13, 'T13', 4, 245, 445, 140, 110, 'booth', 'Garden'],
    [14, 'T14', 6, 430, 435, 150, 130, 'rect', 'Garden'],
  ];
  for (const t of tableSeeds) {
    stmts.push(
      db.prepare('INSERT INTO cafe_tables (id,floor_plan_id,label,capacity,x,y,width,height,shape,zone,status) VALUES (?,1,?,?,?,?,?,?,?,?,?)').bind(
        t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], 'available'
      )
    );
  }

  // ---- Menu categories -----------------------------------------------------
  const categories = [
    [1, 'Coffee', 'coffee', 'Single-origin espresso, milk drinks and slow brews.', '/seed/cappuccino.jpg', 1],
    [2, 'Tea', 'tea', 'Loose-leaf teas and house chai.', '/seed/tea.jpg', 2],
    [3, 'Cold Beverages', 'cold-beverages', 'Iced, sparkling and shaken.', '/seed/coldbrew.jpg', 3],
    [4, 'Smoothies', 'smoothies', 'Fruit-forward blends, made to order.', '/seed/smoothie.jpg', 4],
    [5, 'Snacks', 'snacks', 'Small plates for sharing.', '/seed/fries.jpg', 5],
    [6, 'Sandwiches', 'sandwiches', 'Toasted, stacked and wrapped.', '/seed/sandwich.jpg', 6],
    [7, 'Main Course', 'main-course', 'Wood-fired and slow-cooked plates.', '/seed/pizza.jpg', 7],
    [8, 'Desserts', 'desserts', 'Bakes from our morning counter.', '/seed/cheesecake.jpg', 8],
    [9, 'Specials', 'specials', 'Seasonal plates from the kitchen.', '/seed/avocado-toast.jpg', 9],
  ];
  for (const c of categories) {
    stmts.push(
      db.prepare('INSERT INTO menu_categories (id,name,slug,description,image_url,sort_order,active) VALUES (?,?,?,?,?,?,1)').bind(...c)
    );
  }

  // ---- Menu items ----------------------------------------------------------
  // [id, cat, station, name, price, prep, image, dietary, description, tags, special, recommended, ingredientsText]
  const items = [
    [1, 1, 1, 'Espresso', 150, 4, '/seed/espresso.jpg', 'vegan', 'A 30ml pull of our seasonal single origin — cocoa, dried fig and a clean finish.', 'Signature,Hot', 0, 1, 'Coffee beans'],
    [2, 1, 1, 'Cappuccino', 190, 6, '/seed/cappuccino.jpg', 'veg', 'Double espresso, steamed milk and a soft cap of microfoam.', 'Bestseller,Hot', 0, 1, 'Coffee beans, Milk'],
    [3, 1, 1, 'Caffè Latte', 210, 6, '/seed/latte.jpg', 'veg', 'Silky steamed milk over a double shot, with a little latte art.', 'Hot', 0, 0, 'Coffee beans, Milk'],
    [4, 1, 1, 'Mocha', 230, 7, '/seed/hotchocolate.jpg', 'veg', 'Espresso folded into dark chocolate and steamed milk.', 'Hot,Indulgent', 0, 0, 'Coffee beans, Milk, Dark chocolate'],
    [5, 1, 1, 'Cold Brew', 220, 4, '/seed/coldbrew.jpg', 'vegan', 'Steeped for 18 hours. Bright, low-acid and served over a single cube.', 'Cold,Bestseller', 0, 1, 'Coffee beans, Water'],
    [6, 1, 1, 'Iced Latte', 240, 5, '/seed/coldbrew.jpg', 'veg', 'Double shot, cold milk, plenty of ice. Simple and cold.', 'Cold', 0, 0, 'Coffee beans, Milk'],
    [7, 1, 1, 'Matcha Latte', 260, 6, '/seed/matcha.jpg', 'veg', 'Ceremonial matcha whisked with milk. Grassy, sweet, calming.', 'Signature,Hot', 1, 0, 'Matcha powder, Milk'],
    [8, 1, 1, 'Filter Coffee', 120, 5, '/seed/espresso.jpg', 'veg', 'South Indian style filter decoction with hot milk and a little sugar.', 'House', 0, 0, 'Coffee beans, Milk, Sugar'],
    [9, 2, 1, 'Masala Chai', 120, 5, '/seed/tea.jpg', 'veg', 'Assam tea simmered with ginger, cardamom and milk.', 'House,Hot', 0, 1, 'Tea leaves, Milk, Sugar, Spices'],
    [10, 2, 1, 'Earl Grey', 140, 4, '/seed/tea.jpg', 'vegan', 'Bergamot-scented black tea, served in a pot.', 'Hot', 0, 0, 'Tea leaves'],
    [11, 2, 1, 'Hibiscus Iced Tea', 180, 5, '/seed/icedtea.jpg', 'vegan', 'Cold-steeped hibiscus with citrus and a touch of jaggery.', 'Cold,Special', 1, 0, 'Hibiscus, Jaggery, Lemon'],
    [12, 3, 1, 'Classic Lemonade', 160, 4, '/seed/icedtea.jpg', 'vegan', 'Fresh lemon, cane sugar and soda. Not too sweet.', 'Cold', 0, 0, 'Lemon, Sugar, Soda'],
    [13, 3, 1, 'Cold Chocolate', 210, 5, '/seed/hotchocolate.jpg', 'veg', 'Dark chocolate, cold milk, a whisper of sea salt.', 'Cold,Indulgent', 0, 0, 'Dark chocolate, Milk'],
    [14, 3, 1, 'Sparkling Espresso', 230, 5, '/seed/coldbrew.jpg', 'vegan', 'Espresso over tonic, orange peel and ice. Bitter and bright.', 'Cold,Signature', 1, 0, 'Coffee beans, Tonic, Orange'],
    [15, 3, 1, 'Iced Matcha', 250, 5, '/seed/matcha.jpg', 'vegan', 'Matcha shaken with cold water and lightly sweetened.', 'Cold', 0, 0, 'Matcha powder, Sugar'],
    [16, 4, 1, 'Berry Smoothie', 260, 5, '/seed/smoothie.jpg', 'vegan', 'Strawberry, blueberry, banana and coconut milk.', 'Cold,Healthy', 0, 1, 'Berries, Banana, Coconut milk'],
    [17, 4, 1, 'Mango Lassi', 220, 5, '/seed/smoothie.jpg', 'veg', 'Alphonso mango, yoghurt and a pinch of cardamom.', 'Cold', 0, 0, 'Mango, Yoghurt, Cardamom'],
    [18, 4, 1, 'Green Detox', 270, 5, '/seed/smoothie.jpg', 'vegan', 'Spinach, green apple, cucumber, ginger and lime.', 'Cold,Healthy', 1, 0, 'Spinach, Green apple, Cucumber, Ginger'],
    [19, 4, 1, 'Peanut Butter Shake', 290, 6, '/seed/smoothie.jpg', 'veg', 'Peanut butter, banana, milk and a scoop of vanilla.', 'Cold,Indulgent', 0, 0, 'Peanut butter, Banana, Milk'],
    [20, 5, 4, 'Truffle Fries', 280, 12, '/seed/fries.jpg', 'veg', 'Skin-on fries, truffle oil, parmesan and chives.', 'Bestseller,Share', 0, 1, 'Potato, Truffle oil, Parmesan'],
    [21, 5, 4, 'Peri Peri Fries', 260, 12, '/seed/fries.jpg', 'vegan', 'Crisp fries tossed in our house peri peri blend.', 'Spicy,Share', 0, 0, 'Potato, Spices'],
    [22, 5, 4, 'Stuffed Mushrooms', 320, 15, '/seed/salad.jpg', 'veg', 'Button mushrooms filled with herbed cream cheese, baked.', 'Share', 0, 0, 'Mushroom, Cream cheese, Herbs'],
    [23, 5, 4, 'Chicken Wings', 380, 18, '/seed/fries.jpg', 'non_veg', 'Six wings, sticky chilli-honey glaze, cooling ranch.', 'Spicy,Share', 0, 0, 'Chicken, Chilli, Honey'],
    [24, 6, 4, 'Avocado Toast', 340, 10, '/seed/avocado-toast.jpg', 'vegan', 'Sourdough, smashed avocado, chilli oil and lemon. Add an egg if you like.', 'Bestseller,Breakfast', 0, 1, 'Sourdough, Avocado, Chilli oil, Lemon'],
    [25, 6, 4, 'Grilled Cheese', 280, 9, '/seed/sandwich.jpg', 'veg', 'Three cheeses, caramelised onion and mustard on milk bread.', 'Comfort', 0, 0, 'Bread, Cheese, Butter'],
    [26, 6, 4, 'Chicken Club', 380, 12, '/seed/sandwich.jpg', 'non_veg', 'Roast chicken, bacon, tomato, lettuce and aioli.', 'Bestseller', 0, 0, 'Chicken, Bacon, Bread, Tomato'],
    [27, 6, 4, 'Paneer Tikka Wrap', 320, 12, '/seed/sandwich.jpg', 'veg', 'Charred paneer, mint chutney, onion and peppers in a warm wrap.', 'Spicy', 0, 0, 'Paneer, Wrap, Mint, Onion'],
    [28, 7, 3, 'Margherita Pizza', 420, 18, '/seed/pizza.jpg', 'veg', 'San Marzano tomato, fior di latte, basil. Wood-fired.', 'Bestseller', 0, 1, 'Flour, Tomato, Mozzarella, Basil'],
    [29, 7, 3, 'Penne Alfredo', 380, 16, '/seed/pasta.jpg', 'veg', 'Penne in a slow cream sauce with parmesan and cracked pepper.', 'Comfort', 0, 0, 'Pasta, Cream, Parmesan'],
    [30, 7, 3, 'Spaghetti Aglio e Olio', 360, 15, '/seed/pasta.jpg', 'vegan', 'Garlic, chilli, parsley and good olive oil. Nothing else needed.', 'Classic', 0, 0, 'Spaghetti, Garlic, Olive oil, Chilli'],
    [31, 7, 3, 'Smash Burger', 420, 15, '/seed/burger.jpg', 'non_veg', 'Double smashed patty, cheese, pickles and house sauce.', 'Bestseller', 0, 1, 'Beef, Bun, Cheese, Pickles'],
    [32, 8, 2, 'New York Cheesecake', 320, 5, '/seed/cheesecake.jpg', 'veg', 'Dense baked cheesecake with a buttery biscuit base.', 'Bestseller', 0, 1, 'Cream cheese, Sugar, Biscuit, Butter'],
    [33, 8, 2, 'Chocolate Brownie', 260, 6, '/seed/brownie.jpg', 'veg', 'Fudgy centre, crackled top. Served warm.', 'Special', 1, 0, 'Dark chocolate, Butter, Flour, Sugar'],
    [34, 8, 2, 'Butter Croissant', 180, 4, '/seed/croissant.jpg', 'veg', 'Laminated over three days. Shatteringly crisp.', 'Breakfast', 0, 0, 'Flour, Butter'],
    [35, 8, 2, 'Blueberry Pancakes', 300, 10, '/seed/pancakes.jpg', 'veg', 'Three fluffy pancakes, blueberry compote and maple.', 'Breakfast', 0, 0, 'Flour, Milk, Blueberry, Maple'],
    [36, 8, 2, 'Chocolate Chip Cookie', 120, 3, '/seed/cookies.jpg', 'veg', 'Brown butter, dark chocolate, flaky salt.', 'Bake', 0, 0, 'Flour, Butter, Dark chocolate'],
    [37, 9, 3, 'Shakshuka & Sourdough', 380, 14, '/seed/avocado-toast.jpg', 'veg', 'Eggs baked in spiced tomato with grilled sourdough.', 'Breakfast,Special', 1, 0, 'Eggs, Tomato, Sourdough, Spices'],
    [38, 9, 3, 'Soup of the Day', 240, 8, '/seed/soup.jpg', 'vegan', 'Ask your server — always made with the day’s market vegetables.', 'Light', 0, 0, 'Seasonal vegetables'],
    [39, 9, 3, 'Caesar Salad', 340, 8, '/seed/salad.jpg', 'veg', 'Cos lettuce, parmesan, sourdough croutons and Caesar dressing.', 'Light', 0, 0, 'Lettuce, Parmesan, Sourdough, Egg'],
  ];
  for (const it of items) {
    stmts.push(
      db.prepare(
        `INSERT INTO menu_items (id,category_id,station_id,name,description,price,prep_time,image_url,available,dietary,tags,ingredients_text,is_special,is_recommended,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`
      ).bind(it[0], it[1], it[2], it[3], it[8], it[4], it[5], it[6], it[7], it[9], it[12], it[10], it[11], nowIso, nowIso)
    );
  }

  // ---- Menu option groups --------------------------------------------------
  let groupId = 1;
  let optionId = 1;
  const addOptionGroup = (itemId, name, type, required, max, options) => {
    const gid = groupId++;
    stmts.push(
      db.prepare('INSERT INTO menu_option_groups (id,menu_item_id,name,selection_type,required,max_select,sort_order) VALUES (?,?,?,?,?,?,?)').bind(
        gid, itemId, name, type, required, max, gid
      )
    );
    options.forEach((o, idx) => {
      stmts.push(
        db.prepare('INSERT INTO menu_options (id,group_id,name,price_delta,is_default,available,sort_order) VALUES (?,?,?,?,?,1,?)').bind(
          optionId++, gid, o[0], o[1], idx === 0 ? 1 : 0, idx
        )
      );
    });
  };
  const drinkItems = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  for (const id of drinkItems) {
    addOptionGroup(id, 'Size', 'single', 1, 1, [['Regular', 0], ['Large', 50]]);
    addOptionGroup(id, 'Milk', 'single', 0, 1, [['Whole milk', 0], ['Oat milk', 30], ['Almond milk', 30], ['Skim milk', 0]]);
    addOptionGroup(id, 'Sweetness', 'single', 0, 1, [['Regular sugar', 0], ['Less sugar', 0], ['No sugar', 0]]);
  }
  for (const id of [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 37, 39]) {
    addOptionGroup(id, 'Add-ons', 'multi', 0, 3, [['Extra cheese', 40], ['Extra dip', 30], ['Add avocado', 60]]);
    addOptionGroup(id, 'Spice level', 'single', 0, 1, [['Mild', 0], ['Medium', 0], ['Hot', 0]]);
  }
  for (const id of [32, 33, 34, 35, 36]) {
    addOptionGroup(id, 'Serve', 'single', 0, 1, [['As it is', 0], ['Warm it up', 0], ['With ice cream', 60]]);
  }

  // ---- Suppliers / ingredients --------------------------------------------
  const suppliers = [
    [1, 'Karnataka Coffee Collective', 'Ramesh Gowda', '+91 80 2233 4455', 'orders@kccoffee.in', 'Chikmagalur, Karnataka', 1],
    [2, 'Fresh Dairy Co.', 'Lata Menon', '+91 80 4455 6677', 'supply@freshdairy.in', 'Yeshwanthpur, Bengaluru', 1],
    [3, 'Green Basket Produce', 'Imran Ali', '+91 80 7788 9900', 'hello@greenbasket.in', 'KR Market, Bengaluru', 1],
    [4, 'Bake & Co. Supplies', 'Susan Thomas', '+91 80 1122 3344', 'sales@bakeandco.in', 'Indiranagar, Bengaluru', 1],
  ];
  for (const s of suppliers) {
    stmts.push(
      db.prepare('INSERT INTO suppliers (id,name,contact_name,phone,email,address,active) VALUES (?,?,?,?,?,?,?)').bind(...s)
    );
  }

  const ingredients = [
    [1, 'Coffee beans', 'Beverage', 'g', 4200, 1000, 0.9, 1],
    [2, 'Milk', 'Dairy', 'ml', 3800, 6000, 0.07, 2],
    [3, 'Oat milk', 'Dairy', 'ml', 2400, 2000, 0.16, 2],
    [4, 'Sugar', 'Pantry', 'g', 5200, 1500, 0.05, 3],
    [5, 'Dark chocolate', 'Pantry', 'g', 900, 800, 0.65, 4],
    [6, 'Tea leaves', 'Beverage', 'g', 700, 400, 0.8, 1],
    [7, 'Matcha powder', 'Beverage', 'g', 180, 300, 4.5, 1],
    [8, 'Flour', 'Bakery', 'g', 7000, 2500, 0.06, 4],
    [9, 'Butter', 'Dairy', 'g', 1500, 1200, 0.55, 2],
    [10, 'Cream cheese', 'Dairy', 'g', 1100, 900, 0.5, 2],
    [11, 'Parmesan', 'Dairy', 'g', 500, 600, 1.2, 2],
    [12, 'Mozzarella', 'Dairy', 'g', 1300, 1000, 0.75, 2],
    [13, 'Tomato', 'Produce', 'g', 3200, 1500, 0.08, 3],
    [14, 'Avocado', 'Produce', 'pc', 14, 12, 45, 3],
    [15, 'Sourdough loaf', 'Bakery', 'pc', 6, 8, 120, 4],
    [16, 'Potato', 'Produce', 'g', 4500, 3000, 0.04, 3],
    [17, 'Pasta', 'Pantry', 'g', 2100, 1200, 0.12, 4],
    [18, 'Cream', 'Dairy', 'ml', 800, 900, 0.22, 2],
    [19, 'Chicken', 'Meat', 'g', 1800, 1500, 0.35, 3],
    [20, 'Beef patty', 'Meat', 'pc', 18, 15, 85, 3],
    [21, 'Burger bun', 'Bakery', 'pc', 20, 16, 18, 4],
    [22, 'Eggs', 'Dairy', 'pc', 38, 24, 9, 3],
    [23, 'Spinach', 'Produce', 'g', 600, 500, 0.12, 3],
    [24, 'Banana', 'Produce', 'pc', 22, 18, 8, 3],
    [25, 'Berries', 'Produce', 'g', 900, 700, 0.4, 3],
    [26, 'Mango', 'Produce', 'pc', 9, 10, 60, 3],
    [27, 'Coconut milk', 'Dairy', 'ml', 1400, 800, 0.18, 2],
    [28, 'Peanut butter', 'Pantry', 'g', 700, 400, 0.4, 4],
    [29, 'Lemon', 'Produce', 'pc', 30, 20, 6, 3],
    [30, 'Vanilla essence', 'Pantry', 'ml', 160, 100, 1.5, 4],
  ];
  for (const i of ingredients) {
    stmts.push(
      db.prepare('INSERT INTO ingredients (id,name,category,unit,stock_qty,min_stock,cost_per_unit,supplier_id,active) VALUES (?,?,?,?,?,?,?,?,1)').bind(...i)
    );
  }

  const recipes = [
    [1, 1, 18, 'g'], [2, 1, 18, 'g'], [2, 2, 150, 'ml'], [3, 1, 18, 'g'], [3, 2, 220, 'ml'],
    [4, 1, 18, 'g'], [4, 2, 180, 'ml'], [4, 5, 20, 'g'], [5, 1, 30, 'g'], [6, 1, 18, 'g'],
    [6, 2, 180, 'ml'], [7, 7, 4, 'g'], [7, 2, 200, 'ml'], [8, 1, 15, 'g'], [8, 2, 100, 'ml'], [8, 4, 8, 'g'],
    [9, 6, 5, 'g'], [9, 2, 120, 'ml'], [9, 4, 8, 'g'], [10, 6, 4, 'g'],
    [13, 5, 25, 'g'], [13, 2, 180, 'ml'], [14, 1, 18, 'g'],
    [16, 25, 120, 'g'], [16, 24, 1, 'pc'], [16, 27, 100, 'ml'], [17, 26, 1, 'pc'], [17, 2, 100, 'ml'],
    [18, 23, 80, 'g'], [19, 28, 40, 'g'], [19, 2, 150, 'ml'], [19, 24, 1, 'pc'],
    [20, 16, 220, 'g'], [20, 11, 15, 'g'], [21, 16, 220, 'g'],
    [22, 10, 60, 'g'], [23, 19, 200, 'g'], [24, 15, 1, 'pc'], [24, 14, 1, 'pc'],
    [25, 15, 1, 'pc'], [25, 12, 50, 'g'], [26, 19, 150, 'g'], [26, 15, 1, 'pc'],
    [27, 15, 1, 'pc'], [27, 11, 30, 'g'], [28, 8, 180, 'g'], [28, 13, 120, 'g'], [28, 12, 90, 'g'],
    [29, 17, 120, 'g'], [29, 18, 80, 'ml'], [29, 11, 20, 'g'],
    [30, 17, 120, 'g'],
    [31, 20, 2, 'pc'], [31, 21, 1, 'pc'], [31, 12, 20, 'g'],
    [32, 10, 90, 'g'], [32, 4, 30, 'g'], [32, 9, 30, 'g'],
    [33, 5, 60, 'g'], [33, 9, 40, 'g'], [33, 8, 50, 'g'], [33, 4, 40, 'g'],
    [34, 8, 90, 'g'], [34, 9, 45, 'g'], [35, 8, 120, 'g'], [35, 2, 150, 'ml'], [35, 25, 80, 'g'],
    [36, 8, 60, 'g'], [36, 9, 40, 'g'], [36, 5, 40, 'g'], [37, 22, 2, 'pc'], [37, 13, 150, 'g'],
    [38, 13, 200, 'g'], [38, 16, 100, 'g'], [39, 23, 120, 'g'], [39, 11, 20, 'g'], [39, 15, 1, 'pc'],
  ];
  recipes.forEach((r, idx) => {
    stmts.push(
      db.prepare('INSERT INTO recipes (id,menu_item_id,ingredient_id,quantity,unit) VALUES (?,?,?,?,?)').bind(idx + 1, r[0], r[1], r[2], r[3])
    );
  });

  // Purchases + movements
  let movementId = 1;
  for (let p = 1; p <= 6; p++) {
    const date = addDays(today, -p * 6);
    const supplierId = ((p - 1) % 4) + 1;
    stmts.push(
      db.prepare('INSERT INTO purchase_records (id,reference,supplier_id,purchase_date,total,status,notes,created_by) VALUES (?,?,?,?,?,?,?,2)').bind(
        p, `PO-${2000 + p}`, supplierId, date, 0, 'received', 'Weekly restock'
      )
    );
    const picks = [1, 2, 5, 8, 9, 12, 13, 16, 17, 19];
    for (let k = 0; k < 4; k++) {
      const ing = ingredients[picks[(p * 3 + k) % picks.length]];
      const qty = ing[3] === 'pc' ? randInt(10, 40) : randInt(1000, 5000);
      const unitCost = ing[6];
      const line = money(qty * unitCost);
      stmts.push(
        db.prepare('INSERT INTO purchase_items (purchase_id,ingredient_id,qty,unit_cost,line_total) VALUES (?,?,?,?,?)').bind(p, ing[0], qty, unitCost, line)
      );
      stmts.push(
        db.prepare('UPDATE purchase_records SET total = total + ? WHERE id = ?').bind(line, p)
      );
      stmts.push(
        db.prepare('INSERT INTO inventory_movements (id,ingredient_id,type,qty_change,unit_cost,reference_type,reference_id,note,created_by_type,created_by_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(
          movementId++, ing[0], 'purchase', qty, unitCost, 'purchase', p, `Restock PO-${2000 + p}`, 'staff', 2, `${date}T09:30:00.000Z`
        )
      );
    }
  }
  stmts.push(
    db.prepare("INSERT INTO inventory_movements (id,ingredient_id,type,qty_change,note,created_by_type,created_at) VALUES (?,2,'wastage',-250,'Milk spoilage — fridge check','staff',?)").bind(movementId++, new Date(Date.now() - 86400000).toISOString()),
    db.prepare("INSERT INTO inventory_movements (id,ingredient_id,type,qty_change,note,created_by_type,created_at) VALUES (?,14,'wastage',-2,'Overripe avocados','staff',?)").bind(movementId++, new Date(Date.now() - 172800000).toISOString())
  );

  // ---- Reservations --------------------------------------------------------
  let reservationId = 1;
  const guestFirst = ['Anil', 'Kavya', 'Tanvi', 'Siddharth', 'Maya', 'Dev', 'Riya', 'Nakul', 'Pooja', 'Vivek', 'Anika', 'Raghav'];
  const slots = ['12:00', '12:30', '13:00', '13:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
  const usedSlots = new Set();
  const nextSlot = (date, tableId) => {
    for (const s of slots) {
      const key = `${date}|${tableId}|${s}`;
      if (!usedSlots.has(key)) {
        usedSlots.add(key);
        return s;
      }
    }
    return null;
  };
  const addReservation = (date, tableId, status, customerId, guestName, phone, guests, special, source, timeOverride) => {
    const time = timeOverride || nextSlot(date, tableId);
    if (!time) return;
    stmts.push(
      db.prepare(
        `INSERT INTO reservations (id,reference,customer_id,guest_name,phone,email,reservation_date,reservation_time,party_size,table_id,status,special_requests,source,created_by_type,created_by_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        reservationId, `RSV-${String(4000 + reservationId)}`, customerId, guestName, phone,
        customerId ? customerSeeds.find((c) => c[0] === customerId)?.[2] || null : null,
        date, time, guests, tableId, status, special, source, 'staff', 1, nowIso, nowIso
      )
    );
    reservationId++;
  };
  // Past reservations
  for (let d = 30; d >= 1; d -= 2) {
    const date = addDays(today, -d);
    for (let k = 0; k < 2; k++) {
      const c = pick(customerSeeds);
      const tableId = randInt(1, 14);
      addReservation(date, tableId, pick(['completed', 'completed', 'no_show', 'cancelled']), c[0], c[1], c[3], randInt(2, 6), k ? 'Window seat if possible.' : '', 'online', null);
    }
  }
  // Upcoming reservations
  for (let d = 0; d <= 7; d++) {
    const date = addDays(today, d);
    const count = d === 0 ? 4 : randInt(2, 4);
    for (let k = 0; k < count; k++) {
      const c = pick(customerSeeds);
      const tableId = randInt(1, 14);
      const status = d === 0 ? pick(['confirmed', 'confirmed', 'pending']) : 'confirmed';
      addReservation(date, tableId, status, rng() > 0.25 ? c[0] : null, c[1], c[3], randInt(2, 6), pick(['', 'Anniversary — a small dessert plate would be lovely.', 'High chair needed.', 'Quiet corner please.', '']), rng() > 0.4 ? 'online' : 'management', null);
    }
  }

  // ---- Historical orders ---------------------------------------------------
  let orderId = 1;
  let orderItemId = 1;
  let paymentId = 1;
  let paymentEventId = 1;
  let loyaltyId = 1;
  let reviewId = 1;
  let historyId = 1;
  const methods = ['upi', 'card', 'cash', 'upi', 'card'];
  const guestNames = ['Aditi', 'Manav', 'Shreya', 'Rohit', 'Tara', 'Nikhil', 'Ira', 'Varun', 'Sara', 'Dhruv'];
  const activeOrderIds = [];

  const addOrder = (opts) => {
    const {
      placedAt, status, customerId, guestName, type, tableId, itemsSel, paymentStatus,
      reservationIdRef, notes, priority, source, createdAt,
    } = opts;
    const id = orderId++;
    const itemRows = itemsSel.map((mi) => {
      const item = items[mi - 1];
      const qty = randInt(1, 2);
      return { item, qty, unit: item[4], line: money(item[4] * qty), station: item[2] };
    });
    const subtotal = money(itemRows.reduce((s, r) => s + r.line, 0));
    const tax = money(subtotal * 0.05);
    const total = money(subtotal + tax);
    const eta = Math.max(...itemRows.map((r) => r.item[5])) + 5;
    const placed = placedAt;
    const statusTimes = {
      confirmed: new Date(new Date(placed).getTime() + 60000).toISOString(),
      prep_started_at: new Date(new Date(placed).getTime() + 120000).toISOString(),
      ready_at: new Date(new Date(placed).getTime() + Math.max(2, eta + Math.round(rand(-2, 7))) * 60000).toISOString(),
      collected_at: new Date(new Date(placed).getTime() + (eta + 3) * 60000).toISOString(),
      served_at: new Date(new Date(placed).getTime() + (eta + 8) * 60000).toISOString(),
      completed_at: new Date(new Date(placed).getTime() + (eta + 12) * 60000).toISOString(),
    };
    const st = status;
    stmts.push(
      db.prepare(
        `INSERT INTO orders (id,order_number,customer_id,reservation_id,table_id,type,status,payment_status,subtotal,tax_amount,service_charge,discount_amount,loyalty_discount,total,guest_name,guest_phone,notes,priority,eta_minutes,estimated_ready_at,validated,source,created_by_type,created_by_id,waiter_id,placed_at,confirmed_at,prep_started_at,ready_at,collected_at,served_at,completed_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,0,0,0,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, `ORD-${1000 + id}`, customerId, reservationIdRef || null, tableId || null, type, st, paymentStatus,
        subtotal, tax, total, guestName || null, opts.guestPhone || null, notes || null, priority || 'normal', eta,
        new Date(new Date(placed).getTime() + eta * 60000).toISOString(),
        source || 'customer', source === 'customer' ? 'customer' : 'staff', customerId || null, 5,
        placed, statusTimes.confirmed, statusTimes.prep_started_at, statusTimes.ready_at, statusTimes.collected_at, statusTimes.served_at, statusTimes.completed_at,
        createdAt || placed, createdAt || placed
      )
    );
    for (const r of itemRows) {
      let itemStatus = 'pending';
      if (st === 'completed' || st === 'served' || st === 'collected') itemStatus = 'served';
      else if (st === 'ready') itemStatus = 'ready';
      else if (st === 'preparing') itemStatus = rng() > 0.45 ? 'ready' : 'preparing';
      stmts.push(
        db.prepare(
          'INSERT INTO order_items (id,order_id,menu_item_id,station_id,name_snapshot,qty,unit_price,options_total,line_total,status,special_instructions,allergy_flag,assigned_staff_id,started_at,ready_at,served_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(
          orderItemId++, id, r.item[0], r.station, r.item[3], r.qty, r.unit, 0, r.line, itemStatus,
          rng() > 0.85 ? pick(['Less sugar', 'No onions', 'Extra hot', 'No ice']) : null,
          rng() > 0.93 ? 1 : 0,
          itemStatus === 'preparing' || itemStatus === 'ready' ? (r.station === 2 ? 4 : 3) : null,
          itemStatus !== 'pending' ? statusTimes.prep_started_at : null,
          itemStatus === 'ready' || itemStatus === 'served' ? statusTimes.ready_at : null,
          itemStatus === 'served' ? statusTimes.served_at : null,
          placed
        )
      );
    }
    if (st === 'completed' && statusTimes.prep_started_at) {
      const secs = Math.max(60, Math.round((new Date(statusTimes.ready_at) - new Date(statusTimes.prep_started_at)) / 1000));
      stmts.push(db.prepare('UPDATE orders SET actual_prep_seconds = ? WHERE id = ?').bind(secs, id));
    }
    // status history
    const chain = ['pending', 'confirmed', 'preparing', 'ready', 'collected', 'served', 'completed'];
    const upto = st === 'cancelled' ? 0 : chain.indexOf(st);
    if (upto >= 0) {
      for (let s = 0; s <= upto; s++) {
        stmts.push(
          db.prepare('INSERT INTO order_status_history (id,order_id,status,note,actor_type,actor_id,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(
            historyId++, id, chain[s], null, s === 0 ? 'customer' : 'staff', s === 0 ? customerId : 5, s === 0 ? 'Customer' : 'Rohan Das',
            new Date(new Date(placed).getTime() + s * 90000).toISOString()
          )
        );
      }
    }
    if (st === 'cancelled') {
      stmts.push(
        db.prepare('INSERT INTO order_status_history (id,order_id,status,note,actor_type,actor_id,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(
          historyId++, id, 'cancelled', 'Guest had to leave', 'staff', 2, 'Nisha Rao', placed
        )
      );
    }
    // payments
    if (['paid', 'refunded', 'partially_refunded'].includes(paymentStatus)) {
      const pstatus = paymentStatus === 'paid' ? 'paid' : paymentStatus;
      const refunded = paymentStatus === 'refunded' ? total : paymentStatus === 'partially_refunded' ? money(total / 2) : 0;
      stmts.push(
        db.prepare(
          'INSERT INTO payments (id,transaction_ref,order_id,customer_id,amount,refunded_amount,method,status,gateway_ref,notes,paid_at,created_by_type,created_by_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(
          paymentId, `TXN-${String(90000 + paymentId)}`, id, customerId || null, total, refunded, pick(methods), pstatus, null,
          pstatus === 'paid' ? 'Verified at counter' : 'Manual refund recorded', statusTimes.served_at || placed, 'staff', 5, statusTimes.served_at || placed
        )
      );
      paymentId++;
      if (refunded > 0) {
        stmts.push(
          db.prepare('INSERT INTO payment_events (id,payment_id,event_type,amount,note,actor_type,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(
            paymentEventId++, paymentId - 1, 'refund', refunded, paymentStatus === 'refunded' ? 'Full refund' : 'Partial refund', 'staff', 2, placed
          )
        );
      }
      if (st === 'completed' && customerId && paymentStatus === 'paid') {
        const pts = Math.floor(total / 100) * 5;
        if (pts > 0) {
          stmts.push(
            db.prepare('UPDATE customers SET loyalty_points = loyalty_points + ?, last_visit_at = ? WHERE id = ?').bind(pts, placed, customerId),
            db.prepare('INSERT INTO loyalty_transactions (id,customer_id,order_id,points,type,note,created_at) VALUES (?,?,?,?,?,?,?)').bind(
              loyaltyId++, customerId, id, pts, 'earn', `Earned on ORD-${1000 + id}`, placed
            )
          );
        }
      }
    }
    if (st === 'completed' && customerId && rng() > 0.72) {
      const overall = randInt(4, 5);
      stmts.push(
        db.prepare('INSERT INTO reviews (id,order_id,customer_id,food_rating,service_rating,overall_rating,comment,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(
          reviewId++, id, customerId, overall, overall, overall,
          pick(['Lovely as always — the cappuccino was perfect.', 'Great food, slightly slow service at peak hour.', 'The brownie is worth the trip.', 'Reliable neighbourhood spot.']),
          'approved', new Date(new Date(placed).getTime() + 86400000).toISOString()
        )
      );
    }
    return id;
  };

  for (let d = 45; d >= 1; d--) {
    const date = addDays(today, -d);
    const weekday = new Date(`${date}T12:00:00+05:30`).getUTCDay();
    const count = weekday === 0 || weekday === 6 ? randInt(8, 13) : randInt(5, 10);
    for (let k = 0; k < count; k++) {
      const hour = pick([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
      const minute = pick([0, 10, 15, 20, 30, 40, 45, 50]);
      const placedAt = istDateTimeISO(date, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
      const registered = rng() > 0.45;
      const cust = registered ? pick(customerSeeds) : null;
      const itemCount = randInt(1, 4);
      const selected = [];
      for (let q = 0; q < itemCount; q++) {
        const id = randInt(1, items.length);
        if (!selected.includes(id)) selected.push(id);
      }
      const cancelled = rng() > 0.97;
      const type = pick(['dine_in', 'dine_in', 'dine_in', 'takeaway', 'preorder']);
      addOrder({
        placedAt,
        status: cancelled ? 'cancelled' : 'completed',
        customerId: cust ? cust[0] : null,
        guestName: cust ? null : pick(guestNames),
        guestPhone: cust ? null : `+91 90000 ${randInt(10000, 99999)}`,
        type,
        tableId: type === 'dine_in' ? randInt(1, 14) : null,
        itemsSel: selected,
        paymentStatus: cancelled ? 'refunded' : rng() > 0.985 ? 'partially_refunded' : 'paid',
        priority: rng() > 0.9 ? 'high' : 'normal',
        source: rng() > 0.5 ? 'customer' : 'management',
      });
    }
    // Daily expense
    if (d % 3 === 0) {
      stmts.push(
        db.prepare('INSERT INTO expenses (category,description,amount,expense_date,is_estimated,vendor,created_by) VALUES (?,?,?,?,0,?,2)').bind(
          'Supplies', pick(['Fresh produce run', 'Dairy restock', 'Packaging supplies']), money(rand(400, 1800)), date, 'Green Basket Produce'
        )
      );
    }
  }

  // Monthly fixed expenses
  for (const d of [today, addDays(today, -30)]) {
    const month = d.slice(0, 7);
    stmts.push(
      db.prepare("INSERT INTO expenses (category,description,amount,expense_date,is_estimated,vendor,created_by) VALUES ('Rent','Monthly rent',185000,?,0,'Lavelle Estates',1)").bind(`${month}-01`),
      db.prepare("INSERT INTO expenses (category,description,amount,expense_date,is_estimated,vendor,created_by) VALUES ('Salaries','Kitchen and floor salaries',240000,?,0,'Payroll',1)").bind(`${month}-01`),
      db.prepare("INSERT INTO expenses (category,description,amount,expense_date,is_estimated,vendor,created_by) VALUES ('Utilities','Electricity, water and internet',28500,?,1,'Estimate',1)").bind(`${month}-05`)
    );
  }

  // ---- Today's live orders -------------------------------------------------
  const liveTimes = [95, 80, 62, 48, 35, 24, 16, 9, 4, 2];
  const liveStatuses = ['preparing', 'confirmed', 'pending', 'ready', 'pending', 'preparing', 'served', 'confirmed', 'collected', 'pending'];
  const liveTypes = ['dine_in', 'dine_in', 'takeaway', 'dine_in', 'preorder', 'dine_in', 'dine_in', 'dine_in', 'dine_in', 'takeaway'];
  const liveTable = [9, 3, null, 7, null, 10, 2, 5, 12, null];
  const livePayment = ['paid', 'pending', 'pending', 'paid', 'pending', 'paid', 'paid', 'pending', 'paid', 'pending'];
  liveStatuses.forEach((status, idx) => {
    const placedAt = new Date(Date.now() - liveTimes[idx] * 60000).toISOString();
    const cust = customerSeeds[idx % customerSeeds.length];
    const selected = [pick([1, 2, 3, 4, 5, 6, 7, 8, 9]), pick([20, 21, 24, 25, 26, 27, 28, 29, 31, 32, 33])].filter((v, i, a) => a.indexOf(v) === i);
    const id = addOrder({
      placedAt,
      status,
      customerId: idx % 3 === 0 ? cust[0] : null,
      guestName: idx % 3 === 0 ? null : pick(guestNames),
      guestPhone: `+91 90000 ${randInt(10000, 99999)}`,
      type: liveTypes[idx],
      tableId: liveTable[idx],
      itemsSel: selected,
      paymentStatus: livePayment[idx],
      notes: idx === 4 ? 'Birthday — please bring the brownie with a candle.' : '',
      priority: idx < 2 ? 'high' : 'normal',
      source: 'customer',
    });
    if (['pending', 'confirmed', 'preparing', 'ready', 'collected', 'served'].includes(status)) activeOrderIds.push(id);
  });
  // One cancelled live order
  addOrder({
    placedAt: new Date(Date.now() - 40 * 60000).toISOString(),
    status: 'cancelled',
    customerId: 3,
    type: 'dine_in',
    tableId: 6,
    itemsSel: [31, 20],
    paymentStatus: 'refunded',
    notes: 'Guest cancelled after ordering.',
    source: 'customer',
  });
  // One on-hold order
  const holdId = addOrder({
    placedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    status: 'on_hold',
    customerId: null,
    guestName: 'Walk-in',
    type: 'takeaway',
    tableId: null,
    itemsSel: [23, 21],
    paymentStatus: 'pending',
    priority: 'high',
    source: 'management',
  });
  stmts.push(db.prepare('UPDATE orders SET hold_reason = ? WHERE id = ?').bind('Waiting on chicken wings stock confirmation', holdId));

  // Table statuses for live service
  stmts.push(
    db.prepare("UPDATE cafe_tables SET status='occupied' WHERE id IN (2,7,9,10,12)"),
    db.prepare("UPDATE cafe_tables SET status='reserved' WHERE id IN (3,5)"),
    db.prepare("UPDATE cafe_tables SET status='cleaning' WHERE id=14")
  );

  // ---- Availability report + notifications ---------------------------------
  stmts.push(
    db.prepare("INSERT INTO availability_reports (menu_item_id,station_id,reason,kind,status,reported_by,reported_by_name) VALUES (39,3,'Cos lettuce running low — two portions left','ingredient_shortage','open',3,'Kabir Shah')")
  );
  stmts.push(
    db.prepare("INSERT INTO notifications (audience,type,title,body,link) VALUES ('staff','inventory','Milk below minimum stock','Only 3.8 L remaining against a 6 L minimum.','/admin/inventory')"),
    db.prepare("INSERT INTO notifications (audience,type,title,body,link) VALUES ('kitchen','order','New pre-order received','A pre-order is waiting to be accepted.','/kitchen')"),
    db.prepare("INSERT INTO notifications (audience,type,title,body,link) VALUES ('staff','review','New 5★ review','A guest left feedback on a recent order.','/admin/analytics')")
  );

  // ---- Audit trail ---------------------------------------------------------
  stmts.push(
    db.prepare("INSERT INTO audit_logs (actor_type,actor_id,actor_name,action,entity,entity_id,meta,created_at) VALUES ('staff',1,'Aarav Mehta','seed_database','system','1','Initial demo data generated',?)").bind(nowIso)
  );

  await runBatches(db, stmts, 35);
  await db.prepare("INSERT OR REPLACE INTO settings_flags (key,value) VALUES ('seed_version','1')").run();
}
