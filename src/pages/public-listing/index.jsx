/**
 * Public listing page — /listing/:token
 *
 * What a potential buyer opens when a sales agent sends them a link. No
 * account, no login: the token in the URL is the whole credential, and every
 * byte on this page comes from the `listing-public` Edge Function, which
 * decides what is safe to show. Nothing here queries the database directly —
 * an anonymous visitor has no rights to any of these tables, and should not.
 *
 * The agent's card is the point. A listing anyone could have sent is a
 * brochure; a listing with the agent's name and number on it is a lead with an
 * owner, which is what makes the commission attributable.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import { supabase } from '../../lib/supabase';

const fmtPrice = (value, currency = 'KES') => {
  const n = Number(value || 0);
  if (!n) return null;
  return new Intl.NumberFormat('en-KE', {
    style: 'currency', currency, minimumFractionDigits: 0,
  }).format(n);
};

const telHref  = (phone) => `tel:${String(phone || '').replace(/\s/g, '')}`;
const waHref   = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  const msisdn = digits.startsWith('0') && digits.length === 10 ? `254${digits.slice(1)}` : digits;
  return `https://wa.me/${msisdn}`;
};

/**
 * Call the public backend.
 *
 * The audience here is a member of the public, not a developer. The server's
 * own wording ("This link has expired or been withdrawn") is written for them
 * and is passed straight through; anything else — a transport failure, a
 * function that is not deployed — becomes plain language, because
 * "Failed to send a request to the Edge Function" tells a buyer nothing.
 * `retryable` lets the page offer a try-again button only when trying again
 * could actually help.
 */
async function callListingPublic(body) {
  const { data, error } = await supabase.functions.invoke('listing-public', { body });

  if (error) {
    let serverMessage = null;
    try {
      const j = await error.context?.json?.();
      if (j?.error) serverMessage = j.error;
    } catch { /* no JSON body — a transport failure */ }

    if (serverMessage) throw new Error(serverMessage);

    const err = new Error('We could not reach the listing just now. Check your connection and try again.');
    err.retryable = true;
    throw err;
  }

  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Image gallery ────────────────────────────────────────────────────────────
const Gallery = ({ images = [], title }) => {
  const [active, setActive] = useState(0);

  if (!images.length) {
    return (
      <div className="w-full h-64 sm:h-96 bg-slate-100 rounded-2xl flex items-center justify-center">
        <Icon name="Image" size={40} color="#94a3b8" />
      </div>
    );
  }

  return (
    <div>
      <div className="w-full h-64 sm:h-96 bg-slate-100 rounded-2xl overflow-hidden">
        <Image
          src={images[active]}
          alt={`${title} — photo ${active + 1}`}
          className="w-full h-full object-cover"
        />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={src + i}
              onClick={() => setActive(i)}
              className={`w-20 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-colors ${
                i === active ? 'border-blue-600' : 'border-transparent hover:border-slate-300'
              }`}
              aria-label={`Photo ${i + 1}`}
            >
              <Image src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Enquiry form ─────────────────────────────────────────────────────────────
const EnquiryForm = ({ token, agentName, onDone }) => {
  const [form, setForm]     = useState({ full_name: '', phone: '', email: '', message: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy]     = useState(false);
  const [apiError, setApiError] = useState('');

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    setErrors(p => ({ ...p, [k]: '' }));
    setApiError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.full_name.trim()) errs.full_name = 'Please tell us your name';
    if (!form.phone.trim() && !form.email.trim()) errs.phone = 'A phone number or email so we can reply';
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      errs.email = 'That email does not look right';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const res = await callListingPublic({
        action:    'enquire',
        token,
        full_name: form.full_name.trim(),
        phone:     form.phone.trim(),
        email:     form.email.trim(),
        message:   form.message.trim(),
      });
      onDone(res);
    } catch (err) {
      setApiError(err?.message || 'We could not send that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const ic = (err) =>
    `w-full px-3 py-2.5 text-sm border rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-colors ${
      err ? 'border-red-400' : 'border-slate-200'
    }`;

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <input
          type="text"
          value={form.full_name}
          onChange={e => set('full_name', e.target.value)}
          placeholder="Your name"
          className={ic(errors.full_name)}
        />
        {errors.full_name && <p className="mt-1 text-xs text-red-600">{errors.full_name}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <input
            type="tel"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="Phone number"
            className={ic(errors.phone)}
          />
          {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone}</p>}
        </div>
        <div>
          <input
            type="email"
            value={form.email}
            onChange={e => set('email', e.target.value)}
            placeholder="Email (optional)"
            className={ic(errors.email)}
          />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
        </div>
      </div>

      <textarea
        rows={3}
        value={form.message}
        onChange={e => set('message', e.target.value)}
        placeholder={`Anything you'd like to ask ${agentName || 'the agent'}? (optional)`}
        className={ic(false)}
      />

      {apiError && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
          <Icon name="AlertCircle" size={15} color="#dc2626" />
          <p className="text-xs text-red-700">{apiError}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
      >
        {busy ? (
          <>
            <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Icon name="Send" size={15} color="white" />
            I'm interested
          </>
        )}
      </button>
      <p className="text-xs text-slate-400 text-center">
        Your details go to {agentName || 'the agent'} so they can get back to you. Nothing else.
      </p>
    </form>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────
const PublicListingPage = () => {
  const { token } = useParams();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [retryable, setRetryable] = useState(false);
  const [sent, setSent]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setRetryable(false);
    try {
      setData(await callListingPublic({ action: 'view', token }));
    } catch (err) {
      setError(err?.message || 'This link could not be opened.');
      setRetryable(err?.retryable === true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (data?.asset?.title) document.title = `${data.asset.title} — for sale`;
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl animate-pulse space-y-4">
          <div className="h-64 sm:h-96 bg-slate-200 rounded-2xl" />
          <div className="h-7 bg-slate-200 rounded w-2/3" />
          <div className="h-5 bg-slate-200 rounded w-1/3" />
          <div className="h-32 bg-slate-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 max-w-md text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <Icon name={retryable ? 'WifiOff' : 'Unlink'} size={24} color="#64748b" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">
            {retryable ? 'We could not load this' : "This link isn't available"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          {retryable ? (
            <button
              onClick={load}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              <Icon name="RefreshCw" size={14} color="white" />
              Try again
            </button>
          ) : (
            <p className="mt-4 text-xs text-slate-400">
              If someone sent you this, ask them for a fresh link.
            </p>
          )}
        </div>
      </div>
    );
  }

  const { asset, agent, company, note, addressedTo, available, acceptingEnquiries } = data;
  const price = fmtPrice(asset.price, asset.currency);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-900">
            {company?.name || 'Listing'}
          </p>
          {agent?.phone && (
            <a
              href={telHref(agent.phone)}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline"
            >
              <Icon name="Phone" size={13} color="currentColor" />
              {agent.phone}
            </a>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* A note the agent wrote for this person */}
        {(note || addressedTo) && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3.5">
            <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide mb-1">
              {addressedTo ? `For ${addressedTo}` : 'From your agent'}
            </p>
            {note && <p className="text-sm text-slate-700 whitespace-pre-wrap">{note}</p>}
          </div>
        )}

        {!available && (
          <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <Icon name="AlertTriangle" size={17} color="#d97706" />
            <p className="text-sm font-semibold text-amber-800">
              This one is no longer available — but {agent?.name || 'your agent'} will have others like it.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: the listing */}
          <div className="lg:col-span-2 space-y-5">
            <Gallery images={asset.images} title={asset.title} />

            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{asset.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                {asset.location && (
                  <span className="flex items-center gap-1.5">
                    <Icon name="MapPin" size={14} color="currentColor" />
                    {asset.location}
                  </span>
                )}
                {asset.reference && (
                  <span className="flex items-center gap-1.5">
                    <Icon name="Hash" size={14} color="currentColor" />
                    {asset.reference}
                  </span>
                )}
              </div>
              {price && (
                <p className="mt-3 text-2xl font-bold text-emerald-600">{price}</p>
              )}

              {asset.specs?.length > 0 && (
                <dl className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3 pt-5 border-t border-slate-100">
                  {asset.specs.map(s => (
                    <div key={s.label}>
                      <dt className="text-xs text-slate-400 uppercase tracking-wide">{s.label}</dt>
                      <dd className="text-sm font-semibold text-slate-800 mt-0.5">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {asset.specifications && (
                <div className="mt-5 pt-5 border-t border-slate-100">
                  <h2 className="text-sm font-bold text-slate-900 mb-2">Details</h2>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                    {asset.specifications}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right: the agent, and the ask */}
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 lg:sticky lg:top-5">
              <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-base font-bold text-blue-700">
                    {(agent?.name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-400 uppercase tracking-wide">Your contact</p>
                  <p className="text-sm font-bold text-slate-900 truncate">{agent?.name || 'Sales agent'}</p>
                  {company?.name && (
                    <p className="text-xs text-slate-500 truncate">{company.name}</p>
                  )}
                </div>
              </div>

              {(agent?.phone || agent?.email) && (
                <div className="grid grid-cols-2 gap-2 py-4">
                  {agent.phone && (
                    <>
                      <a
                        href={telHref(agent.phone)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Icon name="Phone" size={14} color="currentColor" />
                        Call
                      </a>
                      <a
                        href={waHref(agent.phone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-white"
                        style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)' }}
                      >
                        <Icon name="MessageCircle" size={14} color="white" />
                        WhatsApp
                      </a>
                    </>
                  )}
                  {agent.email && !agent.phone && (
                    <a
                      href={`mailto:${agent.email}`}
                      className="col-span-2 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Icon name="Mail" size={14} color="currentColor" />
                      Email
                    </a>
                  )}
                </div>
              )}

              <div className="pt-4 border-t border-slate-100">
                {sent ? (
                  <div className="text-center py-2">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                      <Icon name="Check" size={22} color="#059669" />
                    </div>
                    <p className="text-sm font-bold text-slate-900">Thank you — that's on its way</p>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {sent.agentName || 'Your agent'} has your details and will be in touch shortly.
                    </p>
                    {sent.agentPhone && (
                      <a
                        href={telHref(sent.agentPhone)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline"
                      >
                        <Icon name="Phone" size={12} color="currentColor" />
                        Or call {sent.agentPhone} now
                      </a>
                    )}
                  </div>
                ) : acceptingEnquiries ? (
                  <>
                    <h2 className="text-sm font-bold text-slate-900 mb-1">Interested?</h2>
                    <p className="text-xs text-slate-500 mb-3">
                      Leave your details and {agent?.name || 'the agent'} will call you back.
                    </p>
                    <EnquiryForm token={token} agentName={agent?.name} onDone={setSent} />
                  </>
                ) : (
                  <p className="text-xs text-slate-500 text-center py-2">
                    This listing is not taking enquiries right now.
                    {agent?.phone && ' Call the number above and ask what else is available.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <footer className="pt-2 pb-6 text-center">
          <p className="text-xs text-slate-400">
            Shared with you by {agent?.name || 'a sales agent'}
            {company?.name ? ` · ${company.name}` : ''}
          </p>
        </footer>
      </main>
    </div>
  );
};

export default PublicListingPage;
