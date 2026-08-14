import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { firstImage } from '../../../hooks/useAgentCatalog';
import {
  createShareLink, emailShareLink, buildShareMessage, formatPrice,
  whatsappHref, smsHref, copyText, toWhatsAppNumber,
} from '../../../services/shareLinkService';

// ── Input class helper (matches ScheduleFollowUpModal / CreateClientModal) ────
const ic = (err) =>
  `w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background text-foreground transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-border'
  }`;

const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp', icon: 'MessageCircle', hint: 'Opens WhatsApp' },
  { value: 'sms',      label: 'SMS',      icon: 'MessageSquare', hint: 'Opens Messages' },
  { value: 'email',    label: 'Email',    icon: 'Mail',          hint: 'We send it' },
  { value: 'copy',     label: 'Copy link', icon: 'Link',         hint: 'Paste anywhere' },
];

const EXPIRY_OPTIONS = [
  { label: '7 days',  days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'Never',   days: 0 },
];

const ShareListingModal = ({
  isOpen,
  onClose,
  asset,
  leads = [],
  agentProfile,
  onShared,
}) => {
  const [form, setForm] = useState({
    leadId: '', name: '', phone: '', email: '', note: '', channel: 'whatsapp', expiresDays: 30,
  });
  const [errors, setErrors]   = useState({});
  const [apiError, setApiError] = useState('');
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState(null);   // { url, link }
  const [copied, setCopied]   = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // A fresh item means a fresh share — never carry the last buyer's details over.
  useEffect(() => {
    if (!isOpen) return;
    setForm({ leadId: '', name: '', phone: '', email: '', note: '', channel: 'whatsapp', expiresDays: 30 });
    setErrors({});
    setApiError('');
    setResult(null);
    setCopied(false);
    setEmailSent(false);
  }, [isOpen, asset?.id]);

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    setErrors(p => ({ ...p, [k]: '' }));
    setApiError('');
  };

  const openLeads = useMemo(() => (leads || []).filter(l => l.stage !== 'closed'), [leads]);

  const handleLeadPick = (leadId) => {
    const lead = (leads || []).find(l => l.id === leadId);
    setForm(p => ({
      ...p,
      leadId,
      name:  lead?.full_name || p.name,
      phone: lead?.phone     || p.phone,
      email: lead?.email     || p.email,
    }));
    setErrors({});
  };

  const message = useMemo(() => buildShareMessage({
    agentName:  agentProfile?.full_name,
    assetTitle: asset?.description,
    price:      asset?.selling_price,
    location:   asset?.location,
    url:        result?.url,
    note:       form.note.trim(),
  }), [agentProfile, asset, result, form.note]);

  const validate = () => {
    const e = {};
    if (form.channel === 'whatsapp' && !toWhatsAppNumber(form.phone)) {
      e.phone = 'WhatsApp needs a phone number (e.g. 0712 345 678)';
    }
    if (form.channel === 'sms' && !form.phone.trim()) {
      e.phone = 'Add the phone number to text';
    }
    if (form.channel === 'email') {
      if (!form.email.trim()) e.email = 'Add the email address to send to';
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = 'That email does not look right';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setBusy(true);
    setApiError('');
    try {
      const created = await createShareLink({
        assetId:        asset?.id,
        leadId:         form.leadId || null,
        recipientName:  form.name.trim()  || null,
        recipientPhone: form.phone.trim() || null,
        recipientEmail: form.email.trim() || null,
        channel:        form.channel,
        note:           form.note.trim()  || null,
        expiresDays:    Number(form.expiresDays),
      });
      setResult(created);
      onShared?.(created);
    } catch (err) {
      setApiError(err?.message || 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    const ok = await copyText(result?.url || '');
    setCopied(ok);
    if (!ok) setApiError('Could not copy automatically — select the link and copy it.');
    else setTimeout(() => setCopied(false), 2500);
  };

  const handleSendEmail = async () => {
    setBusy(true);
    setApiError('');
    try {
      await emailShareLink({
        to:            form.email.trim(),
        recipientName: form.name.trim(),
        agentName:     agentProfile?.full_name,
        agentPhone:    agentProfile?.phone,
        assetName:     asset?.description,
        price:         asset?.selling_price,
        location:      asset?.location,
        note:          form.note.trim(),
        url:           result?.url,
      });
      setEmailSent(true);
    } catch (err) {
      setApiError(err?.message || 'The email did not send.');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen || !asset) return null;

  const cover = firstImage(asset);
  const price = formatPrice(asset?.selling_price);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="Share2" size={18} color="var(--color-primary)" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Share this listing</h2>
              <p className="text-xs text-muted-foreground">
                Any enquiry from your link comes back as your lead
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* What is being shared */}
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <div className="w-16 h-16 rounded-xl bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
            {cover ? (
              <Image src={cover} alt={asset.description} className="w-full h-full object-cover" />
            ) : (
              <Icon name="Package" size={22} color="var(--color-muted-foreground)" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{asset.description}</p>
            <p className="text-xs text-muted-foreground truncate">
              {[price, asset.location, asset.asset_code].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        {/* ── Result ── */}
        {result ? (
          <div className="px-6 py-5 space-y-5">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <Icon name="CheckCircle" size={18} color="#059669" />
              <p className="text-sm font-semibold text-emerald-800">
                Your link is ready{form.name.trim() ? ` for ${form.name.trim()}` : ''}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                The link
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={result.url}
                  onFocus={e => e.target.select()}
                  className="flex-1 px-3 py-2.5 text-sm border border-border rounded-xl bg-muted/40 text-foreground font-mono"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    copied ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground hover:opacity-90'
                  }`}
                >
                  <Icon name={copied ? 'Check' : 'Copy'} size={15} color="white" />
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                No account needed — it opens straight to the listing with your contact details on it.
              </p>
            </div>

            {/* Send it */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Send it
              </label>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={whatsappHref(form.phone, message)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)' }}
                >
                  <Icon name="MessageCircle" size={15} color="white" />
                  WhatsApp
                </a>

                <a
                  href={smsHref(form.phone, message)}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                    form.phone.trim()
                      ? 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                      : 'border-border text-muted-foreground/40 pointer-events-none'
                  }`}
                >
                  <Icon name="MessageSquare" size={15} color="currentColor" />
                  SMS
                </a>

                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={busy || emailSent || !form.email.trim()}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all disabled:opacity-40 ${
                    emailSent
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon name={emailSent ? 'Check' : 'Mail'} size={15} color="currentColor" />
                  {emailSent ? 'Email sent' : 'Send email'}
                </button>

                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                >
                  <Icon name="Copy" size={15} color="currentColor" />
                  Copy
                </button>
              </div>
            </div>

            {/* What will be sent */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                Message preview
              </label>
              <pre className="px-3 py-2.5 text-xs text-muted-foreground bg-muted/40 border border-border rounded-xl whitespace-pre-wrap font-sans">
                {message}
              </pre>
            </div>

            {apiError && (
              <p className="text-xs text-red-500">{apiError}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Form ── */
          <div className="px-6 py-5 space-y-5">

            {/* Who */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                Who are you sending it to?
              </label>
              {openLeads.length > 0 && (
                <select
                  value={form.leadId}
                  onChange={e => handleLeadPick(e.target.value)}
                  className={`${ic(false)} mb-2`}
                >
                  <option value="">— An existing lead, or fill in below —</option>
                  {openLeads.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.full_name}{l.phone ? ` · ${l.phone}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Buyer's name (optional)"
                className={ic(errors.name)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  placeholder="0712 345 678"
                  className={ic(errors.phone)}
                />
                {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  placeholder="buyer@example.com"
                  className={ic(errors.email)}
                />
                {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
              </div>
            </div>

            {/* Channel */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">How</label>
              <div className="grid grid-cols-2 gap-2">
                {CHANNELS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => set('channel', c.value)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      form.channel === c.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30'
                    }`}
                  >
                    <Icon name={c.icon} size={14} color="currentColor" />
                    <span className="text-left leading-tight">
                      {c.label}
                      <span className="block text-xs opacity-60 font-normal">{c.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Note */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                A note for them (optional)
              </label>
              <textarea
                rows={3}
                value={form.note}
                onChange={e => set('note', e.target.value)}
                placeholder="Saw this and thought of you — the garden is bigger than the photos suggest."
                className={ic(false)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Shown at the top of the page they open.</p>
            </div>

            {/* Expiry */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Link works for
              </label>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map(o => (
                  <button
                    key={o.days}
                    type="button"
                    onClick={() => set('expiresDays', o.days)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      Number(form.expiresDays) === o.days
                        ? 'bg-primary text-white'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {apiError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
                <Icon name="AlertCircle" size={15} color="#dc2626" />
                <p className="text-xs text-red-700">{apiError}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Icon name="Share2" size={15} color="white" />
                    Create link
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShareListingModal;
