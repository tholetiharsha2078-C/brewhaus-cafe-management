import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Minus, Plus, ShoppingBag, Trash2, UtensilsCrossed,
} from 'lucide-react';
import { useCart, useFetch } from '../../lib/store';
import { inr } from '../../lib/format';
import { ConfirmDialog, EmptyState } from '../../components/ui';

export default function Cart() {
  const { items, setQty, remove, clear, subtotal, count } = useCart();
  const { data: home } = useFetch('/public/home');
  const settings = home?.settings || {};
  const [clearOpen, setClearOpen] = useState(false);

  const taxRate = Number(settings.tax_rate) || 0;
  const serviceRate = Number(settings.service_charge_rate) || 0;
  const tax = settings.tax_inclusive ? (subtotal * taxRate) / (100 + taxRate) : (subtotal * taxRate) / 100;
  const service = (subtotal * serviceRate) / 100;
  const total = settings.tax_inclusive ? subtotal + service : subtotal + tax + service;

  if (!items.length) {
    return (
      <div style={{ paddingTop: 30 }}>
        <div className="card" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)', marginTop: 20 }}>
          <EmptyState
            icon={ShoppingBag}
            title="Your cart is empty"
            description="Add a coffee, a plate from the kitchen or something sweet. Availability and prices update live."
            action={<Link className="btn btn-primary btn-sm" to="/menu"><UtensilsCrossed size={14} /> Browse the menu</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 30 }}>
      <div className="cust-page-head" style={{ paddingTop: 0 }}>
        <div className="eyebrow" style={{ color: 'var(--copper)' }}>Your order</div>
        <h1>Cart · {count} item{count === 1 ? '' : 's'}</h1>
        <p>Prices and availability are re-checked on the server when you place the order.</p>
      </div>

      <div className="cart-layout">
        <div className="card card-pad" style={{ background: '#fff', borderColor: 'rgba(33,26,21,.08)' }}>
          {items.map((item) => (
            <div className="cart-item" key={item.key}>
              {item.image ? (
                <img className="cart-thumb" src={item.image} alt="" />
              ) : (
                <div className="cart-thumb" style={{ display: 'grid', placeItems: 'center', color: '#b8a894' }}><UtensilsCrossed size={18} /></div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="between" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <Link to={`/menu/${item.id}`} className="cart-item-name">{item.name}</Link>
                    {item.options?.length > 0 && (
                      <div className="cart-item-opts">{item.options.map((o) => `${o.group}: ${o.name}`).join(' · ')}</div>
                    )}
                    {item.instructions && <div className="cart-item-opts" style={{ fontStyle: 'italic' }}>“{item.instructions}”</div>}
                    {item.allergy && (
                      <div className="tiny" style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                        <AlertTriangle size={10} /> Allergy alert
                      </div>
                    )}
                  </div>
                  <button className="icon-btn" onClick={() => remove(item.key)} aria-label={`Remove ${item.name}`} style={{ width: 30, height: 30, color: '#9a8b7c' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="between" style={{ marginTop: 12 }}>
                  <div className="qty-stepper" style={{ height: 38 }}>
                    <button type="button" onClick={() => setQty(item.key, item.qty - 1)} aria-label="Decrease quantity" disabled={item.qty <= 1}><Minus size={12} /></button>
                    <span>{item.qty}</span>
                    <button type="button" onClick={() => setQty(item.key, item.qty + 1)} aria-label="Increase quantity"><Plus size={12} /></button>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>{inr(item.price * item.qty)}</div>
                    {item.qty > 1 && <div className="tiny muted">{inr(item.price)} each</div>}
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="between" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(33,26,21,.08)' }}>
            <Link to="/menu" className="btn btn-ghost btn-sm"><ArrowLeft size={13} /> Add more items</Link>
            <button className="btn btn-ghost btn-sm" onClick={() => setClearOpen(true)} style={{ color: 'var(--red)' }}><Trash2 size={13} /> Clear cart</button>
          </div>
        </div>

        <aside className="checkout-box">
          <div className="eyebrow" style={{ color: 'var(--copper)' }}>Summary</div>
          <div style={{ marginTop: 10 }}>
            <div className="checkout-line"><span>Subtotal</span><span>{inr(subtotal)}</span></div>
            {taxRate > 0 && (
              <div className="checkout-line">
                <span>GST ({taxRate}%){settings.tax_inclusive ? ' · included' : ''}</span>
                <span>{inr(tax, { decimals: true })}</span>
              </div>
            )}
            {serviceRate > 0 && (
              <div className="checkout-line"><span>Service charge ({serviceRate}%)</span><span>{inr(service, { decimals: true })}</span></div>
            )}
            <div className="checkout-line total"><span>Estimated total</span><span>{inr(total)}</span></div>
          </div>
          <p className="tiny muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
            Final tax, discounts and loyalty are calculated by the server at checkout. You’ll see the exact total before sending the order.
          </p>
          <Link className="btn btn-primary" to="/checkout" style={{ width: '100%', marginTop: 14 }}>
            Proceed to checkout <ArrowRight size={14} />
          </Link>
          <div className="tiny muted" style={{ marginTop: 10, lineHeight: 1.55 }}>
            Dine-in, takeaway or pre-order with a reservation. Payment is verified by staff — no card details are stored.
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="Clear your cart?"
        message="All items will be removed. This cannot be undone."
        confirmLabel="Clear cart"
        onConfirm={() => { clear(); setClearOpen(false); }}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}
