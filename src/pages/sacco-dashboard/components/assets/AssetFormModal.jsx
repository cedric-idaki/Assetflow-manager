/**
 * Register or edit an asset.
 *
 * Grouped the way somebody holding an invoice fills it in — what it is, what it
 * cost, where it lives, what it is worth now — rather than in column order.
 *
 * Two things this form does that a plain CRUD modal would not:
 *
 *   The GL account follows the CATEGORY. That is the join between this register
 *   and the accounts: picking "Motor Vehicles" capitalises the purchase to
 *   1330, so the Balance Sheet's PPE breakdown agrees with the register with
 *   nobody maintaining two lists. It is shown, and overridable, because a
 *   SACCO with a customised chart may genuinely need a different code — but
 *   the default is right for everyone else.
 *
 *   Current value is optional and says so. A blank valuation is not a gap in
 *   the record; it means the register reports book value, which is the honest
 *   answer for an asset nobody has valued. Requiring a number here would get
 *   the cost typed in twice, and then the register would claim a five-year-old
 *   laptop is worth what it cost.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import {
  Modal, Field, TextInput, NumberInput, Select, GhostButton, PrimaryButton, KES,
} from '../_shared';
import {
  ASSET_CATEGORIES, ASSET_STATUSES, VALUATION_BASES, DEPRECIATION_METHODS,
  categoryMeta, validateAsset, isTerminalStatus, bookValue,
} from '../../../../config/assetRegister';

const today = () => new Date().toISOString().slice(0, 10);

export const emptyAssetForm = () => ({
  asset_name: '', category: 'furniture_fittings', description: '',
  acquisition_date: today(), cost: '', residual_value: '',
  useful_life_years: '', method: 'straight_line', gl_code: '',
  current_value: '', valuation_date: '', valuation_basis: 'internal',
  location: '', status: 'in_use', serial_number: '', supplier: '', notes: '',
  disposal_reason: '', disposal_date: '', disposal_proceeds: '',
  paid_from: '1020',
});

/** A saved row back into form state. Numbers become strings; nulls become ''. */
export const assetToForm = (a) => ({
  ...emptyAssetForm(),
  asset_name:        a.asset_name || '',
  category:          a.category || 'other',
  description:       a.description || '',
  acquisition_date:  a.acquisition_date || today(),
  cost:              a.cost ?? '',
  residual_value:    a.residual_value ?? '',
  useful_life_years: a.useful_life_years ?? '',
  method:            a.method || 'straight_line',
  gl_code:           a.gl_code || '',
  current_value:     a.current_value ?? '',
  valuation_date:    a.valuation_date || '',
  valuation_basis:   a.valuation_basis || 'internal',
  location:          a.location || '',
  status:            a.status || 'in_use',
  serial_number:     a.serial_number || '',
  supplier:          a.supplier || '',
  notes:             a.notes || '',
  disposal_reason:   a.disposal_reason || '',
  disposal_date:     a.disposal_date || '',
  disposal_proceeds: a.disposal_proceeds ?? '',
});

const Err = ({ children }) => (
  children ? <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
    <Icon name="AlertCircle" size={12} color="currentColor" />{children}
  </p> : null
);

const SectionTitle = ({ icon, children, hint }) => (
  <div className="sm:col-span-2 pt-1">
    <div className="flex items-center gap-2">
      <Icon name={icon} size={14} color="#1da8c5" />
      <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">{children}</h4>
    </div>
    {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
  </div>
);

const AssetFormModal = ({ open, onClose, onSave, editing = null, saving = false, canPost = false }) => {
  const [form, setForm] = useState(emptyAssetForm);
  const [errors, setErrors] = useState({});
  const [postPurchase, setPostPurchase] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? assetToForm(editing) : emptyAssetForm());
    setErrors({});
    setPostPurchase(false);
  }, [open, editing]);

  const set = (k) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: value }));
    // Clear the marker as soon as the field is touched; re-validating the whole
    // form on every keystroke would light up fields nobody has reached yet.
    setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  };

  // Changing category re-suggests the account and the useful life, but only
  // where the operator has not typed their own — an override must survive.
  const onCategoryChange = (e) => {
    const next = e.target.value;
    setForm((f) => {
      const prev = categoryMeta(f.category);
      return {
        ...f,
        category: next,
        gl_code: !f.gl_code || f.gl_code === prev.gl ? '' : f.gl_code,
        useful_life_years:
          f.useful_life_years === '' || Number(f.useful_life_years) === prev.life
            ? '' : f.useful_life_years,
      };
    });
    setErrors((prev) => ({ ...prev, category: undefined }));
  };

  const meta = categoryMeta(form.category);
  const terminal = isTerminalStatus(form.status);

  // What the ledger will say this is worth once it is saved. Shown live so the
  // difference between "what we paid" and "what it is worth" is visible while
  // the numbers are being entered, not discovered afterwards.
  const preview = useMemo(() => {
    const cost = Number(form.cost) || 0;
    const accumulated = Number(editing?.accumulated_depreciation) || 0;
    return {
      cost,
      accumulated,
      book: bookValue({ cost, accumulated_depreciation: accumulated }),
      current: form.current_value === '' ? null : Number(form.current_value) || 0,
    };
  }, [form.cost, form.current_value, editing]);

  const submit = () => {
    const found = validateAsset(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave(form, { postPurchase: postPurchase && !editing });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? `Edit ${editing.asset_tag || 'asset'}` : 'Register an asset'}
      footer={<>
        <GhostButton onClick={onClose} disabled={saving}>Cancel</GhostButton>
        <PrimaryButton icon="Check" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add to register'}
        </PrimaryButton>
      </>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SectionTitle icon="Package">What is it</SectionTitle>

        <Field label="Asset name *">
          <TextInput value={form.asset_name} onChange={set('asset_name')} placeholder="Toyota Hiace — KDG 123X" />
          <Err>{errors.asset_name}</Err>
        </Field>

        <Field label="Category *">
          <Select value={form.category} onChange={onCategoryChange}>
            {ASSET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <Err>{errors.category}</Err>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea
              rows={2}
              value={form.description}
              onChange={set('description')}
              placeholder="14-seater staff shuttle, bought from Toyota Kenya. Serviced quarterly."
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
            />
          </Field>
        </div>

        <Field label="Serial / registration number">
          <TextInput value={form.serial_number} onChange={set('serial_number')} placeholder="KDG 123X" />
        </Field>

        <Field label="Supplier">
          <TextInput value={form.supplier} onChange={set('supplier')} placeholder="Toyota Kenya Ltd" />
        </Field>

        <SectionTitle icon="Receipt" hint="What was paid, and how the ledger depreciates it.">
          Acquisition
        </SectionTitle>

        <Field label="Acquisition date *">
          <TextInput type="date" value={form.acquisition_date} onChange={set('acquisition_date')} max={today()} />
          <Err>{errors.acquisition_date}</Err>
        </Field>

        <Field label="Purchase value (KES) *">
          <NumberInput value={form.cost} onChange={set('cost')} min="0" step="0.01" placeholder="0.00" />
          <Err>{errors.cost}</Err>
        </Field>

        <Field label="Residual value (KES)">
          <NumberInput value={form.residual_value} onChange={set('residual_value')} min="0" step="0.01" placeholder="0.00" />
          <Err>{errors.residual_value}</Err>
        </Field>

        <Field label={`Useful life (years) — ${meta.label} default is ${meta.life}`}>
          <NumberInput
            value={form.useful_life_years}
            onChange={set('useful_life_years')}
            min="0.5" step="0.5" placeholder={String(meta.life)}
          />
          <Err>{errors.useful_life_years}</Err>
        </Field>

        <Field label="Depreciation method">
          <Select value={form.method} onChange={set('method')}>
            {DEPRECIATION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>

        <Field label={`Asset account — defaults to ${meta.gl} for ${meta.label}`}>
          <TextInput value={form.gl_code} onChange={set('gl_code')} placeholder={meta.gl} />
        </Field>

        {!editing && (
          <div className="sm:col-span-2 rounded-xl border border-border p-3 space-y-2">
            <label className={`flex items-start gap-2.5 ${canPost ? 'cursor-pointer' : 'opacity-60'}`}>
              <input
                type="checkbox"
                checked={postPurchase}
                disabled={!canPost}
                onChange={(e) => setPostPurchase(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
              />
              <span>
                <span className="block text-xs font-semibold text-foreground">
                  Also post the purchase to the ledger
                </span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  {canPost
                    ? `Debits ${form.gl_code || meta.gl} and credits the bank, dated ${form.acquisition_date || 'the acquisition date'}. Leave this off for assets the SACCO already owned — posting them again would invent spending that never happened this period.`
                    : 'Unavailable until the Finance Hub chart of accounts has been seeded.'}
                </span>
              </span>
            </label>
            {postPurchase && canPost && (
              <Field label="Paid from (credit account)">
                <TextInput value={form.paid_from} onChange={set('paid_from')} placeholder="1020" />
              </Field>
            )}
          </div>
        )}

        <SectionTitle icon="LineChart" hint="Optional. Left blank, the register reports book value instead.">
          What it is worth now
        </SectionTitle>

        <Field label="Current value (KES)">
          <NumberInput value={form.current_value} onChange={set('current_value')} min="0" step="0.01" placeholder="Not valued" />
          <Err>{errors.current_value}</Err>
        </Field>

        <Field label="Valued on">
          <TextInput type="date" value={form.valuation_date} onChange={set('valuation_date')} max={today()} />
          <Err>{errors.valuation_date}</Err>
        </Field>

        <Field label="Valuation basis">
          <Select value={form.valuation_basis} onChange={set('valuation_basis')}>
            {VALUATION_BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </Select>
        </Field>

        <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs space-y-1 self-end">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Cost</span>
            <span className="font-mono text-foreground">{KES(preview.cost)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Less depreciation</span>
            <span className="font-mono text-foreground">{KES(preview.accumulated)}</span>
          </div>
          <div className="flex justify-between gap-3 pt-1 border-t border-border">
            <span className="font-semibold text-foreground">
              {preview.current == null ? 'Register reports' : 'Book value'}
            </span>
            <span className="font-mono font-semibold text-foreground">{KES(preview.book)}</span>
          </div>
          {preview.current != null && (
            <div className="flex justify-between gap-3">
              <span className="font-semibold text-primary">Register reports</span>
              <span className="font-mono font-semibold text-primary">{KES(preview.current)}</span>
            </div>
          )}
        </div>

        <SectionTitle icon="MapPin">Where it is, and how it is doing</SectionTitle>

        <Field label="Location">
          <TextInput value={form.location} onChange={set('location')} placeholder="Head office — Nakuru branch" />
        </Field>

        <Field label="Status">
          <Select value={form.status} onChange={set('status')}>
            {ASSET_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>

        {terminal && (
          <>
            <div className="sm:col-span-2 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <Icon name="AlertTriangle" size={16} color="#ca8a04" />
              <p className="text-xs text-amber-800">
                Marking this <strong>{form.status.replace(/_/g, ' ')}</strong> stops the period-end job charging any
                further depreciation on it, from the disposal date onward. The asset stays in the register — nothing is
                deleted.
              </p>
            </div>
            <Field label="Disposal date">
              <TextInput type="date" value={form.disposal_date} onChange={set('disposal_date')} max={today()} />
            </Field>
            <Field label="Proceeds (KES)">
              <NumberInput value={form.disposal_proceeds} onChange={set('disposal_proceeds')} min="0" step="0.01" placeholder="0.00" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="What happened to it *">
                <TextInput
                  value={form.disposal_reason}
                  onChange={set('disposal_reason')}
                  placeholder="Sold to Kamau Motors at auction, board resolution 14/2026"
                />
                <Err>{errors.disposal_reason}</Err>
              </Field>
            </div>
          </>
        )}

        <div className="sm:col-span-2">
          <Field label="Internal notes">
            <textarea
              rows={2}
              value={form.notes}
              onChange={set('notes')}
              placeholder="Anything the next person to open this record should know."
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
};

export default AssetFormModal;
