import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, Clock, Coffee, MapPin, Phone, Quote, Sparkles, Star, UtensilsCrossed,
} from 'lucide-react';
import { useFetch } from '../../lib/store';
import { fmtDate, inr } from '../../lib/format';
import { ErrorState, Loading, Rating } from '../../components/ui';
import FoodCard from './FoodCard';

export default function Home() {
  const { data, loading, error, reload } = useFetch('/public/home');

  if (loading && !data) return <Loading label="Brewing the home page…" minHeight={420} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const settings = data.settings || {};
  const categories = (data.categories || []).filter((c) => c.item_count > 0);
  const recommended = data.recommended || [];
  const popular = data.popular || [];
  const specials = data.specials || [];
  const newArrivals = data.newArrivals || [];
  const offers = data.offers || [];
  const reviews = data.reviews || [];
  const avgRating = reviews.length ? reviews.reduce((sum, r) => sum + Number(r.overall_rating), 0) / reviews.length : 0;
  const mapLink = settings.latitude && settings.longitude
    ? `https://www.google.com/maps/search/?api=1&query=${settings.latitude},${settings.longitude}`
    : null;

  const heroItems = specials.length ? specials : recommended;

  return (
    <>
      <section className="cust-hero">
        <img src="/seed/hero-cafe.jpg" alt="Brewhaus Coffee & Kitchen" />
        <div className="cust-hero-inner">
          <div className="eyebrow">Lavelle Road · Bengaluru</div>
          <h1>{settings.tagline || 'Slow mornings, honest food.'}</h1>
          <p>{settings.description || 'A neighbourhood coffee house and kitchen. Single-origin coffee, wood-fired plates and a quiet corner to linger in.'}</p>
          <div className="hero-cta">
            <Link className="btn btn-primary" to="/reserve"><CalendarDays size={15} /> Reserve a table</Link>
            <Link className="btn btn-outline-light" to="/menu"><UtensilsCrossed size={15} /> Explore the menu</Link>
          </div>
          <div className="hero-meta">
            <span><Clock size={13} /> {settings.opening_time || '08:00'} – {settings.closing_time || '23:00'} daily</span>
            <span><MapPin size={13} /> {settings.address || '18 Lavelle Road'}</span>
            {reviews.length > 0 && <span><Star size={13} fill="currentColor" /> {avgRating.toFixed(1)} · {reviews.length} guest review{reviews.length === 1 ? '' : 's'}</span>}
          </div>
        </div>
      </section>

      {categories.length > 0 && (
        <section className="section" aria-labelledby="categories-heading">
          <div className="section-head">
            <div>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>Browse</div>
              <h2 className="section-title" id="categories-heading">What are you in the mood for?</h2>
            </div>
            <Link to="/menu" className="section-link">Full menu <ArrowRight size={13} /></Link>
          </div>
          <div className="cat-row">
            {categories.slice(0, 9).map((c) => (
              <Link key={c.id} to={`/menu?category=${c.slug}`} className="cat-tile">
                {c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <div style={{ aspectRatio: 1, background: '#e9dcc7', borderRadius: 11, marginBottom: 9, display: 'grid', placeItems: 'center', color: 'var(--copper)' }}><Coffee size={18} /></div>}
                <div className="name">{c.name}</div>
                <div className="count">{c.item_count} item{c.item_count === 1 ? '' : 's'}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {heroItems.length > 0 && (
        <section className="section" aria-labelledby="recommended-heading">
          <div className="section-head">
            <div>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>From the kitchen</div>
              <h2 className="section-title" id="recommended-heading">{specials.length ? 'Chef’s picks today' : 'Recommended for you'}</h2>
              <p className="section-sub">Every price and availability is live from the cafe’s menu database.</p>
            </div>
            <Link to="/menu?sort=popular" className="section-link">Most loved <ArrowRight size={13} /></Link>
          </div>
          <div className="food-grid">
            {heroItems.slice(0, 4).map((item) => <FoodCard key={item.id} item={item} />)}
          </div>
        </section>
      )}

      {(offers.length > 0 || popular.length > 0) && (
        <section className="promo-band">
          {offers[0] ? (
            <div className="promo">
              <span className="code">{offers[0].code}</span>
              <h3>{offers[0].title}</h3>
              <p>{offers[0].description || (offers[0].discount_type === 'percent' ? `${offers[0].value}% off your order` : `${inr(offers[0].value)} off your order`)}{offers[0].min_order ? ` · minimum order ${inr(offers[0].min_order)}` : ''}</p>
              <Link to="/menu" className="btn btn-primary btn-sm" style={{ marginTop: 16 }}>Order with this offer <ArrowRight size={13} /></Link>
              <img src="/seed/pizza.jpg" alt="" />
            </div>
          ) : (
            <div className="promo light">
              <span className="code">BREWHAUS</span>
              <h3>Order ahead, skip the wait.</h3>
              <p>Choose a table, order from your phone and track preparation live.</p>
              <Link to="/menu" className="btn btn-primary btn-sm" style={{ marginTop: 16 }}>Start an order <ArrowRight size={13} /></Link>
            </div>
          )}

          <div className="promo light">
            <span className="code">LOYALTY</span>
            <h3>{settings.loyalty_enabled ? 'Every cup counts.' : 'Join the table.'}</h3>
            <p>{settings.loyalty_enabled
              ? `Earn ${settings.loyalty_points_per_100} points for every ₹100 spent. Redeem from ${settings.loyalty_min_redeem} points.`
              : 'Create an account to keep your reservations and order history in one place.'}</p>
            <Link to="/register" className="btn btn-secondary btn-sm" style={{ marginTop: 16 }}>
              {settings.loyalty_enabled ? 'Create an account' : 'Join Brewhaus'} <ArrowRight size={13} />
            </Link>
            <img src="/seed/croissant.jpg" alt="" />
          </div>
        </section>
      )}

      {popular.length > 0 && (
        <section className="section" aria-labelledby="popular-heading">
          <div className="section-head">
            <div>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>Guest favourites</div>
              <h2 className="section-title" id="popular-heading">Popular right now</h2>
            </div>
            <Link to="/menu?sort=popular" className="section-link">See all <ArrowRight size={13} /></Link>
          </div>
          <div className="food-grid">
            {popular.slice(0, 4).map((item) => <FoodCard key={item.id} item={item} />)}
          </div>
        </section>
      )}

      {specials.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>Limited</div>
              <h2 className="section-title">Specials worth a detour</h2>
            </div>
          </div>
          <div className="food-grid">
            {specials.slice(0, 4).map((item) => <FoodCard key={item.id} item={item} />)}
          </div>
        </section>
      )}

      {newArrivals.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>Just added</div>
              <h2 className="section-title">New on the menu</h2>
            </div>
          </div>
          <div className="food-grid">
            {newArrivals.slice(0, 4).map((item) => <FoodCard key={item.id} item={item} />)}
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <div className="eyebrow" style={{ color: 'var(--copper)' }}>Guest notes</div>
              <h2 className="section-title">Kind words from the table</h2>
            </div>
            <span className="flex items-center gap-8 small" style={{ color: '#7b6d5f' }}><Rating value={avgRating} size={13} /> {avgRating.toFixed(1)} average</span>
          </div>
          <div className="grid g4">
            {reviews.slice(0, 4).map((r) => (
              <div key={r.id} className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
                <Quote size={18} style={{ color: '#c9a06f' }} />
                <p style={{ fontSize: 12.5, lineHeight: 1.65, color: '#5f5144', margin: '8px 0 12px' }}>{r.comment || 'A lovely visit — thank you.'}</p>
                <div className="between">
                  <span className="tiny" style={{ fontWeight: 600 }}>{r.first_name || 'A guest'}</span>
                  <span className="tiny" style={{ color: '#9a8b7c' }}>{fmtDate(r.created_at, { year: false })}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 24, alignItems: 'center' }}>
          <div>
            <div className="eyebrow" style={{ color: 'var(--copper)' }}>Find us</div>
            <h2 className="section-title" style={{ fontSize: 27, marginTop: 8 }}>A quiet corner on Lavelle Road</h2>
            <p className="section-sub" style={{ maxWidth: 460 }}>Walk in for coffee, book a table for dinner, or order ahead and collect at the counter. One cafe, one kitchen — everything prepared to order.</p>
            <div className="flex gap-12 wrap" style={{ marginTop: 16 }}>
              {mapLink && <a className="btn btn-secondary btn-sm" href={mapLink} target="_blank" rel="noreferrer"><MapPin size={14} /> Open in Maps</a>}
              {settings.phone && <a className="btn btn-ghost btn-sm" href={`tel:${String(settings.phone).replace(/\s/g, '')}`}><Phone size={14} /> {settings.phone}</a>}
              <Link className="btn btn-primary btn-sm" to="/reserve"><Sparkles size={14} /> Book a table</Link>
            </div>
          </div>
          <div className="map-preview" style={{ display: 'flex', gap: 12 }}>
            <div className="map-thumb" style={{ background: '#e9dcc7', color: 'var(--copper)' }}><MapPin size={24} /></div>
            <div>
              <div className="small strong">Brewhaus Coffee &amp; Kitchen</div>
              <div className="tiny muted" style={{ marginTop: 3, lineHeight: 1.55 }}>{settings.address || '18 Lavelle Road, Ashok Nagar, Bengaluru'}</div>
              <div className="tiny muted" style={{ marginTop: 5 }}>{settings.opening_time || '08:00'} – {settings.closing_time || '23:00'} · Open daily</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
