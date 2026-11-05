import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Plus, Star } from 'lucide-react';
import { post } from '../../lib/api';
import { useAuth, useToast } from '../../lib/store';
import { inr } from '../../lib/format';

export default function FoodCard({ item, favorite = false, onFavorite }) {
  const { isCustomer } = useAuth();
  const toast = useToast();
  const [fav, setFav] = useState(favorite);

  const toggleFavorite = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isCustomer) { toast.info('Sign in to save favourites.'); return; }
    try {
      const res = await post(`/customer/favorites/${item.id}`);
      setFav(res.favorite);
      onFavorite?.(item.id, res.favorite);
      toast.success(res.favorite ? `${item.name} saved` : `${item.name} removed from favourites`);
    } catch (err) { toast.error(err.message); }
  };

  return (
    <article className="food-card">
      <div className="food-img">
        <Link to={`/menu/${item.id}`} aria-label={item.name} style={{ display: 'block', width: '100%', height: '100%' }}>
          {item.image ? <img src={item.image} alt={item.name} loading="lazy" /> : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#b8a894' }}>No photo</div>}
        </Link>
        <div style={{ position: 'absolute', top: 9, left: 9, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {item.isSpecial && <span className="food-tag hot">Chef’s pick</span>}
          {item.isRecommended && !item.isSpecial && <span className="food-tag">Recommended</span>}
          {item.tags?.includes('bestseller') && <span className="food-tag">Bestseller</span>}
        </div>
        {isCustomer && (
          <button type="button" className={`food-fav ${fav ? 'active' : ''}`} onClick={toggleFavorite} aria-label={fav ? 'Remove favourite' : 'Save favourite'}>
            <Heart size={14} fill={fav ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <div className="food-body">
        <div className="between" style={{ alignItems: 'flex-start', gap: 8 }}>
          <Link to={`/menu/${item.id}`} className="food-name">{item.name}</Link>
          {item.dietary ? <span className={`diet-dot diet-${item.dietary}`} title={item.dietary.replace('_', ' ')} style={{ marginTop: 5 }} /> : null}
        </div>
        <p className="food-desc">{item.description || 'Prepared fresh in our kitchen.'}</p>
        <div className="food-foot">
          <div>
            <div className="food-price">{inr(item.price)}</div>
            <div className="tiny" style={{ color: '#91837a', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              {item.prepTime ? <>{item.prepTime} min</> : null}
              {item.sold > 0 ? <><Star size={9} /> {Number(item.sold).toLocaleString('en-IN')} sold</> : null}
            </div>
          </div>
          <Link to={`/menu/${item.id}`} className="food-add" aria-label={`Customise ${item.name}`}><Plus size={14} /></Link>
        </div>
      </div>
    </article>
  );
}
