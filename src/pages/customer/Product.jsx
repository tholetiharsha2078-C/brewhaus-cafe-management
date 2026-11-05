import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Clock, Leaf, Minus, Plus, ShoppingBag,
  Sparkles, Star, UtensilsCrossed,
} from 'lucide-react';
import { useFetch, useToast, useCart } from '../../lib/store';
import { inr } from '../../lib/format';
import { ErrorState, Loading, Rating } from '../../components/ui';
import FoodCard from './FoodCard';

const DIET_LABEL = { veg: 'Vegetarian', vegan: 'Vegan', non_veg: 'Non-vegetarian', egg: 'Contains egg' };

function defaultsFor(groups) {
  const map = {};
  for (const group of groups || []) {
    const preselected = (group.options || []).filter((o) => o.isDefault).map((o) => o.id);
    if (preselected.length) map[group.id] = preselected;
    else if (group.selectionType === 'single' && group.options?.length) map[group.id] = [group.options[0].id];
    else map[group.id] = [];
  }
  return map;
}

export default function Product() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { add, count } = useCart();
  const { data, loading, error, reload } = useFetch(`/public/menu/${id}`);
  const [selection, setSelection] = useState({});
  const [qty, setQty] = useState(1);
  const [instructions, setInstructions] = useState('');
  const [allergy, setAllergy] = useState(false);

  const item = data?.item;
  const groups = item?.optionGroups || [];

  useEffect(() => {
    if (item) {
      setSelection(defaultsFor(item.optionGroups));
      setQty(1);
      setInstructions('');
      setAllergy(false);
    }
  }, [item?.id]);

  const chosenOptions = useMemo(() => {
    const picked = [];
    for (const group of groups) {
      const ids = selection[group.id] || [];
      for (const option of group.options || []) {
        if (ids.includes(option.id)) {
          picked.push({ id: option.id, group: group.name, name: option.name, price: Number(option.priceDelta) || 0 });
        }
      }
    }
    return picked;
  }, [groups, selection]);

  const extras = chosenOptions.reduce((sum, o) => sum + o.price, 0);
  const unitPrice = (Number(item?.price) || 0) + extras;
  const lineTotal = unitPrice * qty;
  const missing = groups.filter((g) => g.required && !(selection[g.id] || []).length);

  const toggleOption = (group, option) => {
    setSelection((prev) => {
      const current = prev[group.id] || [];
      if (group.selectionType === 'single') {
        if (current.includes(option.id)) {
          return group.required ? prev : { ...prev, [group.id]: [] };
        }
        return { ...prev, [group.id]: [option.id] };
      }
      if (current.includes(option.id)) {
        return { ...prev, [group.id]: current.filter((x) => x !== option.id) };
      }
      if (current.length >= (group.maxSelect || 99)) {
        toast.error(`${group.name}: choose up to ${group.maxSelect}.`);
        return prev;
      }
      return { ...prev, [group.id]: [...current, option.id] };
    });
  };

  const addToCart = () => {
    if (!item?.available) { toast.error('This item is currently unavailable.'); return; }
    if (missing.length) {
      toast.error(`Please choose ${missing.map((g) => g.name).join(', ')}.`);
      return;
    }
    const key = [
      item.id,
      chosenOptions.map((o) => o.id).sort((a, b) => a - b).join('-'),
      instructions.trim().toLowerCase(),
      allergy ? 'a' : 'n',
    ].join('|');
    add({
      key,
      id: item.id,
      name: item.name,
      price: unitPrice,
      image: item.image,
      qty: Math.max(1, Math.min(20, qty)),
      options: chosenOptions.map(({ id: optionId, group, name, price }) => ({ id: optionId, group, name, price })),
      instructions: instructions.trim().slice(0, 240),
      allergy,
    });
    toast.success(`${qty} × ${item.name} added to your cart`);
  };

  if (loading && !data) return <Loading label="Plating the details…" minHeight={460} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!item) {
    return (
      <div className="cust-page-head">
        <h1>Item not found</h1>
        <p>This dish may have been taken off the menu. <Link to="/menu" style={{ color: 'var(--copper)', fontWeight: 600 }}>Browse the live menu</Link>.</p>
      </div>
    );
  }

  const reviews = data?.reviews || [];
  const rating = data?.rating || { count: 0, average: 0 };
  const related = data?.related || [];

  return (
    <div style={{ paddingTop: 20 }}>
      <nav className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8b7c6c', flexWrap: 'wrap' }}>
        <Link to="/menu" style={{ color: 'inherit' }}>Menu</Link>
        <ChevronRight size={12} />
        {item.categorySlug ? (
          <>
            <Link to={`/menu?category=${item.categorySlug}`} style={{ color: 'inherit' }}>{item.category}</Link>
            <ChevronRight size={12} />
          </>
        ) : null}
        <span style={{ color: 'var(--espresso)' }}>{item.name}</span>
      </nav>

      <div className="product-layout">
        <div>
          <div className="product-gallery">
            {item.image ? (
              <img src={item.image} alt={item.name} />
            ) : (
              <div style={{ aspectRatio: 1.15, borderRadius: 22, background: '#eee6da', display: 'grid', placeItems: 'center', color: '#b8a894' }}>
                <UtensilsCrossed size={34} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            {item.isSpecial && <span className="chip" style={{ background: 'var(--espresso)', color: '#f8efe3', borderColor: 'var(--espresso)' }}><Sparkles size={11} /> Chef’s pick</span>}
            {item.dietary && <span className="chip"><Leaf size={11} /> {DIET_LABEL[item.dietary] || item.dietary}</span>}
            {item.prepTime ? <span className="chip"><Clock size={11} /> {item.prepTime} min</span> : null}
            {rating.count > 0 && <span className="chip"><Star size={11} /> {Number(rating.average).toFixed(1)} · {rating.count} review{rating.count === 1 ? '' : 's'}</span>}
            {item.sold > 0 && <span className="chip">{Number(item.sold).toLocaleString('en-IN')} ordered recently</span>}
          </div>

          {item.ingredientsText ? (
            <div className="card card-pad" style={{ marginTop: 22, background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>What’s in it</div>
              <p className="small" style={{ color: '#6f6153', lineHeight: 1.7, marginTop: 6 }}>{item.ingredientsText}</p>
              <div className="notice info" style={{ marginTop: 12 }}>
                <AlertTriangle size={15} />
                <span>Allergies? Tell us in the notes and the kitchen will be alerted on your ticket. We handle nuts, dairy, gluten and eggs in the same kitchen.</span>
              </div>
            </div>
          ) : null}

          {reviews.length > 0 && (
            <div className="card card-pad" style={{ marginTop: 18, background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
              <div className="between" style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 14 }}>Guest notes</strong>
                <Rating value={Number(rating.average) || 0} count={rating.count} size={13} />
              </div>
              {reviews.map((r, i) => (
                <div key={i} style={{ borderTop: i ? '1px solid rgba(33,26,21,.08)' : 0, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
                  <div className="between">
                    <span className="small strong">{r.first_name || 'A guest'}</span>
                    <Rating value={Number(r.overall_rating) || 0} size={11} />
                  </div>
                  {r.comment && <p className="small" style={{ color: '#6f6153', lineHeight: 1.65, marginTop: 4 }}>{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="product-info">
          <div className="eyebrow" style={{ color: 'var(--copper)' }}>{item.category || 'From the kitchen'}</div>
          <h1>{item.name}</h1>
          <p className="product-desc">{item.description || 'Prepared fresh to order.'}</p>
          <div className="product-price">
            {inr(unitPrice)}
            {extras > 0 && <span className="small muted" style={{ fontWeight: 400, marginLeft: 8 }}>incl. {inr(extras)} extras</span>}
          </div>

          {!item.available && (
            <div className="notice warn" style={{ marginBottom: 14 }}>
              <AlertTriangle size={15} />
              <span>This item is paused right now. It cannot be ordered until the cafe makes it available again.</span>
            </div>
          )}

          {groups.map((group) => {
            const ids = selection[group.id] || [];
            return (
              <div className="option-block" key={group.id}>
                <div className="option-title">
                  <h4>{group.name}{group.required ? <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span> : null}</h4>
                  <span>{group.selectionType === 'single' ? 'Choose one' : `Choose up to ${group.maxSelect || 99}`}{group.required ? ' · required' : ' · optional'}</span>
                </div>
                <div className="option-pills">
                  {group.options.map((option) => {
                    const active = ids.includes(option.id);
                    return (
                      <button
                        type="button"
                        key={option.id}
                        className={`option-pill ${active ? 'active' : ''}`}
                        onClick={() => toggleOption(group, option)}
                        aria-pressed={active}
                      >
                        {active ? <Check size={12} /> : null} {option.name}
                        {Number(option.priceDelta) > 0 && <span className="d">+{inr(option.priceDelta)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="option-block">
            <div className="option-title">
              <h4>Anything else?</h4>
              <span>{(instructions.length || 0)}/240</span>
            </div>
            <textarea
              className="textarea"
              rows={3}
              maxLength={240}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Less sugar, no onions, extra napkins…"
              style={{ background: '#fff' }}
            />
            <label className="flex items-center gap-8 small" style={{ marginTop: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={allergy} onChange={(e) => setAllergy(e.target.checked)} style={{ accentColor: 'var(--espresso)' }} />
              <span>This order has an allergy — alert the kitchen</span>
            </label>
          </div>

          <div className="product-actions">
            <div className="qty-stepper">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity"><Minus size={14} /></button>
              <span>{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="Increase quantity"><Plus size={14} /></button>
            </div>
            <button className="btn btn-primary" style={{ flex: 1, height: 46 }} onClick={addToCart} disabled={!item.available}>
              <ShoppingBag size={15} /> Add · {inr(lineTotal)}
            </button>
          </div>

          {missing.length > 0 && (
            <div className="tiny" style={{ color: 'var(--red)', marginTop: 8 }}>Choose {missing.map((g) => g.name).join(', ')} to continue.</div>
          )}

          <div className="flex gap-8 wrap" style={{ marginTop: 12 }}>
            <Link to="/menu" className="btn btn-ghost btn-sm"><ArrowLeft size={13} /> Back to menu</Link>
            {count > 0 && <Link to="/cart" className="btn btn-secondary btn-sm"><ShoppingBag size={13} /> View cart ({count})</Link>}
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>Goes well with</div>
              <h2 className="section-title">More from {item.category || 'the menu'}</h2>
            </div>
            <Link to={`/menu?category=${item.categorySlug || ''}`} className="section-link">See category <ChevronRight size={13} /></Link>
          </div>
          <div className="food-grid">
            {related.slice(0, 4).map((r) => <FoodCard key={r.id} item={r} />)}
          </div>
        </section>
      )}
    </div>
  );
}
