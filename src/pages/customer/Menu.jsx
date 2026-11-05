import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, UtensilsCrossed, X } from 'lucide-react';
import { qs } from '../../lib/api';
import { useFetch } from '../../lib/store';
import { EmptyState, ErrorState, Loading } from '../../components/ui';
import FoodCard from './FoodCard';

const DIETARY = [
  { key: '', label: 'Everything' },
  { key: 'veg', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'non_veg', label: 'Non-veg' },
  { key: 'egg', label: 'Contains egg' },
];
const SORTS = [
  ['recommended', 'Recommended'],
  ['popular', 'Most popular'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['name', 'Name A–Z'],
];

export default function Menu() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') || '';
  const dietary = params.get('dietary') || '';
  const sort = params.get('sort') || 'recommended';
  const q = params.get('q') || '';

  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);

  const path = `/public/menu${qs({ category, dietary, sort, q })}`;
  const { data, loading, error, reload } = useFetch(path);

  const categories = data?.categories || [];
  const items = data?.items || [];
  const activeCategory = categories.find((c) => c.slug === category);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const clearAll = () => setParams({});

  const activeFilters = [
    activeCategory ? { key: 'category', label: activeCategory.name } : null,
    dietary ? { key: 'dietary', label: DIETARY.find((d) => d.key === dietary)?.label || dietary } : null,
    q ? { key: 'q', label: `“${q}”` } : null,
  ].filter(Boolean);

  const totalItems = useMemo(() => categories.reduce((sum, c) => sum + Number(c.item_count || 0), 0), [categories]);

  return (
    <>
      <div className="cust-page-head">
        <div className="eyebrow" style={{ color: 'var(--copper)' }}>The menu</div>
        <h1>{activeCategory ? activeCategory.name : 'Coffee, kitchen & everything between'}</h1>
        <p>{activeCategory?.description || 'Every dish is prepared to order. Availability and prices update live — what you see is what the kitchen is serving.'}</p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); setParam('q', search.trim()); }}
        className="flex gap-8 wrap items-center"
        style={{ marginBottom: 14 }}
      >
        <label className="search" style={{ flex: '1 1 260px', maxWidth: 420, background: '#fff', border: '1px solid rgba(33,26,21,.14)', borderRadius: 30, height: 42, padding: '0 15px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dishes, ingredients, tags…" aria-label="Search the menu" style={{ fontSize: 13 }} />
          {search && <button type="button" onClick={() => { setSearch(''); setParam('q', ''); }} style={{ border: 0, background: 'transparent', color: '#91837a', display: 'grid' }}><X size={13} /></button>}
        </label>
        <select className="select" value={sort} onChange={(e) => setParam('sort', e.target.value === 'recommended' ? '' : e.target.value)} style={{ width: 190, height: 42, borderRadius: 30, background: '#fff', borderColor: 'rgba(33,26,21,.14)' }} aria-label="Sort menu">
          {SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span className="small" style={{ color: '#7b6d5f' }}>{items.length} of {totalItems} items</span>
      </form>

      <div className="chip-row" style={{ marginBottom: 10 }}>
        <button className={`chip ${!dietary ? 'active' : ''}`} onClick={() => setParam('dietary', '')}>Everything</button>
        {DIETARY.slice(1).map((d) => (
          <button key={d.key} className={`chip ${dietary === d.key ? 'active' : ''}`} onClick={() => setParam('dietary', dietary === d.key ? '' : d.key)}>{d.label}</button>
        ))}
        {activeFilters.length > 0 && <button className="chip" onClick={clearAll} style={{ borderStyle: 'dashed' }}><X size={11} /> Clear filters</button>}
      </div>

      <div className="menu-layout">
        <aside className="menu-filters" aria-label="Menu filters">
          <div className="filter-block">
            <h4>Categories</h4>
            <div className="filter-list">
              <button className={!category ? 'active' : ''} onClick={() => setParam('category', '')}>
                <span>All items</span><span className="n">{totalItems}</span>
              </button>
              {categories.map((c) => (
                <button key={c.id} className={category === c.slug ? 'active' : ''} onClick={() => setParam('category', c.slug)}>
                  <span>{c.name}</span><span className="n">{c.item_count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="filter-block">
            <h4>Dietary</h4>
            <div className="filter-list">
              {DIETARY.map((d) => (
                <button key={d.key || 'all'} className={dietary === d.key ? 'active' : ''} onClick={() => setParam('dietary', d.key)}>
                  <span>{d.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="filter-block">
            <h4>Good to know</h4>
            <p className="tiny" style={{ color: '#8b7c6c', lineHeight: 1.6 }}>
              All prices are in ₹ and include applicable taxes as configured by the cafe. Unavailable items are hidden automatically.
            </p>
          </div>
        </aside>

        <section>
          {activeFilters.length > 0 && (
            <div className="flex gap-8 wrap" style={{ marginBottom: 12 }}>
              <span className="tiny" style={{ color: '#8b7c6c', display: 'flex', alignItems: 'center', gap: 5 }}><SlidersHorizontal size={12} /> Filtered by</span>
              {activeFilters.map((f) => (
                <button key={f.key} className="chip" style={{ fontSize: 11 }} onClick={() => { if (f.key === 'q') { setSearch(''); setParam('q', ''); } else setParam(f.key, ''); }}>
                  {f.label} <X size={10} />
                </button>
              ))}
            </div>
          )}

          {loading && !data ? <Loading label="Loading the menu…" minHeight={320} /> : error ? <ErrorState error={error} onRetry={reload} /> : items.length ? (
            <div className="menu-grid">
              {items.map((item) => <FoodCard key={item.id} item={item} />)}
            </div>
          ) : (
            <div className="card" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
              <EmptyState
                icon={UtensilsCrossed}
                title="Nothing matches that yet"
                description="Try a different category, dietary filter or search term. The live menu only shows items available right now."
                action={<button className="btn btn-primary btn-sm" onClick={clearAll}>Clear all filters</button>}
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
