import React, { useState, useRef, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import Icon from '../../../components/AppIcon';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const StatusBadge = ({ status }) => {
  const map = {
    pending:    'bg-amber-100  text-amber-700',
    reviewing:  'bg-blue-100   text-blue-700',
    quoted:     'bg-violet-100 text-violet-700',
    converted:  'bg-emerald-100 text-emerald-700',
    closed:     'bg-gray-100   text-gray-500',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${map[status] || 'bg-gray-100 text-gray-500'}`}>
      {status || 'pending'}
    </span>
  );
};

const ItemEnquiryTab = ({ clientProfile, enquiries, onRefetch }) => {
  const [showForm,   setShowForm]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState(false);
  const [form, setForm] = useState({
    item_description: '',
    item_category:    'vehicle',
    budget:           '',
    notes:            '',
  });

  const clientId = clientProfile?.id;
  const adminId  = clientProfile?.admin_id;

  const categories = [
    { value: 'vehicle',       label: 'Vehicle' },
    { value: 'property',      label: 'Property' },
    { value: 'electronics',   label: 'Electronics' },
    { value: 'furniture',     label: 'Furniture' },
    { value: 'equipment',     label: 'Heavy Equipment' },
    { value: 'other',         label: 'Other' },
  ];

  const handleSubmit = async () => {
    if (!form.item_description.trim()) { setError('Please describe the item you are looking for'); return; }
    if (!clientId || !adminId) { setError('Profile not loaded. Please refresh.'); return; }

    setSubmitting(true);
    setError('');
    try {
      const message = `Item Enquiry:\nItem: ${form.item_description}\nCategory: ${form.item_category}\nBudget: ${form.budget ? `KES ${form.budget}` : 'Not specified'}\nNotes: ${form.notes || 'None'}`;

      const { error: err } = await supabase
        .from('asset_enquiries')
        .insert({
          client_id: clientId,
          admin_id:  adminId,
          message,
          status:    'pending',
        });

      if (err) throw err;

      setSuccess(true);
      setForm({ item_description: '', item_category: 'vehicle', budget: '', notes: '' });
      setShowForm(false);
      if (onRefetch) onRefetch();
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      setError(err.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Item Enquiry</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Can't find what you're looking for? Tell us and we'll source it for you
          </p>
        </div>
        <button onClick={() => { setShowForm(p => !p); setError(''); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Icon name={showForm ? 'ChevronUp' : 'Plus'} size={14} color="currentColor" />
          {showForm ? 'Hide Form' : 'New Enquiry'}
        </button>
      </div>

      {/* Success toast */}
      {success && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl dark:bg-emerald-900/20 dark:border-emerald-800">
          <Icon name="CheckCircle" size={18} color="#059669" />
          <div>
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-400">Enquiry submitted!</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-500">Our team will review your request and get back to you shortly.</p>
          </div>
        </div>
      )}

      {/* New Enquiry Form */}
      {showForm && (
        <div className="bg-card border border-primary/20 rounded-xl p-5 space-y-4" style={{ background: 'rgba(26,86,219,0.02)' }}>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Icon name="Search" size={15} color="var(--primary)" />
            Describe What You're Looking For
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Item Description *</label>
              <textarea
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                rows={3}
                placeholder="e.g. Toyota Hilux 2020, double cab, diesel, white colour, low mileage..."
                value={form.item_description}
                onChange={e => setForm(p => ({ ...p, item_description: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Category</label>
              <select
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.item_category}
                onChange={e => setForm(p => ({ ...p, item_category: e.target.value }))}>
                {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Budget (KES)</label>
              <input
                type="number"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. 1500000"
                value={form.budget}
                onChange={e => setForm(p => ({ ...p, budget: e.target.value }))}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Additional Notes</label>
              <textarea
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                rows={2}
                placeholder="Any other details — preferred colour, year, specs, urgency..."
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3">
            <button onClick={() => { setShowForm(false); setError(''); }}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
              {submitting ? (
                <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> Submitting...</>
              ) : (
                <><Icon name="Send" size={14} color="currentColor" /> Submit Enquiry</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Enquiry History */}
      <div className="space-y-3">
        <h3 className="font-semibold text-foreground text-sm">My Enquiries ({(enquiries || []).length})</h3>

        {(!enquiries || enquiries.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-card border border-border rounded-xl">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Icon name="Search" size={20} color="var(--muted-foreground)" />
            </div>
            <p className="text-sm font-medium text-foreground">No enquiries yet</p>
            <p className="text-xs text-muted-foreground mt-1">Click "New Enquiry" to tell us what you're looking for</p>
          </div>
        ) : (
          enquiries.map(enq => {
            // Parse message to extract fields
            const lines    = (enq.message || '').split('\n');
            const itemLine = lines.find(l => l.startsWith('Item:'));
            const catLine  = lines.find(l => l.startsWith('Category:'));
            const budLine  = lines.find(l => l.startsWith('Budget:'));
            const item     = itemLine  ? itemLine.replace('Item:', '').trim()     : enq.message;
            const category = catLine   ? catLine.replace('Category:', '').trim()  : '—';
            const budget   = budLine   ? budLine.replace('Budget:', '').trim()    : '—';

            return (
              <div key={enq.id} className="bg-card border border-border rounded-xl p-4 hover:border-primary/20 transition-all">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Icon name="Search" size={16} color="var(--primary)" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground line-clamp-2">{item}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize">{category} · Budget: {budget}</p>
                    </div>
                  </div>
                  <StatusBadge status={enq.status} />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Submitted: {fmtDate(enq.created_at)}</span>
                  {enq.status === 'quoted' && (
                    <span className="text-primary font-semibold">Quote ready — contact us</span>
                  )}
                  {enq.status === 'reviewing' && (
                    <span className="text-blue-600 font-semibold">Under review</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ItemEnquiryTab;
