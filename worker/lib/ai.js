// Hybrid assistant: database facts first, optional Workers AI narration. AI never invents numbers.
import { money } from './utils.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

function fmt(n) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(n) || 0);
}
function inr(n) {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;
}
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), ms))]);
}

async function staffFacts(env) {
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const q = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).first()) || {};
  const range = async (days, sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;
  const [todayRevenue, weekRevenue, monthRevenue, activeOrders, pendingOrders, todayReservations, aov, lowStock, repeat, topItems, expenses30, reservationsWeek] =
    await Promise.all([
      q("SELECT COALESCE(SUM(amount - refunded_amount),0) AS v FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND date(paid_at) = ?", today),
      q("SELECT COALESCE(SUM(amount - refunded_amount),0) AS v FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at >= datetime('now','-7 days')"),
      q("SELECT COALESCE(SUM(amount - refunded_amount),0) AS v FROM payments WHERE status IN ('paid','partially_refunded','refunded') AND paid_at >= datetime('now','-30 days')"),
      q("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending','confirmed','preparing','ready','collected','on_hold')"),
      q("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
      q("SELECT COUNT(*) AS n FROM reservations WHERE reservation_date = ? AND status IN ('pending','confirmed')", today),
      q("SELECT COALESCE(AVG(total),0) AS v FROM orders WHERE status = 'completed' AND placed_at >= datetime('now','-30 days')"),
      range(8, "SELECT name, stock_qty, min_stock, unit FROM ingredients WHERE stock_qty <= min_stock ORDER BY (stock_qty - min_stock) ASC LIMIT 8"),
      q("SELECT COUNT(*) AS n FROM (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL AND status = 'completed' GROUP BY customer_id HAVING COUNT(*) > 1)"),
      range(6, `SELECT oi.name_snapshot AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
                 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE o.status = 'completed' AND o.placed_at >= datetime('now','-30 days')
                GROUP BY oi.name_snapshot ORDER BY qty DESC LIMIT 6`),
      q("SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE expense_date >= date('now','-30 days')"),
      q("SELECT COUNT(*) AS n FROM reservations WHERE reservation_date BETWEEN date('now') AND date('now','+7 days') AND status IN ('pending','confirmed')"),
    ]);

  const distinctCustomers = await q("SELECT COUNT(DISTINCT customer_id) AS n FROM orders WHERE customer_id IS NOT NULL AND status = 'completed'");
  return {
    date: today,
    revenue: { today: money(todayRevenue.v), last_7_days: money(weekRevenue.v), last_30_days: money(monthRevenue.v) },
    orders: { active: activeOrders.n, awaiting_kitchen: pendingOrders.n },
    reservations: { today: todayReservations.n, next_7_days: reservationsWeek.n },
    average_order_value_30d: money(aov.v),
    expenses_30d: money(expenses30.v),
    low_stock: lowStock.map((i) => ({ item: i.name, remaining: `${i.stock_qty}${i.unit}`, minimum: `${i.min_stock}${i.unit}` })),
    repeat_customers: repeat.n,
    known_customers: distinctCustomers.n,
    top_selling_items_30d: topItems.map((i) => ({ item: i.name, sold: i.qty, revenue: money(i.revenue) })),
  };
}

function ruleAnswer(q, f) {
  const text = q.toLowerCase();
  const lines = [];
  if (/(revenue|sales|earn|turnover|income)/.test(text)) {
    lines.push(`Recorded revenue today is **${inr(f.revenue.today)}**, **${inr(f.revenue.last_7_days)}** over the last 7 days and **${inr(f.revenue.last_30_days)}** over the last 30 days.`);
    lines.push(`Average order value over 30 days is **${inr(f.average_order_value_30d)}**. Recorded expenses for the same window are **${inr(f.expenses_30d)}**.`);
  } else if (/(best|top|selling|popular|bestsell)/.test(text)) {
    if (!f.top_selling_items_30d.length) lines.push('There are no completed orders in the last 30 days yet.');
    else {
      lines.push('Top sellers over the last 30 days:');
      f.top_selling_items_30d.forEach((i, idx) => lines.push(`${idx + 1}. **${i.item}** — ${i.sold} sold, ${inr(i.revenue)} revenue`));
    }
  } else if (/(active|pending|in progress|queue|kitchen)/.test(text)) {
    lines.push(`There are **${f.orders.active} active orders** right now, of which **${f.orders.awaiting_kitchen}** are still awaiting kitchen acceptance.`);
    lines.push(`Today has **${f.reservations.today} reservations**; **${f.reservations.next_7_days}** are booked over the next 7 days.`);
  } else if (/(low|stock|inventory|ingredient|reorder)/.test(text)) {
    if (!f.low_stock.length) lines.push('No ingredients are currently below their minimum stock level.');
    else {
      lines.push('Ingredients at or below their minimum stock:');
      f.low_stock.forEach((i) => lines.push(`• **${i.item}** — ${i.remaining} left (minimum ${i.minimum})`));
    }
  } else if (/(repeat|loyal|returning|retention)/.test(text)) {
    lines.push(`**${f.repeat_customers} customers** have completed more than one order, out of **${f.known_customers}** customers with completed orders.`);
    lines.push('Repeat rate is calculated from actual completed orders in D1.');
  } else if (/(reservation|booking|table)/.test(text)) {
    lines.push(`Today has **${f.reservations.today} active reservations**. **${f.reservations.next_7_days}** reservations are scheduled over the next seven days.`);
  } else if (/(expense|profit|margin|cost)/.test(text)) {
    lines.push(`Recorded revenue (30 days) is **${inr(f.revenue.last_30_days)}** against **${inr(f.expenses_30d)}** of recorded expenses.`);
    lines.push('This is a cash view only, not an audited profit statement. Estimated and actual expenses are separated in Revenue & Finance.');
  } else {
    lines.push(`Here is the live picture for **${f.date}**:`);
    lines.push(`• Revenue today: **${inr(f.revenue.today)}** · 7-day: **${inr(f.revenue.last_7_days)}** · 30-day: **${inr(f.revenue.last_30_days)}**`);
    lines.push(`• Active orders: **${f.orders.active}** (${f.orders.awaiting_kitchen} awaiting kitchen)`);
    lines.push(`• Reservations today: **${f.reservations.today}**`);
    lines.push(`• Average order value: **${inr(f.average_order_value_30d)}**`);
    if (f.low_stock.length) lines.push(`• Low stock: ${f.low_stock.map((i) => i.item).join(', ')}`);
    if (f.top_selling_items_30d.length) lines.push(`• Best seller: **${f.top_selling_items_30d[0].item}** (${f.top_selling_items_30d[0].sold} sold)`);
    lines.push('Ask me about revenue, best sellers, active orders, low stock or repeat customers.');
  }
  return lines.join('\n');
}

export async function staffAssistant(env, question) {
  const facts = await staffFacts(env);
  const base = ruleAnswer(question, facts);
  const settings = await env.DB.prepare('SELECT ai_enabled FROM cafe_settings WHERE id = 1').first();
  if (!settings?.ai_enabled || !env.AI) {
    return { answer: base, mode: 'rules', facts, note: env.AI ? 'AI is disabled in settings. Answers come from live database queries.' : 'Cloudflare Workers AI is not available in this environment. Answers come from live database queries.' };
  }
  try {
    const result = await withTimeout(
      env.AI.run(MODEL, {
        messages: [
          {
            role: 'system',
            content:
              'You are the operations analyst for Brewhaus Coffee & Kitchen. Answer ONLY using the JSON facts supplied. Never invent or estimate a business number. Amounts are Indian Rupees. Be concise, specific and use bullet points where helpful. Clearly separate facts (from the JSON) from any suggestion (label it "Suggested next step"). Never claim a payment succeeded or an order exists unless the facts say so.',
          },
          { role: 'user', content: `Question: ${question}\n\nLive database facts (JSON):\n${JSON.stringify(facts)}` },
        ],
        max_tokens: 420,
        temperature: 0.2,
      }),
      12000
    );
    const answer = typeof result === 'string' ? result : result?.response;
    if (!answer || !String(answer).trim()) throw new Error('Empty AI response');
    return { answer: String(answer).trim(), mode: 'ai', facts, note: 'Narrated by Cloudflare Workers AI from the database facts above. Verify critical figures in the dashboard.' };
  } catch (err) {
    return { answer: base, mode: 'rules', facts, note: `Workers AI was unavailable (${String(err.message || err)}). Answers come from live database queries.` };
  }
}

async function menuData(env) {
  const items = await env.DB.prepare(
    `SELECT mi.id, mi.name, mi.description, mi.price, mi.dietary, mi.tags, mi.ingredients_text, mi.image_url,
            mi.prep_time, mi.is_recommended, mi.is_special, mc.name AS category
       FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.available = 1 ORDER BY mc.sort_order, mi.name`
  ).all();
  return items.results;
}

function scoreItem(item, terms) {
  const hay = `${item.name} ${item.description} ${item.tags} ${item.ingredients_text} ${item.category}`.toLowerCase();
  return terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
}

export async function menuAssistant(env, question) {
  const items = await menuData(env);
  const text = String(question || '').toLowerCase();
  const allergy = /(allerg|nut|peanut|gluten|dairy|lactose|shellfish|soy)/.test(text);
  const vegan = /(vegan)/.test(text);
  const veg = /(vegetarian|\bveg\b)/.test(text);
  const terms = text.split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !['what', 'which', 'would', 'could', 'should', 'with', 'that', 'this', 'have', 'does', 'your', 'recommend', 'suggest', 'dishes', 'drink', 'food'].includes(w));

  let candidates = items;
  if (vegan) candidates = candidates.filter((i) => i.dietary === 'vegan');
  else if (veg) candidates = candidates.filter((i) => ['veg', 'vegan'].includes(i.dietary));
  const scored = candidates.map((i) => ({ ...i, score: scoreItem(i, terms) })).sort((a, b) => b.score - a.score);
  const matched = terms.length ? scored.filter((i) => i.score > 0).slice(0, 5) : [];
  const picks = (matched.length ? matched : scored.filter((i) => i.is_recommended || i.is_special).slice(0, 4)).slice(0, 5);

  let answer;
  if (!picks.length) {
    answer = 'I could not find a currently available menu item matching that. Nothing is being invented here — the live menu has no match. Try a different craving, or ask the team at the counter.';
  } else {
    answer = matched.length
      ? `From the live menu, these look closest to what you asked for:\n\n${picks.map((i) => `• **${i.name}** — ${inr(i.price)}, ${i.category}${i.dietary ? ` · ${i.dietary.replace('_', ' ')}` : ''}. ${i.description || ''}`).join('\n')}`
      : `A few things our guests enjoy right now:\n\n${picks.map((i) => `• **${i.name}** — ${inr(i.price)}, ${i.category}. ${i.description || ''}`).join('\n')}`;
  }
  if (allergy) {
    answer += '\n\n⚠️ **Allergy note:** ingredient lists here come from our menu records and may not capture cross-contact in the kitchen. Please confirm serious allergies directly with cafe staff before ordering.';
  }

  const settings = await env.DB.prepare('SELECT ai_enabled FROM cafe_settings WHERE id = 1').first();
  if (!settings?.ai_enabled || !env.AI) {
    return { answer, mode: 'rules', items: picks.map(publicItem), note: 'Recommendations come from the live menu database.', allergyWarning: allergy };
  }
  try {
    const menuContext = picks.length
      ? picks.map((i) => ({ name: i.name, price: i.price, category: i.category, dietary: i.dietary, description: i.description, ingredients: i.ingredients_text }))
      : items.slice(0, 12).map((i) => ({ name: i.name, price: i.price, category: i.category, dietary: i.dietary, description: i.description }));
    const result = await withTimeout(
      env.AI.run(MODEL, {
        messages: [
          {
            role: 'system',
            content:
              'You are the menu guide for Brewhaus Coffee & Kitchen in Bengaluru. Use ONLY the provided menu items and prices. Never invent dishes, ingredients, prices or availability. Answer in 2-4 short sentences plus a short bullet list. If the guest mentions an allergy, clearly tell them to confirm with cafe staff. Do not claim to have placed an order.',
          },
          { role: 'user', content: `Guest question: ${question}\n\nLive menu data:\n${JSON.stringify(menuContext)}` },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
      12000
    );
    const aiAnswer = typeof result === 'string' ? result : result?.response;
    if (!aiAnswer || !String(aiAnswer).trim()) throw new Error('Empty AI response');
    return {
      answer: `${String(aiAnswer).trim()}${allergy ? '\n\n⚠️ **Allergy note:** please confirm serious allergy requirements directly with cafe staff. Kitchen cross-contact is possible.' : ''}`,
      mode: 'ai',
      items: picks.map(publicItem),
      note: 'Narrated by Cloudflare Workers AI using live menu records.',
      allergyWarning: allergy,
    };
  } catch (err) {
    return { answer, mode: 'rules', items: picks.map(publicItem), note: `Workers AI was unavailable (${String(err.message || err)}). Recommendations come from the live menu database.`, allergyWarning: allergy };
  }
}

function publicItem(i) {
  return { id: i.id, name: i.name, price: i.price, image: i.image_url, category: i.category, dietary: i.dietary };
}

export { staffFacts };
