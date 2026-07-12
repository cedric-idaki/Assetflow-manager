import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import { Card, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput, Select, EmptyState, fmtDate } from './_shared';

const DOC_TYPES = ['constitution', 'bylaws', 'policy', 'minutes', 'resolution', 'other'];
const DOC_ICON = { constitution: 'ScrollText', bylaws: 'BookText', policy: 'FileText', minutes: 'ClipboardList', resolution: 'Gavel', other: 'File' };

const GovernanceTab = ({ ctx }) => {
  const { documents, uploadDocument, exportCSV } = ctx;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', doc_type: 'constitution', version: 'v1.0', file_url: '', effective_date: '' });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) { toast.error('Document title is required.'); return; }
    setSaving(true);
    try { await uploadDocument(form); toast.success('Document added to the library.'); setOpen(false); setForm({ title: '', doc_type: 'constitution', version: 'v1.0', file_url: '', effective_date: '' }); }
    catch (e) { toast.error(e.message || 'Could not add document.'); } finally { setSaving(false); }
  };

  // Group by type for a library feel.
  const byType = DOC_TYPES.map((t) => ({ type: t, docs: documents.filter((d) => d.doc_type === t) })).filter((g) => g.docs.length);

  return (
    <Card
      title="Bylaws & constitution" subtitle="Governance document library — versioned"
      actions={
        <div className="flex items-center gap-2">
          <GhostButton icon="Download" onClick={() => exportCSV(documents, 'sacco_documents')}>Export</GhostButton>
          <PrimaryButton icon="Upload" onClick={() => setOpen(true)}>Add document</PrimaryButton>
        </div>
      }
    >
      {documents.length === 0 ? (
        <EmptyState icon="ScrollText" title="No documents yet" hint="Add the constitution, bylaws and policies so every member can view the current version." />
      ) : (
        <div className="space-y-5">
          {byType.map((g) => (
            <div key={g.type}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 capitalize">{g.type}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {g.docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 p-3 rounded-xl border border-border">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,193,221,0.12)' }}>
                      <Icon name={DOC_ICON[d.doc_type] || 'File'} size={18} color="#1da8c5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{d.title}</p>
                      <p className="text-xs text-muted-foreground">{d.version} · effective {fmtDate(d.effective_date)}</p>
                    </div>
                    {d.file_url
                      ? <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs text-primary font-semibold hover:underline flex-shrink-0">Open</a>
                      : <Badge status="draft" />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add governance document"
        footer={<><GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add'}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Title *"><TextInput value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Sacco Constitution 2026" /></Field>
          <Field label="Type"><Select value={form.doc_type} onChange={(e) => set('doc_type', e.target.value)}>{DOC_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}</Select></Field>
          <Field label="Version"><TextInput value={form.version} onChange={(e) => set('version', e.target.value)} placeholder="v1.0" /></Field>
          <Field label="Effective date"><TextInput type="date" value={form.effective_date} onChange={(e) => set('effective_date', e.target.value)} /></Field>
          <Field label="Document URL"><TextInput value={form.file_url} onChange={(e) => set('file_url', e.target.value)} placeholder="https://…" /></Field>
        </div>
        <p className="text-xs text-muted-foreground mt-3">Paste a link to the document for now. Direct file upload to per-sacco storage is a Phase 2 enhancement.</p>
      </Modal>
    </Card>
  );
};

export default GovernanceTab;
