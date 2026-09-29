import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { useToast } from '../../../components/Toast';
import { useTenantBranding, formFromBranding, emptyBrandingForm } from '../../../hooks/useTenantBranding';
import { LOGO_ACCEPT, prepareLogo } from '../../../utils/logoImage';
import { LETTERHEAD_STYLES, letterheadHtml, normaliseLetterhead } from '../../../utils/letterhead';
import { html, rawHtml } from '../../../utils/htmlEscape';
import { buildPaymentReceipt, renderAccountingDocument } from '../../../utils/accountingDocument';
import { isValidKraPin, normaliseKraPin } from '../../../config/etimsCodes';

/**
 * BRANDING — the business identity on every document.
 *
 * What a tenant sets here heads its receipts, invoices, vouchers, payslips and
 * statements: the logo, a motto, and the contact details a customer holding
 * the paper needs. The business name and registration number are NOT
 * editable here — they are the legal identity registration and KYC captured,
 * and branding must not be a way around them.
 *
 * Every text field is optional. Left blank, the document prints what
 * registration captured instead, and the field says so, so nobody has to
 * guess what an empty box means on paper.
 *
 * The preview is not a mock-up: it renders the same letterhead markup the
 * printed documents use, and "Download sample PDF" runs the real voucher
 * painter over the unsaved draft.
 */

const MOTTO_MAX = 120;

const inputCls =
  'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground '
  + 'placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none';

const Field = ({ label, hint, error, htmlFor, children, counter }) => (
  <div>
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</label>
      {counter}
    </div>
    {children}
    {error
      ? <span className="mt-1 block text-xs text-red-600">{error}</span>
      : hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
  </div>
);

const Section = ({ title, subtitle, children }) => (
  <section className="rounded-lg border border-border bg-card p-5">
    <h3 className="text-base font-semibold text-foreground">{title}</h3>
    {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

/** "From your registration: …" — what prints if the field stays blank. */
const fallbackHint = (value, what = 'registration') =>
  (value ? `Leave blank to print the one from your ${what}: ${value}` : 'Optional.');

// ── Client-side checks — the database repeats every one of them ─────────────
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const WEBSITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]{1,5})?(\/\S*)?$/i;
const PHONE = /^[0-9+() /,.-]{7,40}$/;

export const validateBrandingForm = (form) => {
  const errors = {};
  const t = (k) => String(form[k] || '').trim();
  if (t('motto').length > MOTTO_MAX) errors.motto = `At most ${MOTTO_MAX} characters.`;
  if (t('phone') && !PHONE.test(t('phone'))) errors.phone = 'Digits, spaces and + ( ) - / , only.';
  if (t('email') && !EMAIL.test(t('email'))) errors.email = 'That email address does not look right.';
  if (t('website') && !WEBSITE.test(t('website').replace(/\/+$/, ''))) errors.website = 'That website address does not look right.';
  if (t('physicalAddress').length > 160) errors.physicalAddress = 'At most 160 characters.';
  if (t('postalAddress').length > 80) errors.postalAddress = 'At most 80 characters.';
  if (t('kraPin') && !isValidKraPin(t('kraPin'))) errors.kraPin = 'A or P, nine digits and a letter, e.g. P051234567X.';
  return errors;
};

// ── Preview documents ────────────────────────────────────────────────────────
const PREVIEW_PAGE_STYLES = `
  :root { color-scheme: light; }
  html, body { background: #fff; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 22px 26px; }
  ${LETTERHEAD_STYLES}
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
          border-bottom: 3px solid #1A56DB; padding-bottom: 14px; margin-bottom: 14px; }
  .title { font-size: 20px; font-weight: 800; color: #1A56DB; text-align: right; white-space: nowrap; }
  .muted { color: #666; font-size: 11px; text-align: right; }
  .row { display: flex; justify-content: space-between; font-size: 12px; padding: 6px 0; border-bottom: 1px solid #eee; }
  .ghost { height: 8px; border-radius: 3px; background: #eef1f5; margin: 8px 0; }
`;

const PREVIEW_ROLL_STYLES = `
  :root { color-scheme: light; }
  html, body { background: #fff; margin: 0; }
  body { width: 72mm; margin: 0 auto; padding: 10px 0; font-family: "Courier New", Courier, monospace; font-size: 11px; color: #000; }
  ${LETTERHEAD_STYLES}
  .title { text-align: center; font-weight: 700; letter-spacing: .12em; margin: 8px 0 4px; }
  .rule { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; }
`;

const previewPage = (lh) => html`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>${rawHtml(PREVIEW_PAGE_STYLES)}</style></head><body>
  <div class="head">
    ${rawHtml(letterheadHtml(lh))}
    <div><div class="title">OFFICIAL RECEIPT</div><div class="muted">RCT-000123</div><div class="muted">Date: today</div></div>
  </div>
  <div class="row"><span>Received from</span><span>Sample Customer</span></div>
  <div class="row"><span>Amount paid</span><span>KES 25,000.00</span></div>
  <div class="ghost" style="width:70%"></div><div class="ghost" style="width:45%"></div>
</body></html>`;

const previewRoll = (lh) => html`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>${rawHtml(PREVIEW_ROLL_STYLES)}</style></head><body>
  ${rawHtml(letterheadHtml(lh, { variant: 'roll' }))}
  <div class="title">OFFICIAL RECEIPT</div>
  <div class="rule"></div>
  <div class="row"><span>Receipt</span><span>RCT-000123</span></div>
  <div class="row"><span>Customer</span><span>Sample</span></div>
  <div class="rule"></div>
  <div class="row"><span>TOTAL</span><span>KES 25,000.00</span></div>
</body></html>`;

/** The paper each preview is drawn on, in CSS px, before it is scaled to fit. */
const PREVIEW_SIZE = {
  page: { width: 760, height: 330 },
  roll: { width: 320, height: 380 },
};

// ── The tab ─────────────────────────────────────────────────────────────────
const BrandingTab = () => {
  const toast = useToast();
  const {
    raw, logo: savedLogo, branding, defaults, loading, error, reload, save,
  } = useTenantBranding();

  const [form, setForm]             = useState(emptyBrandingForm);
  const [newLogo, setNewLogo]       = useState(null);   // prepareLogo() output
  const [removeLogo, setRemoveLogo] = useState(false);
  const [preparing, setPreparing]   = useState(false);
  const [logoError, setLogoError]   = useState('');
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState('');
  const [previewKind, setPreviewKind] = useState('page');
  const [sampling, setSampling]     = useState(false);
  const fileRef = useRef(null);

  // The preview is drawn at the paper's own width and scaled to fit the
  // column, so a narrow screen shows the page shrunk — not re-flowed into a
  // layout no printed document will ever have.
  // A callback ref, because the preview mounts only once the branding has
  // loaded — an effect run at first render would find nothing to observe.
  const [wrapWidth, setWrapWidth] = useState(0);
  const observerRef = useRef(null);
  const frameWrapRef = useCallback((el) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWrapWidth(entry.contentRect.width));
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  // Load the saved values into the form whenever they (re)arrive.
  useEffect(() => {
    setForm(formFromBranding(branding));
    setNewLogo(null);
    setRemoveLogo(false);
  }, [branding]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const errors = useMemo(() => validateBrandingForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  const savedForm = useMemo(() => formFromBranding(branding), [branding]);
  const dirty = Boolean(newLogo) || removeLogo
    || Object.keys(savedForm).some((k) => String(savedForm[k] || '') !== String(form[k] || ''));

  /** The letterhead as it will print once saved — blanks fall back, as on paper. */
  const draft = useMemo(() => normaliseLetterhead({
    admin_id:         raw?.admin_id,
    kind:             raw?.kind,
    name:             raw?.name,
    registration_no:  raw?.registration_no,
    motto:            form.motto,
    phone:            form.phone || defaults.phone,
    email:            form.email || defaults.email,
    website:          form.website,
    physical_address: form.physicalAddress || defaults.physicalAddress,
    postal_address:   form.postalAddress,
    kra_pin:          normaliseKraPin(form.kraPin) || defaults.kraPin,
    logo:             removeLogo ? null : (newLogo?.image || savedLogo),
  }), [raw, form, defaults, newLogo, removeLogo, savedLogo]);

  const previewDoc = useMemo(
    () => (draft ? (previewKind === 'roll' ? previewRoll(draft) : previewPage(draft)) : ''),
    [draft, previewKind],
  );

  const onPickLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';            // picking the same file again still fires
    if (!file) return;
    setLogoError('');
    setPreparing(true);
    try {
      const prepared = await prepareLogo(file);
      setNewLogo(prepared);
      setRemoveLogo(false);
    } catch (err) {
      setLogoError(err?.message || 'That image could not be used.');
    } finally {
      setPreparing(false);
    }
  };

  const onRemoveLogo = () => {
    setNewLogo(null);
    setRemoveLogo(Boolean(savedLogo || raw?.logo_path));
  };

  const onDiscard = () => {
    setForm(formFromBranding(branding));
    setNewLogo(null);
    setRemoveLogo(false);
    setSaveError('');
    setLogoError('');
  };

  const onSave = async () => {
    if (hasErrors) return;
    setSaving(true);
    setSaveError('');
    try {
      await save({
        form: { ...form, kraPin: normaliseKraPin(form.kraPin) },
        newLogo,
        removeLogo,
      });
      toast.success('Your documents will carry the new branding from now on.', 'Branding saved');
    } catch (err) {
      setSaveError(err?.message || 'The branding could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const onSamplePdf = async () => {
    setSampling(true);
    try {
      const model = buildPaymentReceipt({
        txn: {
          transactionId: 'SAMPLE-0001',
          status: 'completed',
          amount: 25000,
          date: new Date().toISOString(),
          clientName: 'Sample Customer',
          accountNumber: 'AF-2026-000123',
          paymentMethod: 'mpesa',
          reference: 'SAMPLE',
          assetName: 'This is a sample — not a real receipt',
        },
        company: draft,
      });
      const doc = await renderAccountingDocument(model, { letterhead: draft });
      doc.save('Branding_Sample_Receipt.pdf');
    } catch (err) {
      toast.error(err?.message || 'The sample could not be generated.', 'Sample PDF');
    } finally {
      setSampling(false);
    }
  };

  if (loading && !raw) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" /> Loading your branding…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <div className="flex items-start gap-2">
          <Icon name="AlertCircle" size={18} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Branding could not be loaded.</p>
            <p className="mt-1">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={reload}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }

  const shownLogo = removeLogo ? null : (newLogo?.image || savedLogo);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Branding</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Your logo, motto and contact details head every receipt, invoice, voucher, payslip and
          statement this system produces — including the ones your staff, clients and members
          download themselves.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        {/* ── The form ─────────────────────────────────────────────────── */}
        <div className="space-y-5 min-w-0">
          <Section
            title="Logo"
            subtitle="A PNG with a transparent background prints best. It is resized for receipts and invoices automatically."
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div
                className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-border bg-white p-3 sm:w-44"
                style={{ backgroundImage: 'linear-gradient(45deg,#f3f4f6 25%,transparent 25%),linear-gradient(-45deg,#f3f4f6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f3f4f6 75%),linear-gradient(-45deg,transparent 75%,#f3f4f6 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}
              >
                {shownLogo
                  ? <img src={shownLogo.src} alt="Your logo" className="max-h-full max-w-full object-contain" />
                  : <span className="text-center text-xs text-gray-500">No logo yet</span>}
              </div>

              <div className="space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={LOGO_ACCEPT}
                  className="hidden"
                  onChange={onPickLogo}
                  aria-label="Upload a logo"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={preparing}
                    icon={<Icon name="Upload" size={15} />}
                    onClick={() => fileRef.current?.click()}
                  >
                    {shownLogo ? 'Replace logo' : 'Upload logo'}
                  </Button>
                  {shownLogo && (
                    <Button variant="ghost" size="sm" icon={<Icon name="Trash2" size={15} />} onClick={onRemoveLogo}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">PNG, JPEG, WEBP or SVG, up to 5 MB.</p>
                {newLogo && <p className="text-xs text-amber-700">New logo — not saved yet.</p>}
                {removeLogo && <p className="text-xs text-amber-700">The logo will be removed when you save.</p>}
                {logoError && <p className="text-xs text-red-600">{logoError}</p>}
              </div>
            </div>
          </Section>

          <Section title="Motto" subtitle="A short line printed under your name, such as a slogan or tagline.">
            <Field
              label="Motto or tagline"
              htmlFor="brand-motto"
              error={errors.motto}
              counter={<span className={`text-xs ${form.motto.length > MOTTO_MAX ? 'text-red-600' : 'text-muted-foreground'}`}>{form.motto.length}/{MOTTO_MAX}</span>}
            >
              <input id="brand-motto" className={inputCls} value={form.motto} onChange={set('motto')}
                placeholder="e.g. Quality you can trust" maxLength={MOTTO_MAX + 20} />
            </Field>
          </Section>

          <Section
            title="Contact details"
            subtitle="How a customer holding one of your documents reaches you."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone" htmlFor="brand-phone" error={errors.phone} hint={fallbackHint(defaults.phone)}>
                <input id="brand-phone" className={inputCls} value={form.phone} onChange={set('phone')}
                  placeholder={defaults.phone || '0712 345 678'} inputMode="tel" />
              </Field>
              <Field label="Email" htmlFor="brand-email" error={errors.email} hint={fallbackHint(defaults.email)}>
                <input id="brand-email" className={inputCls} value={form.email} onChange={set('email')}
                  placeholder={defaults.email || 'info@yourbusiness.co.ke'} inputMode="email" />
              </Field>
              <Field label="Website" htmlFor="brand-website" error={errors.website} hint="Optional.">
                <input id="brand-website" className={inputCls} value={form.website} onChange={set('website')}
                  placeholder="www.yourbusiness.co.ke" inputMode="url" />
              </Field>
              <Field label="Postal address" htmlFor="brand-postal" error={errors.postalAddress} hint="Optional.">
                <input id="brand-postal" className={inputCls} value={form.postalAddress} onChange={set('postalAddress')}
                  placeholder="P.O. Box 12345-00100, Nairobi" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Physical address" htmlFor="brand-physical" error={errors.physicalAddress}
                  hint={fallbackHint(defaults.physicalAddress)}>
                  <input id="brand-physical" className={inputCls} value={form.physicalAddress} onChange={set('physicalAddress')}
                    placeholder={defaults.physicalAddress || 'Building, street, town'} />
                </Field>
              </div>
            </div>
          </Section>

          <Section
            title="Tax details"
            subtitle="Printed on tax invoices and receipts, where a buyer needs it to claim the VAT they paid."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="KRA PIN" htmlFor="brand-pin" error={errors.kraPin}
                hint={fallbackHint(defaults.kraPin, 'KRA eTIMS setup')}>
                <input id="brand-pin" className={`${inputCls} uppercase`} value={form.kraPin}
                  onChange={(e) => setForm((f) => ({ ...f, kraPin: e.target.value.toUpperCase() }))}
                  placeholder={defaults.kraPin || 'P051234567X'} maxLength={14} />
              </Field>
              <div className="text-sm">
                <div className="font-medium text-foreground">Business name and registration</div>
                <p className="mt-1 text-foreground">{raw?.name || '—'}</p>
                <p className="text-muted-foreground">{raw?.registration_no ? `Reg No: ${raw.registration_no}` : 'No registration number on file'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  These come from your registration and cannot be changed here.
                </p>
              </div>
            </div>
          </Section>

          {saveError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <Icon name="AlertCircle" size={16} className="mt-0.5 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onSave} loading={saving} disabled={!dirty || hasErrors || preparing}
              icon={<Icon name="Save" size={16} />}>
              Save branding
            </Button>
            <Button variant="outline" onClick={onDiscard} disabled={!dirty || saving}>Discard changes</Button>
            {!dirty && raw?.updated_at && (
              <span className="text-xs text-muted-foreground">
                Last saved {new Date(raw.updated_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* ── The preview ──────────────────────────────────────────────── */}
        <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <Section title="How it prints" subtitle={dirty ? 'Showing your unsaved changes.' : 'Showing what your documents carry now.'}>
            <div className="mb-3 inline-flex rounded-lg border border-border p-0.5 text-xs" role="tablist">
              {[
                { id: 'page', label: 'Invoice / A4' },
                { id: 'roll', label: 'Till receipt (80mm)' },
              ].map((o) => (
                <button key={o.id} type="button" role="tab" aria-selected={previewKind === o.id}
                  onClick={() => setPreviewKind(o.id)}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors ${previewKind === o.id
                    ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                  {o.label}
                </button>
              ))}
            </div>

            {(() => {
              const paper = PREVIEW_SIZE[previewKind];
              const scale = wrapWidth ? Math.min(1, wrapWidth / paper.width) : 1;
              const offset = wrapWidth > paper.width ? (wrapWidth - paper.width) / 2 : 0;
              return (
                <div ref={frameWrapRef} className="overflow-hidden rounded-md border border-border bg-white"
                  style={{ height: Math.ceil(paper.height * scale) }}>
                  <iframe
                    title="Letterhead preview"
                    sandbox=""
                    srcDoc={previewDoc}
                    className="block"
                    style={{
                      width: paper.width, height: paper.height, border: 0,
                      marginLeft: offset, transform: `scale(${scale})`, transformOrigin: 'top left',
                    }}
                  />
                </div>
              );
            })()}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" loading={sampling} onClick={onSamplePdf}
                icon={<Icon name="FileDown" size={15} />}>
                Download sample PDF
              </Button>
              <span className="text-xs text-muted-foreground">
                A receipt drawn by the same code as your real ones.
              </span>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

export default BrandingTab;
