import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, Check, ChefHat, ClipboardList, Edit3, Minus, Package,
  Plus, RefreshCw, Search, ShoppingCart, Trash2, Truck, Warehouse,
} from 'lucide-react';
import { patch, post, put } from '../../lib/api';
import { useFetch, useToast } from '../../lib/store';
import {
  Badge, ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader,
  SearchBox, SectionCard, StatusBadge, Tabs, Toggle,
} from '../../components/ui';
import { fmtDate, fmtDateTime, inr, num, titleize, todayISO } from '../../lib/format';

const UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'pack', 'bottle'];
const MOVEMENT_TYPES = ['wastage', 'adjustment', 'return'];
const emptyIngredient = () => ({ name: '', category: 'General', unit: 'g', stockQty: 0, minStock: 0, costPerUnit: 0, supplierId: '', active: true });
const emptySupplier = () => ({ name: '', contactName: '', phone: '', email: '', address: '', notes: '', active: true });

export default function Inventory() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch('/admin/inventory');
  const [tab, setTab] = useState('ingredients');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');

  const ingredients = data?.ingredients || [];
  const suppliers = data?.suppliers || [];
  const purchases = data?.purchases || [];
  const purchaseItems = data?.purchaseItems || [];
  const recipes = data?.recipes || [];
  const movements = data?.movements || [];
  const menuItems = data?.menuItems || [];
  const reports = data?.availabilityReports || [];
  const stats = data?.stats || {};

  const categories = useMemo(() => [...new Set(ingredients.map((i) => i.category))].sort(), [ingredients]);
  const lowItems = useMemo(() => ingredients.filter((i) => Number(i.stock_qty) <= Number(i.min_stock)), [ingredients]);

  const filteredIngredients = useMemo(() => {
    return ingredients.filter((i) => {
      if (filter === 'low' && Number(i.stock_qty) > Number(i.min_stock)) return false;
      if (filter === 'inactive' && i.active) return false;
      if (category !== 'all' && i.category !== category) return false;
      if (q.trim()) {
        const hay = `${i.name} ${i.category} ${i.supplier_name || ''}`.toLowerCase();
        if (!hay.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [ingredients, filter, category, q]);

  const recipeGroups = useMemo(() => {
    const map = new Map();
    for (const r of recipes) {
      if (!map.has(r.menu_item_id)) map.set(r.menu_item_id, []);
      map.get(r.menu_item_id).push(r);
    }
    return map;
  }, [recipes]);

  // ------------------------------------------------------------- Ingredient modal
  const [ingredientModal, setIngredientModal] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const openNewIngredient = () => { setErrors({}); setIngredientModal({ editing: null, form: emptyIngredient() }); };
  const openEditIngredient = (ing) => {
    setErrors({});
    setIngredientModal({
      editing: ing,
      form: {
        name: ing.name, category: ing.category, unit: ing.unit, stockQty: ing.stock_qty, minStock: ing.min_stock,
        costPerUnit: ing.cost_per_unit, supplierId: ing.supplier_id || '', active: Boolean(ing.active),
      },
    });
  };

  const saveIngredient = async (e) => {
    e.preventDefault();
    const f = ingredientModal.form;
    const local = {};
    if (!f.name.trim()) local.name = 'Ingredient name is required.';
    if (!f.unit) local.unit = 'Choose a unit.';
    if (Object.keys(local).length) { setErrors(local); return; }
    setSaving(true);
    try {
      const body = {
        name: f.name.trim(), category: f.category.trim() || 'General', unit: f.unit,
        stockQty: Number(f.stockQty) || 0, minStock: Number(f.minStock) || 0,
        costPerUnit: Number(f.costPerUnit) || 0, supplierId: f.supplierId ? Number(f.supplierId) : null, active: f.active,
      };
      if (ingredientModal.editing) await put(`/admin/inventory/ingredients/${ingredientModal.editing.id}`, body);
      else await post('/admin/inventory/ingredients', body);
      toast.success(ingredientModal.editing ? 'Ingredient updated' : 'Ingredient added');
      setIngredientModal(null);
      reload();
    } catch (err) {
      setErrors(err.data?.errors || {});
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  // ------------------------------------------------------------- Movement modal
  const [movementModal, setMovementModal] = useState(null);
  const [movementForm, setMovementForm] = useState({ type: 'wastage', qty: '', note: '' });

  const openMovement = (ing, type = 'wastage') => {
    setMovementForm({ type, qty: '', note: '' });
    setMovementModal(ing);
  };

  const saveMovement = async () => {
    if (!(Number(movementForm.qty) > 0)) { toast.error('Enter a quantity greater than zero.'); return; }
    setSaving(true);
    try {
      await post('/admin/inventory/movements', {
        ingredientId: movementModal.id, type: movementForm.type, qty: Number(movementForm.qty), note: movementForm.note,
      });
      toast.success('Stock movement recorded');
      setMovementModal(null);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  // ------------------------------------------------------------- Purchase modal
  const [purchaseModal, setPurchaseModal] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({ supplierId: '', date: todayISO(), notes: '' });
  const [purchaseLines, setPurchaseLines] = useState([]);

  const openPurchase = () => {
    setPurchaseForm({ supplierId: suppliers[0]?.id || '', date: todayISO(), notes: '' });
    setPurchaseLines([{ key: `l${Date.now()}`, ingredientId: ingredients[0]?.id || '', qty: '', unitCost: ingredients[0]?.cost_per_unit || 0 }]);
    setPurchaseModal(true);
  };

  const updatePurchaseLine = (key, patchObj) => setPurchaseLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patchObj } : l)));
  const purchaseTotal = purchaseLines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  const savePurchase = async () => {
    const validLines = purchaseLines.filter((l) => l.ingredientId && Number(l.qty) > 0);
    if (!validLines.length) { toast.error('Add at least one valid purchase line.'); return; }
    setSaving(true);
    try {
      const res = await post('/admin/inventory/purchases', {
        supplierId: purchaseForm.supplierId ? Number(purchaseForm.supplierId) : null,
        date: purchaseForm.date, notes: purchaseForm.notes || null,
        items: validLines.map((l) => ({ ingredientId: Number(l.ingredientId), qty: Number(l.qty), unitCost: Number(l.unitCost) || 0 })),
      });
      toast.success(`Purchase ${res.reference} recorded · stock updated`);
      setPurchaseModal(false);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  // ------------------------------------------------------------- Supplier modal
  const [supplierModal, setSupplierModal] = useState(null);
  const [supplierForm, setSupplierForm] = useState(emptySupplier());

  const openSupplier = (sup = null) => {
    setSupplierForm(sup ? {
      name: sup.name, contactName: sup.contact_name || '', phone: sup.phone || '', email: sup.email || '',
      address: sup.address || '', notes: sup.notes || '', active: Boolean(sup.active), editing: sup,
    } : emptySupplier());
    setSupplierModal(true);
  };

  const saveSupplier = async (e) => {
    e.preventDefault();
    if (!supplierForm.name.trim()) { toast.error('Supplier name is required.'); return; }
    setSaving(true);
    try {
      const body = {
        name: supplierForm.name.trim(), contactName: supplierForm.contactName || null, phone: supplierForm.phone || null,
        email: supplierForm.email || null, address: supplierForm.address || null, notes: supplierForm.notes || null, active: supplierForm.active,
      };
      if (supplierForm.editing) await put(`/admin/inventory/suppliers/${supplierForm.editing.id}`, body);
      else await post('/admin/inventory/suppliers', body);
      toast.success(supplierForm.editing ? 'Supplier updated' : 'Supplier added');
      setSupplierModal(false);
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  // ------------------------------------------------------------- Recipe editor
  const [recipeItemId, setRecipeItemId] = useState('');
  const [recipeLines, setRecipeLines] = useState([]);
  const [recipeSearch, setRecipeSearch] = useState('');
  const [savingRecipe, setSavingRecipe] = useState(false);

  useEffect(() => {
    if (!recipeItemId) { setRecipeLines([]); return; }
    const lines = (recipeGroups.get(Number(recipeItemId)) || []).map((r) => ({
      key: `r${r.id}`, ingredientId: r.ingredient_id, quantity: r.quantity, unit: r.unit,
    }));
    setRecipeLines(lines);
  }, [recipeItemId, recipes]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRecipeLine = () => {
    const used = new Set(recipeLines.map((l) => Number(l.ingredientId)));
    const next = ingredients.find((i) => !used.has(i.id));
    setRecipeLines((prev) => [...prev, { key: `n${Date.now()}`, ingredientId: next?.id || '', quantity: '', unit: next?.unit || 'g' }]);
  };

  const saveRecipe = async () => {
    if (!recipeItemId) { toast.error('Choose a menu item.'); return; }
    const valid = recipeLines.filter((l) => l.ingredientId && Number(l.quantity) > 0);
    setSavingRecipe(true);
    try {
      await put(`/admin/inventory/recipes/${recipeItemId}`, {
        ingredients: valid.map((l) => ({ ingredientId: Number(l.ingredientId), quantity: Number(l.quantity), unit: l.unit })),
      });
      toast.success('Recipe saved — stock consumption will follow it');
      reload();
    } catch (err) { toast.error(err.message); }
    finally { setSavingRecipe(false); }
  };

  const resolveReport = async (report, status) => {
    try {
      await patch(`/admin/availability-reports/${report.id}`, { status });
      toast.success(`Issue ${status}`);
      reload();
    } catch (err) { toast.error(err.message); }
  };

  // ------------------------------------------------------------- Purchase detail
  const [openPurchaseId, setOpenPurchaseId] = useState(null);
  const purchaseLinesFor = (id) => purchaseItems.filter((l) => l.purchase_id === id);

  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const filteredMenuItems = menuItems.filter((i) => i.name.toLowerCase().includes(recipeSearch.toLowerCase()));
  const selectedRecipeItem = menuItems.find((i) => i.id === Number(recipeItemId));

  return (
    <>
      <PageHeader title="Inventory & Procurement" description="Ingredients, recipes, suppliers and purchases. Completing an order consumes stock exactly as the linked recipe defines.">
        <button className="btn btn-secondary btn-sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>
        <button className="btn btn-secondary btn-sm" onClick={openPurchase}><ShoppingCart size={14} /> Record purchase</button>
        <button className="btn btn-primary btn-sm" onClick={openNewIngredient}><Plus size={14} /> Add ingredient</button>
      </PageHeader>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Ingredients tracked</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{num(stats.totalItems)}</div>
          <div className="tiny muted">{num(ingredients.filter((i) => i.active).length)} active</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Low stock</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: lowItems.length ? 'var(--red)' : 'var(--green)' }}>{num(stats.lowStock)}</div>
          <div className="tiny muted">At or below minimum level</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Stock value</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{inr(stats.stockValue)}</div>
          <div className="tiny muted">At cost per unit</div>
        </div>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="tiny muted">Open kitchen issues</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: reports.length ? 'var(--amber)' : '' }}>{num(reports.length)}</div>
          <div className="tiny muted">Reported by the kitchen</div>
        </div>
      </div>

      {lowItems.length > 0 && (
        <div className="notice danger" style={{ marginBottom: 14 }}>
          <AlertTriangle size={15} />
          <div>
            <strong>{lowItems.length} ingredient{lowItems.length === 1 ? '' : 's'} below minimum.</strong>{' '}
            {lowItems.slice(0, 4).map((i) => i.name).join(', ')}{lowItems.length > 4 ? ` and ${lowItems.length - 4} more` : ''}. Record a purchase to restock.
          </div>
        </div>
      )}

      {reports.length > 0 && (
        <SectionCard title="Kitchen availability reports" subtitle="Items the kitchen flagged. Update the menu or restock, then resolve." style={{ marginBottom: 16 }}>
          {reports.map((r) => (
            <div key={r.id} className="between" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)', gap: 10 }}>
              <div>
                <div className="small strong">{r.item_name} · {titleize(r.kind)}</div>
                <div className="tiny muted">{r.reason} — {r.reported_by_name || 'Kitchen'} · {fmtDateTime(r.created_at)}</div>
              </div>
              <div className="flex gap-4">
                {r.status === 'open' && <button className="btn btn-secondary btn-xs" onClick={() => resolveReport(r, 'acknowledged')}>Acknowledge</button>}
                <button className="btn btn-primary btn-xs" onClick={() => resolveReport(r, 'resolved')}>Resolve</button>
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      <Tabs
        tabs={[
          { key: 'ingredients', label: 'Ingredients', count: ingredients.length },
          { key: 'recipes', label: 'Recipes', count: recipeGroups.size },
          { key: 'purchases', label: 'Purchases', count: purchases.length },
          { key: 'suppliers', label: 'Suppliers', count: suppliers.length },
          { key: 'movements', label: 'Movements', count: movements.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 14 }}>
        {tab === 'ingredients' && (
          <>
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <SearchBox value={q} onChange={setQ} placeholder="Search ingredient, category or supplier…" />
              <select className="select" style={{ height: 34, width: 150 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All items</option>
                <option value="low">Low stock only</option>
                <option value="inactive">Inactive</option>
              </select>
              <select className="select" style={{ height: 34, width: 160 }} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="small muted" style={{ marginLeft: 'auto' }}>{filteredIngredients.length} item{filteredIngredients.length === 1 ? '' : 's'}</span>
            </div>
            <SectionCard noPad>
              {loading && !data ? <Loading label="Loading inventory…" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
                <div className="table-wrap">
                  <table className="tbl">
                    <thead><tr><th>Ingredient</th><th>Category</th><th>Stock</th><th>Minimum</th><th>Cost / unit</th><th>Supplier</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {filteredIngredients.map((ing) => {
                        const low = Number(ing.stock_qty) <= Number(ing.min_stock);
                        const ratio = Number(ing.min_stock) ? Math.min(100, (Number(ing.stock_qty) / Number(ing.min_stock)) * 100) : (Number(ing.stock_qty) > 0 ? 100 : 0);
                        return (
                          <tr key={ing.id}>
                            <td className="primary-cell">{ing.name}{!ing.active ? <Badge tone="red" className="tiny" style={{ marginLeft: 6 }}>Inactive</Badge> : null}<div className="sub-cell">Updated {fmtDate(ing.updated_at)}</div></td>
                            <td className="small">{ing.category}</td>
                            <td style={{ minWidth: 150 }}>
                              <div className="between tiny" style={{ marginBottom: 3 }}>
                                <strong style={{ color: low ? 'var(--red)' : 'var(--ink)' }}>{num(Number(ing.stock_qty).toFixed(1))} {ing.unit}</strong>
                                <span className="faint">{low ? 'LOW' : ''}</span>
                              </div>
                              <div className="progress" style={{ height: 5 }}><span style={{ width: `${ratio}%`, background: low ? 'var(--red)' : 'var(--green)' }} /></div>
                            </td>
                            <td className="small">{num(ing.min_stock)} {ing.unit}</td>
                            <td className="num">{inr(ing.cost_per_unit)}</td>
                            <td className="small">{ing.supplier_name || '—'}</td>
                            <td><Badge tone={!ing.active ? 'red' : low ? 'amber' : 'green'}>{!ing.active ? 'Inactive' : low ? 'Restock' : 'Healthy'}</Badge></td>
                            <td className="right">
                              <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
                                <button className="btn btn-secondary btn-xs" onClick={() => openMovement(ing, 'wastage')}><Minus size={11} /> Stock</button>
                                <button className="btn btn-secondary btn-xs" onClick={() => openEditIngredient(ing)}><Edit3 size={11} /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!filteredIngredients.length && <tr><td colSpan={8}><EmptyState icon={Package} title="No ingredients found" description="Adjust filters or add your first ingredient." action={<button className="btn btn-primary btn-sm" onClick={openNewIngredient}><Plus size={14} /> Add ingredient</button>} /></td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </>
        )}

        {tab === 'recipes' && (
          <div className="split-2" style={{ gridTemplateColumns: '320px minmax(0,1fr)', alignItems: 'start' }}>
            <SectionCard title="Choose a menu item" subtitle="Recipes drive automatic stock consumption">
              <div className="search" style={{ marginBottom: 10 }}><Search size={15} /><input value={recipeSearch} onChange={(e) => setRecipeSearch(e.target.value)} placeholder="Search menu…" /></div>
              <div style={{ maxHeight: 460, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
                {filteredMenuItems.map((item) => {
                  const lines = recipeGroups.get(item.id) || [];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setRecipeItemId(String(item.id))}
                      className="between"
                      style={{ width: '100%', border: 0, borderBottom: '1px solid var(--line)', background: recipeItemId === String(item.id) ? 'var(--accent-soft)' : 'transparent', padding: '9px 11px', textAlign: 'left', gap: 8 }}
                    >
                      <span className="small strong">{item.name}</span>
                      <Badge tone={lines.length ? 'green' : 'amber'}>{lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : 'No recipe'}</Badge>
                    </button>
                  );
                })}
                {!filteredMenuItems.length && <div className="empty" style={{ padding: 24 }}><div className="small muted">No menu items match.</div></div>}
              </div>
            </SectionCard>

            <SectionCard
              title={selectedRecipeItem ? `Recipe · ${selectedRecipeItem.name}` : 'Recipe editor'}
              subtitle="Quantities are per single serving and are deducted when an order is completed."
              action={selectedRecipeItem ? <button className="btn btn-primary btn-sm" onClick={saveRecipe} disabled={savingRecipe}><Check size={14} /> {savingRecipe ? 'Saving…' : 'Save recipe'}</button> : null}
            >
              {!selectedRecipeItem ? (
                <EmptyState icon={BookOpen} title="Select a menu item" description="Pick an item on the left to view or edit its ingredient recipe." />
              ) : (
                <>
                  {recipeLines.map((line) => {
                    const ing = ingredients.find((i) => i.id === Number(line.ingredientId));
                    return (
                      <div key={line.key} className="flex gap-8 items-center wrap" style={{ marginBottom: 8 }}>
                        <select className="select" style={{ flex: 2, minWidth: 160 }} value={line.ingredientId}
                          onChange={(e) => {
                            const next = ingredients.find((i) => i.id === Number(e.target.value));
                            setRecipeLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, ingredientId: e.target.value, unit: next?.unit || l.unit } : l)));
                          }}>
                          <option value="">Choose ingredient…</option>
                          {ingredients.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                        </select>
                        <input className="input" style={{ width: 100 }} type="number" min="0" step="0.01" placeholder="Qty" value={line.quantity}
                          onChange={(e) => setRecipeLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value } : l)))} />
                        <select className="select" style={{ width: 88 }} value={line.unit}
                          onChange={(e) => setRecipeLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, unit: e.target.value } : l)))}>
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <span className="tiny muted" style={{ minWidth: 110 }}>{ing ? `${num(Number(ing.stock_qty).toFixed(1))} ${ing.unit} in stock` : ''}</span>
                        <button className="btn btn-ghost btn-xs" onClick={() => setRecipeLines((prev) => prev.filter((l) => l.key !== line.key))}><Trash2 size={12} /></button>
                      </div>
                    );
                  })}
                  {!recipeLines.length && <div className="notice" style={{ marginBottom: 12 }}><BookOpen size={15} /><span>No ingredients linked. Orders of this item will not consume stock until a recipe exists.</span></div>}
                  <button className="btn btn-secondary btn-sm" onClick={addRecipeLine}><Plus size={14} /> Add ingredient</button>
                  <div className="notice info" style={{ marginTop: 14 }}>
                    <ChefHat size={15} />
                    <span>Stock is checked again when an order is completed. If an ingredient runs out mid-service, the completion is still recorded but the shortfall is clamped at zero.</span>
                  </div>
                </>
              )}
            </SectionCard>
          </div>
        )}

        {tab === 'purchases' && (
          <SectionCard
            title="Purchase records"
            subtitle="Receiving a purchase increases stock and writes inventory movements."
            action={<button className="btn btn-secondary btn-sm" onClick={openPurchase}><Plus size={13} /> Record purchase</button>}
            noPad
          >
            {purchases.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Reference</th><th>Supplier</th><th>Date</th><th>Lines</th><th>Status</th><th className="right">Total</th><th /></tr></thead>
                  <tbody>
                    {purchases.map((p) => (
                      <React.Fragment key={p.id}>
                        <tr>
                          <td className="primary-cell code">{p.reference}</td>
                          <td className="small">{p.supplier_name || '—'}</td>
                          <td className="small">{fmtDate(p.purchase_date)}</td>
                          <td className="num">{p.item_count}</td>
                          <td><Badge tone="green">{titleize(p.status)}</Badge></td>
                          <td className="right num strong">{inr(p.total)}</td>
                          <td className="right"><button className="btn btn-secondary btn-xs" onClick={() => setOpenPurchaseId(openPurchaseId === p.id ? null : p.id)}>{openPurchaseId === p.id ? 'Hide' : 'Details'}</button></td>
                        </tr>
                        {openPurchaseId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--surface-2)', padding: '4px 16px 12px' }}>
                              <table className="tbl compact" style={{ background: 'transparent' }}>
                                <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit cost</th><th className="right">Line total</th></tr></thead>
                                <tbody>
                                  {purchaseLinesFor(p.id).map((line) => (
                                    <tr key={line.id}>
                                      <td>{line.ingredient_name}</td>
                                      <td className="num">{num(line.qty)} {line.unit}</td>
                                      <td className="num">{inr(line.unit_cost)}</td>
                                      <td className="right num">{inr(line.line_total)}</td>
                                    </tr>
                                  ))}
                                  {!purchaseLinesFor(p.id).length && <tr><td colSpan={4} className="small muted">No lines recorded.</td></tr>}
                                </tbody>
                              </table>
                              {p.notes && <div className="tiny muted" style={{ marginTop: 6 }}>{p.notes}</div>}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={Truck} title="No purchases yet" description="Record a supplier purchase to increase stock and see procurement history." action={<button className="btn btn-primary btn-sm" onClick={openPurchase}><Plus size={14} /> Record purchase</button>} />}
          </SectionCard>
        )}

        {tab === 'suppliers' && (
          <>
            <div className="between" style={{ marginBottom: 12 }}>
              <span className="small muted">{suppliers.length} supplier{suppliers.length === 1 ? '' : 's'}</span>
              <button className="btn btn-primary btn-sm" onClick={() => openSupplier()}><Plus size={14} /> Add supplier</button>
            </div>
            <div className="grid g3">
              {suppliers.map((sup) => {
                const supplied = ingredients.filter((i) => i.supplier_id === sup.id);
                return (
                  <div key={sup.id} className="card card-pad">
                    <div className="between" style={{ alignItems: 'flex-start' }}>
                      <div>
                        <div className="strong">{sup.name}</div>
                        <div className="tiny muted">{sup.contact_name || 'No contact name'}</div>
                      </div>
                      <Badge tone={sup.active ? 'green' : 'red'}>{sup.active ? 'Active' : 'Paused'}</Badge>
                    </div>
                    <div className="kv" style={{ marginTop: 10 }}><dt>Phone</dt><dd>{sup.phone || '—'}</dd></div>
                    <div className="kv"><dt>Email</dt><dd className="small">{sup.email || '—'}</dd></div>
                    <div className="kv"><dt>Supplies</dt><dd>{supplied.length} ingredient{supplied.length === 1 ? '' : 's'}</dd></div>
                    <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => openSupplier(sup)}><Edit3 size={13} /> Edit supplier</button>
                  </div>
                );
              })}
              {!suppliers.length && <div className="card" style={{ gridColumn: '1 / -1' }}><EmptyState icon={Truck} title="No suppliers" description="Add suppliers to link ingredients and purchases." action={<button className="btn btn-primary btn-sm" onClick={() => openSupplier()}><Plus size={14} /> Add supplier</button>} /></div>}
            </div>
          </>
        )}

        {tab === 'movements' && (
          <SectionCard title="Inventory movements" subtitle="Purchases, consumption, wastage and manual adjustments" noPad>
            {movements.length ? (
              <div className="table-wrap">
                <table className="tbl compact">
                  <thead><tr><th>When</th><th>Ingredient</th><th>Type</th><th className="right">Change</th><th>Reference</th><th>Note</th></tr></thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="small nowrap">{fmtDateTime(m.created_at)}</td>
                        <td className="primary-cell">{m.ingredient_name}</td>
                        <td><Badge tone={m.type === 'purchase' || m.type === 'return' ? 'green' : m.type === 'wastage' ? 'red' : m.type === 'consumption' ? 'blue' : 'amber'}>{titleize(m.type)}</Badge></td>
                        <td className="right num strong" style={{ color: Number(m.qty_change) >= 0 ? 'var(--green)' : 'var(--red)' }}>{Number(m.qty_change) >= 0 ? '+' : ''}{num(m.qty_change)} {m.unit}</td>
                        <td className="small code">{m.reference_type ? `${titleize(m.reference_type)} ${m.reference_id || ''}` : '—'}</td>
                        <td className="small muted">{m.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon={ClipboardList} title="No movements" description="Purchases and consumption will appear here." />}
          </SectionCard>
        )}
      </div>

      {/* Ingredient modal */}
      <Modal
        open={!!ingredientModal}
        onClose={() => setIngredientModal(null)}
        title={ingredientModal?.editing ? `Edit ${ingredientModal.editing.name}` : 'Add ingredient'}
        subtitle="Stock is only changed through purchases, recipes and stock movements."
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setIngredientModal(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="ingredient-form" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save ingredient'}</button>
          </>
        )}
      >
        {ingredientModal && (
          <form id="ingredient-form" onSubmit={saveIngredient} className="form-grid" style={{ paddingTop: 6 }}>
            <Field label="Name" error={errors.name} className="full">
              <input className="input" value={ingredientModal.form.name} onChange={(e) => setIngredientModal({ ...ingredientModal, form: { ...ingredientModal.form, name: e.target.value } })} placeholder="e.g. Arabica beans" />
            </Field>
            <Field label="Category">
              <input className="input" value={ingredientModal.form.category} onChange={(e) => setIngredientModal({ ...ingredientModal, form: { ...ingredientModal.form, category: e.target.value } })} />
            </Field>
            <Field label="Unit" error={errors.unit}>
              <select className="select" value={ingredientModal.form.unit} onChange={(e) => setIngredientModal({ ...ingredientModal, form: { ...ingredientModal.form, unit: e.target.value } })}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Opening stock" hint={ingredientModal.editing ? 'Use a stock movement to change existing stock.' : 'Creates an opening balance movement.'}>
              <input className="input" type="number" min="0" step="0.01" disabled={!!ingredientModal.editing} value={ingredientModal.form.stockQty} onChange={(e) => setIngredientModal({ ...ingredientModal, form: { ...ingredientModal.form, stockQty: e.target.value } })} />
            </Field>
            <Field label="Minimum level">
              <input className="input" type="number" min="0" step="0.01" value={ingredientModal.form.minStock} onChange={(e) => setIngredientModal({ ...ingredientModal, form: { ...ingredientModal.form, minStock: e.target.value } })} />
            </Field>
            <Field label="Cost per unit (₹)">
              <input className="input" type="number" min="0" step="0.01" value={ingredientModal.form.costPerUnit} onChange={(e) => setIngredientModal({ ...ingredientModal, form: { ...ingredientModal.form, costPerUnit: e.target.value } })} />
            </Field>
            <Field label="Supplier">
              <select className="select" value={ingredientModal.form.supplierId} onChange={(e) => setIngredientModal({ ...ingredientModal, form: { ...ingredientModal.form, supplierId: e.target.value } })}>
                <option value="">No supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="full flex items-center gap-12">
              <Toggle checked={ingredientModal.form.active} onChange={(v) => setIngredientModal({ ...ingredientModal, form: { ...ingredientModal.form, active: v } })} />
              <span className="small muted">{ingredientModal.form.active ? 'Active ingredient' : 'Paused — hidden from recipe pickers'}</span>
            </div>
          </form>
        )}
      </Modal>

      {/* Stock movement modal */}
      <Modal
        open={!!movementModal}
        onClose={() => setMovementModal(null)}
        title={movementModal ? `Stock movement · ${movementModal.name}` : 'Stock movement'}
        subtitle={movementModal ? `Current stock: ${num(movementModal.stock_qty)} ${movementModal.unit}` : undefined}
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setMovementModal(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={saveMovement} disabled={saving || !(Number(movementForm.qty) > 0)}><Check size={14} /> Record movement</button>
          </>
        )}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Movement type">
            <select className="select" value={movementForm.type} onChange={(e) => setMovementForm({ ...movementForm, type: e.target.value })}>
              {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{titleize(t)}</option>)}
            </select>
          </Field>
          <Field label={`Quantity (${movementModal?.unit || 'units'})`} hint={movementForm.type === 'return' ? 'Adds stock back after a return.' : 'Reduces stock. Use Wastage for spoilage or Adjustment for a stock-count correction.'}>
            <input className="input" type="number" min="0.001" step="0.001" value={movementForm.qty} onChange={(e) => setMovementForm({ ...movementForm, qty: e.target.value })} />
          </Field>
          <Field label="Note">
            <input className="input" value={movementForm.note} onChange={(e) => setMovementForm({ ...movementForm, note: e.target.value })} placeholder="Spilled during service, stock count correction…" />
          </Field>
          <div className="notice warn"><Warehouse size={15} /><span>Every movement writes a permanent audit row with your name and timestamp.</span></div>
        </div>
      </Modal>

      {/* Purchase modal */}
      <Modal
        open={purchaseModal}
        onClose={() => setPurchaseModal(false)}
        title="Record a purchase"
        subtitle="Receiving stock increases quantities and updates the average unit cost."
        size="wide"
        footer={(
          <>
            <div className="small muted" style={{ marginRight: 'auto' }}>Total <strong style={{ color: 'var(--ink)' }}>{inr(purchaseTotal)}</strong></div>
            <button className="btn btn-secondary" onClick={() => setPurchaseModal(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={savePurchase} disabled={saving}>{saving ? 'Saving…' : 'Record purchase'}</button>
          </>
        )}
      >
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <Field label="Supplier">
            <select className="select" value={purchaseForm.supplierId} onChange={(e) => setPurchaseForm({ ...purchaseForm, supplierId: e.target.value })}>
              <option value="">No supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Purchase date">
            <input className="input" type="date" value={purchaseForm.date} onChange={(e) => setPurchaseForm({ ...purchaseForm, date: e.target.value })} />
          </Field>
          <Field label="Notes" className="full">
            <input className="input" value={purchaseForm.notes} onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} placeholder="Invoice number, delivery note…" />
          </Field>
        </div>

        <h4 className="card-title" style={{ marginBottom: 8 }}>Purchase lines</h4>
        {purchaseLines.map((line) => (
          <div key={line.key} className="flex gap-8 items-center wrap" style={{ marginBottom: 7 }}>
            <select className="select" style={{ flex: 2, minWidth: 180 }} value={line.ingredientId}
              onChange={(e) => {
                const ing = ingredients.find((i) => i.id === Number(e.target.value));
                updatePurchaseLine(line.key, { ingredientId: e.target.value, unitCost: ing?.cost_per_unit ?? 0 });
              }}>
              <option value="">Choose ingredient…</option>
              {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
            </select>
            <input className="input" style={{ width: 100 }} type="number" min="0.001" step="0.001" placeholder="Qty" value={line.qty} onChange={(e) => updatePurchaseLine(line.key, { qty: e.target.value })} />
            <input className="input" style={{ width: 120 }} type="number" min="0" step="0.01" placeholder="Unit cost" value={line.unitCost} onChange={(e) => updatePurchaseLine(line.key, { unitCost: e.target.value })} />
            <span className="small strong" style={{ minWidth: 80, textAlign: 'right' }}>{inr((Number(line.qty) || 0) * (Number(line.unitCost) || 0))}</span>
            <button className="btn btn-ghost btn-xs" onClick={() => setPurchaseLines((prev) => prev.filter((l) => l.key !== line.key))}><Trash2 size={12} /></button>
          </div>
        ))}
        <button className="btn btn-secondary btn-sm" onClick={() => setPurchaseLines((prev) => [...prev, { key: `l${Date.now()}`, ingredientId: '', qty: '', unitCost: 0 }])}><Plus size={14} /> Add line</button>
      </Modal>

      {/* Supplier modal */}
      <Modal
        open={supplierModal}
        onClose={() => setSupplierModal(false)}
        title={supplierForm.editing ? `Edit ${supplierForm.editing.name}` : 'Add supplier'}
        size="slim"
        footer={(
          <>
            <button className="btn btn-secondary" onClick={() => setSupplierModal(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" form="supplier-form" type="submit" disabled={saving}>Save supplier</button>
          </>
        )}
      >
        <form id="supplier-form" onSubmit={saveSupplier} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
          <Field label="Supplier name"><input className="input" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} placeholder="e.g. Blue Tokai Roasters" /></Field>
          <Field label="Contact name"><input className="input" value={supplierForm.contactName} onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })} /></Field>
          <div className="form-grid">
            <Field label="Phone"><input className="input" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} /></Field>
          </div>
          <Field label="Address"><textarea className="textarea" rows={2} value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} /></Field>
          <Field label="Notes"><input className="input" value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} /></Field>
          <div className="flex items-center gap-12">
            <Toggle checked={supplierForm.active} onChange={(v) => setSupplierForm({ ...supplierForm, active: v })} />
            <span className="small muted">{supplierForm.active ? 'Active supplier' : 'Paused'}</span>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.label || 'Confirm'}
        busy={busy}
        onConfirm={confirm?.run}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
