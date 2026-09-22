import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';

const money = (amount) => `KES ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const date = (value) => value ? new Date(value).toLocaleDateString('en-KE') : '—';

const STATUS = {
  pledged:  'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  released: 'bg-slate-100 text-slate-700',
  realised: 'bg-purple-100 text-purple-700',
};

const CollateralReviewTab = ({ sacco }) => {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!sacco?.id) { setLoading(false); return; }
    setLoading(true); setError('');
    const { data, error: err } = await supabase
      .from('sacco_loan_collateral')
      .select('id, loan_id, member_id, asset_type, asset_reference, asset_description, estimated_value, valuation_date, valuer, document_path, document_name, status, review_note, reviewed_at, created_at, loan:sacco_loans(id, principal, status), member:sacco_members(id, full_name, member_no)')
      .eq('sacco_id', sacco.id)
      .order('created_at', { ascending: false });
    if (err) setError(err.message || 'Could not load collateral.');
    else setItems(data || []);
    setLoading(false);
  }, [sacco?.id]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => filter === 'all' ? items : items.filter(item => item.status === filter), [filter, items]);
  const pending = items.filter(item => item.status === 'pledged').length;

  const openDocument = async (item) => {
    if (!item.document_path) return;
    setBusy(`doc:${item.id}`);
    try {
      const { data, error: err } = await supabase.storage
        .from('sacco-loan-collateral')
        .createSignedUrl(item.document_path, 300);
      if (err) throw err;
      window.open(data?.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err?.message || 'Could not open the attachment.');
    } finally { setBusy(''); }
  };

  const review = async (item, decision) => {
    const finalNote = decision === 'rejected'
      ? window.prompt(`Why is ${item.asset_reference} being rejected?`, note)
      : note;
    if (finalNote === null) return;
    if (decision === 'rejected' && !finalNote.trim()) {
      setError('A rejection reason is required.'); return;
    }
    setBusy(item.id); setError('');
    try {
      const { error: err } = await supabase.rpc('sacco_review_loan_collateral', {
        p_id: item.id, p_decision: decision, p_note: finalNote.trim() || null,
      });
      if (err) throw err;
      setNoteFor(null); setNote(''); await load();
    } catch (err) {
      setError(err?.message || 'Collateral review could not be saved.');
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Collateral review</h2>
          <p className="text-xs text-muted-foreground">Review member pledges, supporting evidence, and recorded values before accepting security.</p>
        </div>
        <button onClick={load} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted">
          <Icon name="RefreshCw" size={13} color="currentColor" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['all', 'pledged', 'approved', 'rejected'].map(status => (
          <button key={status} onClick={() => setFilter(status)} className={`text-left p-3 rounded-xl border transition-colors ${filter === status ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40'}`}>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{status === 'pledged' ? 'Awaiting review' : status}</p>
            <p className="text-xl font-bold text-foreground mt-0.5">{status === 'all' ? items.length : items.filter(i => i.status === status).length}</p>
          </button>
        ))}
      </div>

      {pending > 0 && <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900"><Icon name="AlertTriangle" size={15} color="#b45309" /> {pending} collateral record{pending === 1 ? '' : 's'} await review.</div>}
      {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700"><Icon name="AlertCircle" size={15} color="#dc2626" /> {error}</div>}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? <div className="py-14 text-center text-sm text-muted-foreground">Loading collateral…</div>
          : visible.length === 0 ? <div className="py-14 text-center text-sm text-muted-foreground">No collateral records in this view.</div>
          : <div className="divide-y divide-border">{visible.map(item => (
            <div key={item.id} className="p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap"><p className="font-semibold text-foreground">{item.asset_reference}</p><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${STATUS[item.status] || STATUS.pledged}`}>{item.status === 'pledged' ? 'awaiting review' : item.status}</span></div>
                  <p className="text-xs text-muted-foreground mt-1 capitalize">{item.asset_type} · {money(item.estimated_value)} · pledged {date(item.created_at)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Member: <span className="text-foreground font-medium">{item.member?.full_name || '—'}</span>{item.member?.member_no ? ` (${item.member.member_no})` : ''} · Loan: {money(item.loan?.principal)}</p>
                </div>
                {item.document_path ? <button onClick={() => openDocument(item)} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50"><Icon name="Paperclip" size={13} color="currentColor" />{busy === `doc:${item.id}` ? 'Opening…' : item.document_name || 'Open attachment'}</button> : <span className="text-xs text-amber-700">No attachment supplied</span>}
              </div>
              {(item.asset_description || item.valuer || item.valuation_date) && <p className="text-xs text-muted-foreground">{item.asset_description || 'No description'}{item.valuer ? ` · Valuer: ${item.valuer}` : ''}{item.valuation_date ? ` · Valued ${date(item.valuation_date)}` : ''}</p>}
              {item.review_note && <p className={`text-xs p-2.5 rounded-lg ${item.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-muted text-muted-foreground'}`}>Review note: {item.review_note}</p>}
              {item.status === 'pledged' && <div className="flex flex-wrap items-center gap-2">
                <input value={noteFor === item.id ? note : ''} onChange={e => { setNoteFor(item.id); setNote(e.target.value); }} placeholder="Reviewer note (optional for approval)" className="flex-1 min-w-52 px-3 py-1.5 text-xs border border-border rounded-lg bg-background" />
                <button onClick={() => review(item, 'approved')} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50">Approve</button>
                <button onClick={() => review(item, 'rejected')} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white disabled:opacity-50">Reject</button>
              </div>}
            </div>
          ))}</div>}
      </div>
    </div>
  );
};

export default CollateralReviewTab;
