import React, { useMemo, useState } from 'react';
import {
  Check, ChefHat, Edit3, ImagePlus, Layers, Plus, RefreshCw, Search, Settings2,
  Trash2, UtensilsCrossed,
} from 'lucide-react';
import { del, patch, post, put, uploadImage } from '../../lib/api';
import { useToast, useFetch } from '../../lib/store';
import {
  Badge, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  SearchBox, SectionCard, Tabs, Toggle,
} from '../../components/ui';
import { inr, num, titleize } from '../../lib/format';

const DIETARY = ['veg', 'vegan', 'non_veg', 'egg'];
const emptyItem = () => ({
  name: '', description: '', price: '', prepTime: 10, categoryId: '', stationId: '',
  imageUrl: '', available: true, dietary: 'veg', tags: '', ingredientsText: '',
  isSpecial: false, isRecommended: false,
});

export default function Menu() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch('/admin/menu');
  const [tab, setTab] = useState('items');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [availability, setAvailability] = useState('all');
  const [sort, setSort] = useState('name');

  const [itemModal, setItemModal] = useState(null); // { editing, form }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const [categoryModal, setCategoryModal] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', sortOrder: 0, active: true });

  const [optionsModal, setOptionsModal] = useState(null); // { item, groups: [...] }
  const [savingOptions, setSavingOptions] = useState(false);

  const items = data?.items || [];
  const categories = data?.categories || [];
  const stations = data?.stations || [];

  const filtered = useMemo(() => {
    const list = items.filter((i) => {
      if (category !== 'all' && i.category_id !== Number(category)) return false;
      if (availability === 'available' && !i.available) return false;
      if (availability === 'unavailable' && i.available) return false;
      if (q.trim()) {
        const hay = `${i.name} ${i.category_name} ${i.description || ''} ${i.tags || ''}`.toLowerCase();
        if (!hay.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    });
    return list.sort((a, b) => {
      if (sort === 'price_asc') return Number(a.price) - Number(b.price);
      if (sort === 'price_desc') return Number(b.price) - Number(a.price);
      if (sort === 'category') return String(a.category_name).localeCompare(String(b.category_name)) || String(a.name).localeCompare(String(b.name));
      return String(a.name).localeCompare(String(b.name));
    });
  }, [items, category, availability, q, sort]);

  const stats = useMemo(() => ({
    total: items.length,
    available: items.filter((i) => i.available).length,
    unavailable: items.filter((i) => !i.available).length,
    categories: categories.length,
  }), [items, categories]);

  const openNewItem = () => {
    setErrors({});
    setItemModal({ editing: null, form: { ...emptyItem(), categoryId: categories[0]?.id || '', stationId: stations[0]?.id || '' } });
  };

  const openEditItem = (item) => {
    setErrors({});
    setItemModal({
      editing: item,
      form: {
        name: item.name, description: item.description || '', price: item.price, prepTime: item.prep_time,
        categoryId: item.category_id, stationId: item.station_id || '', imageUrl: item.image_url || '',
        available: Boolean(item.available), dietary: item.dietary || 'veg', tags: item.tags || '',
        ingredientsText: item.ingredients_text || '', isSpecial: Boolean(item.is_special), isRecommended: Boolean(item.is_recommended),
      },
    });
  };

  const setField = (key, value) => setItemModal((m) => ({ ...m, form: { ...m.form, [key]: value } }));

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadImage(file, 'menu');
      setField('imageUrl', res.url);
      toast.success('Image uploaded');
    } catch (err) { toast.error(err.message); }
    finally { setUploading(false); }
  };

  const saveItem = async (e) => {
    e.preventDefault();
    const f = itemModal.form;
    const localErrors = {};
    if (!f.name.trim()) localErrors.name = 'Item name is required.';
    if (!(Number(f.price) >= 0) || f.price === '') localErrors.price = 'Enter a valid price.';
    if (!f.categoryId) localErrors.categoryId = 'Choose a category.';
    if (Object.keys(localErrors).length) { setErrors(localErrors); return; }
    setSaving(true);
    setErrors({});
    try {
      const body = {
        name: f.name.trim(), description: f.description.trim(), price: Number(f.price),
        prepTime: Number(f.prepTime) || 10, categoryId: Number(f.categoryId),
        stationId: f.stationId ? Number(f.stationId) : null, imageUrl: f.imageUrl || null,
        available: f.available, dietary: f.dietary, tags: f.tags, ingredientsText: f.ingredientsText,
        isSpecial: f.isSpecial, isRecommended: f.isRecommended,
      };
      if (itemModal.editing) await put(`/admin/menu/items/${itemModal.editing.id}`, body);
      else await post('/admin/menu/items', body);
      toast.success(itemModal.editing ? 'Menu item updated' : 'Menu item created');
      setItemModal(null);
      reload();
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const toggleAvailability = async (item, available) => {
    try {
      await patch(`/admin/menu/items/${item.id}/availability`, { available });
      toast.success(`${item.name} is now ${available ? 'available' : 'unavailable'}`);
      reload();
    } catch (err) { toast.error(err.message); }
  };

  const removeItem = async (item) => {
    setBusy(true);
    try {
      await del(`/admin/menu/items/${item.id}`);
      toast.success('Menu item deleted');
      setConfirm(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const openCategory = (cat = null) => {
    setCategoryForm(cat ? { name: cat.name, description: cat.description || '', sortOrder: cat.sort_order, active: Boolean(cat.active), editing: cat } : { name: '', description: '', sortOrder: 0, active: true });
    setCategoryModal(true);
  };

  const saveCategory = async (e) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) { toast.error('Category name is required.'); return; }
    setSaving(true);
    try {
      const body = { name: categoryForm.name.trim(), description: categoryForm.description, sortOrder: Number(categoryForm.sortOrder) || 0, active: categoryForm.active };
      if (categoryForm.editing) await put(`/admin/menu/categories/${categoryForm.editing.id}`, body);
      else await post('/admin/menu/categories', body);
      toast.success(categoryForm.editing ? 'Category updated' : 'Category created');
      setCategoryModal(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const deleteCategory = async (cat) => {
    setBusy(true);
    try {
      await del(`/admin/menu/categories/${cat.id}`);
      toast.success('Category deleted');
      setConfirm(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const openOptions = (item) => {
    const groups = (data?.optionGroups || []).filter((g) => g.menu_item_id === item.id).map((g) => ({
      key: `g${g.id}`,
      name: g.name, selectionType: g.selection_type, required: Boolean(g.required), maxSelect: g.max_select,
      options: (data?.options || []).filter((o) => o.group_id === g.id).map((o) => ({ key: `o${o.id}`, name: o.name, priceDelta: o.price_delta, isDefault: Boolean(o.is_default) })),
    }));
    setOptionsModal({ item, groups });
  };

  const updateGroup = (gi, patchObj) => setOptionsModal((m) => ({ ...m, groups: m.groups.map((g, i) => (i === gi ? { ...g, ...patchObj } : g)) }));
  const updateOption = (gi, oi, patchObj) => setOptionsModal((m) => ({
    ...m,
    groups: m.groups.map((g, i) => (i === gi ? { ...g, options: g.options.map((o, j) => (j === oi ? { ...o, ...patchObj } : o)) } : g)),
  }));

  const saveOptions = async () => {
    setSavingOptions(true);
    try {
      const groups = optionsModal.groups
        .filter((g) => g.name.trim())
        .map((g) => ({
          name: g.name.trim(), selectionType: g.selectionType, required: g.required, maxSelect: Number(g.maxSelect) || 1,
          options: g.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), priceDelta: Number(o.priceDelta) || 0, isDefault: o.isDefault })),
        }));
      await put(`/admin/menu/items/${optionsModal.item.id}/options`, { groups });
      toast.success('Customization options saved');
      setOptionsModal(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setSavingOptions(false); }
  };

  return (
    <>
      <PageHeader title="Menu Management" description="Items, categories, pricing and availability. Unavailable items cannot be ordered from any channel.">
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        {tab === 'items' ? (
          <button className="btn btn-primary btn-sm" onClick={openNewItem}><Plus size={14} /> Add item</button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => openCategory()}><Plus size={14} /> Add category</button>
        )}
      </PageHeader>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card card-pad" style={{ padding: 14 }}><div className="tiny muted">Menu items</div><div style={{ fontSize: 22, fontWeight: 600 }}>{num(stats.total)}</div></div>
        <div className="card card-pad" style={{ padding: 14 }}><div className="tiny muted">Available now</div><div style={{ fontSize: 22, fontWeight: 600, color: 'var(--green)' }}>{num(stats.available)}</div></div>
        <div className="card card-pad" style={{ padding: 14 }}><div className="tiny muted">Paused</div><div style={{ fontSize: 22, fontWeight: 600, color: 'var(--red)' }}>{num(stats.unavailable)}</div></div>
        <div className="card card-pad" style={{ padding: 14 }}><div className="tiny muted">Categories</div><div style={{ fontSize: 22, fontWeight: 600 }}>{num(stats.categories)}</div></div>
      </div>

      <Tabs tabs={[{ key: 'items', label: 'Items', count: stats.total }, { key: 'categories', label: 'Categories', count: stats.categories }]} value={tab} onChange={setTab} />

      {tab === 'items' ? (
        <>
          <div className="toolbar" style={{ marginTop: 14 }}>
            <SearchBox value={q} onChange={setQ} placeholder="Search name, tag, description…" />
            <select className="select" style={{ height: 34, width: 160 }} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="select" style={{ height: 34, width: 150 }} value={availability} onChange={(e) => setAvailability(e.target.value)}>
              <option value="all">Any availability</option>
              <option value="available">Available</option>
              <option value="unavailable">Paused</option>
            </select>
            <select className="select" style={{ height: 34, width: 160 }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name">Sort: Name</option>
              <option value="category">Sort: Category</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
            <span className="small muted" style={{ marginLeft: 'auto' }}>{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
          </div>

          <SectionCard noPad>
            {loading && !data ? <Loading label="Loading menu…" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Item</th><th>Category</th><th>Station</th><th className="right">Price</th><th>Prep</th><th>Diet</th><th>Available</th><th /></tr></thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="flex items-center gap-12">
                            {item.image_url ? <img src={item.image_url} alt="" style={{ width: 42, height: 42, borderRadius: 9, objectFit: 'cover' }} /> : <div style={{ width: 42, height: 42, borderRadius: 9, background: 'var(--surface-3)', display: 'grid', placeItems: 'center' }}><UtensilsCrossed size={16} className="muted" /></div>}
                            <div>
                              <div className="primary-cell">{item.name} {item.is_special ? <Badge tone="accent">Special</Badge> : null} {item.is_recommended ? <Badge tone="green">Recommended</Badge> : null}</div>
                              <div className="sub-cell">{item.recipe_count ? `${item.recipe_count} recipe line(s)` : 'No recipe linked'}{item.tags ? ` · ${item.tags}` : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="small">{item.category_name}</td>
                        <td className="small">{item.station_name || '—'}</td>
                        <td className="right num strong">{inr(item.price)}</td>
                        <td className="small">{item.prep_time} min</td>
                        <td><Badge tone={item.dietary === 'non_veg' ? 'red' : item.dietary === 'egg' ? 'amber' : 'green'}>{titleize(item.dietary || '—')}</Badge></td>
                        <td><div className="flex items-center gap-8"><Toggle checked={Boolean(item.available)} onChange={(v) => toggleAvailability(item, v)} label={`Availability for ${item.name}`} /><span className="tiny muted">{item.available ? 'On' : 'Off'}</span></div></td>
                        <td className="right">
                          <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-xs" onClick={() => openOptions(item)} title="Customization options"><Settings2 size={12} /></button>
                            <button className="btn btn-secondary btn-xs" onClick={() => openEditItem(item)} title="Edit"><Edit3 size={12} /></button>
                            <button className="btn btn-ghost btn-xs" title="Delete" onClick={() => setConfirm({ title: 'Delete menu item?', message: `Delete ${item.name}? Historical order lines keep their snapshot, but the item will disappear from the menu.`, run: () => removeItem(item) })}><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!filtered.length && <tr><td colSpan={8}><EmptyState icon={ChefHat} title="No items match" description="Adjust the filters or add a new menu item." action={<button className="btn btn-primary btn-sm" onClick={openNewItem}><Plus size={14} /> Add item</button>} /></td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      ) : (
        <div className="grid g3" style={{ marginTop: 16 }}>
          {categories.map((c) => (
            <div className="card card-pad" key={c.id}>
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div className="flex gap-12">
                  {c.image_url ? <img src={c.image_url} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover' }} /> : <div className="empty-icon" style={{ margin: 0, width: 48, height: 48 }}><Layers size={18} /></div>}
                  <div>
                    <div className="strong">{c.name}</div>
                    <div className="tiny muted">{c.item_count} item{c.item_count === 1 ? '' : 's'} · order {c.sort_order}</div>
                  </div>
                </div>
                <Badge tone={c.active ? 'green' : 'red'}>{c.active ? 'Active' : 'Hidden'}</Badge>
              </div>
              <p className="small muted" style={{ marginTop: 10, minHeight: 32 }}>{c.description || 'No description'}</p>
              <div className="flex gap-4" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary btn-xs" onClick={() => openCategory(c)}><Edit3 size={12} /> Edit</button>
                <button className="btn btn-ghost btn-xs" onClick={() => setConfirm({ title: 'Delete category?', message: `Delete ${c.name}? Categories can only be deleted when they contain no items.`, run: () => deleteCategory(c) })}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {!categories.length && <div className="card" style={{ gridColumn: '1 / -1' }}><EmptyState icon={Layers} title="No categories yet" action={<button className="btn btn-primary btn-sm" onClick={() => openCategory()}><Plus size={14} /> Add category</button>} /></div>}
        </div>
      )}

      <Modal
        open={!!itemModal}
        onClose={() => setItemModal(null)}
        title={itemModal?.editing ? `Edit ${itemModal.editing.name}` : 'Add menu item'}
        subtitle="Images are stored in R2 and served through the Worker. Only available items appear on the storefront."
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setItemModal(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="menu-item-form" type="submit" disabled={saving}><Check size={15} /> {saving ? 'Saving…' : 'Save item'}</button>
          </>
        )}
      >
        {itemModal && (
          <form id="menu-item-form" onSubmit={saveItem} className="form-grid" style={{ paddingTop: 6 }}>
            <Field label="Name" error={errors.name} className="full">
              <input className="input" value={itemModal.form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Cardamom Cold Brew" />
            </Field>
            <Field label="Category" error={errors.categoryId}>
              <select className="select" value={itemModal.form.categoryId} onChange={(e) => setField('categoryId', e.target.value)}>
                <option value="">Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Kitchen station">
              <select className="select" value={itemModal.form.stationId} onChange={(e) => setField('stationId', e.target.value)}>
                <option value="">Unassigned (cannot be ordered)</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name} · target {s.target_minutes}m</option>)}
              </select>
            </Field>
            <Field label="Price (₹)" error={errors.price}>
              <input className="input" type="number" min={0} step="1" value={itemModal.form.price} onChange={(e) => setField('price', e.target.value)} placeholder="250" />
            </Field>
            <Field label="Prep time (minutes)" error={errors.prepTime}>
              <input className="input" type="number" min={1} max={180} value={itemModal.form.prepTime} onChange={(e) => setField('prepTime', e.target.value)} />
            </Field>
            <Field label="Dietary">
              <select className="select" value={itemModal.form.dietary} onChange={(e) => setField('dietary', e.target.value)}>
                {DIETARY.map((d) => <option key={d} value={d}>{titleize(d)}</option>)}
              </select>
            </Field>
            <Field label="Tags" hint="Comma separated, e.g. Hot, Bestseller">
              <input className="input" value={itemModal.form.tags} onChange={(e) => setField('tags', e.target.value)} placeholder="Hot, Signature" />
            </Field>
            <Field label="Description" className="full">
              <textarea className="textarea" rows={3} value={itemModal.form.description} onChange={(e) => setField('description', e.target.value)} placeholder="What makes this item special?" />
            </Field>
            <Field label="Ingredients (used by the menu assistant)" className="full">
              <input className="input" value={itemModal.form.ingredientsText} onChange={(e) => setField('ingredientsText', e.target.value)} placeholder="Coffee beans, Milk, Cardamom" />
            </Field>
            <Field label="Image" hint="JPG, PNG, WEBP or GIF up to 5 MB" className="full">
              <div className="flex gap-12 items-center wrap">
                {itemModal.form.imageUrl ? <img src={itemModal.form.imageUrl} alt="" style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--line)' }} /> : <div style={{ width: 72, height: 72, borderRadius: 10, background: 'var(--surface-3)', display: 'grid', placeItems: 'center' }}><ImagePlus size={20} className="muted" /></div>}
                <label className={`btn btn-secondary btn-sm ${uploading ? 'disabled' : ''}`} style={{ cursor: 'pointer' }}>
                  {uploading ? 'Uploading…' : 'Upload image'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} disabled={uploading} onChange={(e) => { handleUpload(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {itemModal.form.imageUrl && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setField('imageUrl', '')}>Remove</button>}
              </div>
            </Field>
            <Field label="Availability">
              <div className="flex items-center gap-12"><Toggle checked={itemModal.form.available} onChange={(v) => setField('available', v)} /><span className="small muted">{itemModal.form.available ? 'Orderable now' : 'Hidden from ordering'}</span></div>
            </Field>
            <Field label="Highlights">
              <div className="flex gap-16 wrap" style={{ paddingTop: 6 }}>
                <label className="check"><input type="checkbox" checked={itemModal.form.isSpecial} onChange={(e) => setField('isSpecial', e.target.checked)} /> Special</label>
                <label className="check"><input type="checkbox" checked={itemModal.form.isRecommended} onChange={(e) => setField('isRecommended', e.target.checked)} /> Recommended</label>
              </div>
            </Field>
          </form>
        )}
      </Modal>

      <Modal
        open={!!categoryModal}
        onClose={() => setCategoryModal(false)}
        title={categoryForm.editing ? `Edit ${categoryForm.editing.name}` : 'Add category'}
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setCategoryModal(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="category-form" type="submit" disabled={saving}><Check size={15} /> Save category</button>
          </>
        )}
      >
        <form id="category-form" onSubmit={saveCategory} style={{ paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Field label="Name">
            <input className="input" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="e.g. Seasonal Bakes" />
          </Field>
          <Field label="Description">
            <textarea className="textarea" rows={2} value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="Sort order">
              <input className="input" type="number" value={categoryForm.sortOrder} onChange={(e) => setCategoryForm({ ...categoryForm, sortOrder: e.target.value })} />
            </Field>
            <Field label="Visible">
              <div style={{ paddingTop: 9 }}><Toggle checked={categoryForm.active} onChange={(v) => setCategoryForm({ ...categoryForm, active: v })} /></div>
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!optionsModal}
        onClose={() => setOptionsModal(null)}
        title={optionsModal ? `Customize ${optionsModal.item.name}` : 'Options'}
        subtitle="Required groups must be chosen before the item can be ordered. The server re-validates every selection."
        size="wide"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setOptionsModal(null)} disabled={savingOptions}>Cancel</button>
            <button className="btn btn-primary" onClick={saveOptions} disabled={savingOptions}><Check size={15} /> {savingOptions ? 'Saving…' : 'Save options'}</button>
          </>
        )}
      >
        {optionsModal && (
          <div style={{ paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {optionsModal.groups.map((g, gi) => (
              <div key={gi} className="card card-pad" style={{ padding: 13 }}>
                <div className="form-grid" style={{ gap: 10 }}>
                  <Field label="Group name"><input className="input" value={g.name} onChange={(e) => updateGroup(gi, { name: e.target.value })} placeholder="Size" /></Field>
                  <Field label="Selection">
                    <select className="select" value={g.selectionType} onChange={(e) => updateGroup(gi, { selectionType: e.target.value })}>
                      <option value="single">Single choice</option>
                      <option value="multi">Multiple choice</option>
                    </select>
                  </Field>
                  <Field label="Required">
                    <div style={{ paddingTop: 8 }}><Toggle checked={g.required} onChange={(v) => updateGroup(gi, { required: v })} /></div>
                  </Field>
                  <Field label="Max select">
                    <input className="input" type="number" min={1} value={g.maxSelect} onChange={(e) => updateGroup(gi, { maxSelect: e.target.value })} />
                  </Field>
                </div>
                <div style={{ marginTop: 8 }}>
                  {g.options.map((o, oi) => (
                    <div key={oi} className="flex gap-8 items-center" style={{ marginBottom: 6 }}>
                      <input className="input" style={{ flex: 2 }} value={o.name} onChange={(e) => updateOption(gi, oi, { name: e.target.value })} placeholder="Option name" />
                      <input className="input" style={{ flex: 1 }} type="number" value={o.priceDelta} onChange={(e) => updateOption(gi, oi, { priceDelta: e.target.value })} placeholder="₹ delta" />
                      <label className="check tiny nowrap"><input type="checkbox" checked={o.isDefault} onChange={(e) => updateOption(gi, oi, { isDefault: e.target.checked })} /> Default</label>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => updateGroup(gi, { options: g.options.filter((_, j) => j !== oi) })}><Trash2 size={12} /></button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => updateGroup(gi, { options: [...g.options, { key: `n${Date.now()}`, name: '', priceDelta: 0, isDefault: false }] })}><Plus size={12} /> Add option</button>
                </div>
                <div className="flex gap-8" style={{ marginTop: 10 }}>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOptionsModal((m) => ({ ...m, groups: m.groups.filter((_, i) => i !== gi) }))}><Trash2 size={12} /> Remove group</button>
                </div>
              </div>
            ))}
            {!optionsModal.groups.length && <div className="empty"><div className="small muted">No option groups yet. Add one below.</div></div>}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOptionsModal((m) => ({ ...m, groups: [...m.groups, { key: `g${Date.now()}`, name: '', selectionType: 'single', required: false, maxSelect: 1, options: [] }] }))}><Plus size={14} /> Add option group</button>
            <div className="notice info"><Settings2 size={15} /><span>Saving replaces all existing option groups for this item. Historical order lines keep their saved selection.</span></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={confirm?.run}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
