import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import { useLegalLibrary, legalDocumentUrl } from '../../../hooks/useLegalDocuments';

const when = (v) => (v ? new Date(v).toLocaleDateString() : '—');

const KINDS = [
  { value: 'terms',        label: 'Terms & Conditions' },
  { value: 'privacy',      label: 'Privacy Policy' },
  { value: 'sacco_bylaws', label: 'SACCO By-laws' },
];

/**
 * Publish the terms, and see who agreed to which version.
 *
 * WHY THIS SCREEN EXISTS. The terms were a URL in a source file, so updating
 * them meant a code change and a redeploy — and there was no way to say what
 * they SAID on the day somebody accepted them. A signed-up user's agreement is
 * only worth something if the exact text can be produced.
 *
 * A PUBLISHED VERSION CANNOT BE EDITED. Correcting the terms means publishing a
 * new version; the old one stays, inactive, because people are still bound by
 * it. The database enforces that, not this screen — but the screen says so,
 * because somebody will try.
 */
const LegalDocumentsTab = () => {
  const toast = useToast();
  const [kind, setKind] = useState('terms');
  const { documents, loading, error, publish, activate, acceptances } = useLegalLibrary(kind);

  const [form, setForm] = useState({ version: '', title: '', summary: '', externalUrl: '', file: null });
  const [busy, setBusy] = useState('');
  const [seen, setSeen] = useState(null);   // { doc, rows }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.version.trim()) { toast.error('Give the version a number — it is what an acceptance refers to.'); return; }
    if (!form.title.trim())   { toast.error('Give the document a title.'); return; }
    if (!form.file && !form.externalUrl.trim()) {
      toast.error('Upload a PDF or give a link — a document needs content.');
      return;
    }
    setBusy('publish');
    try {
      await publish({
        version: form.version.trim(),
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        file: form.file,
        externalUrl: form.externalUrl.trim() || null,
        activate: true,
      });
      toast.success(`Version ${form.version.trim()} published and now in force.`);
      setForm({ version: '', title: '', summary: '', externalUrl: '', file: null });
    } catch (err) {
      toast.error(err?.message || 'Could not publish that version.');
    } finally {
      setBusy('');
    }
  };

  const makeActive = async (doc) => {
    setBusy(doc.id);
    try {
      await activate(doc.id);
      toast.success(`Version ${doc.version} is now the one shown at registration.`);
    } catch (err) {
      toast.error(err?.message || 'Could not activate that version.');
    } finally {
      setBusy('');
    }
  };

  const showAcceptances = async (doc) => {
    setBusy(doc.id);
    try {
      setSeen({ doc, rows: await acceptances(doc.id) });
    } catch (err) {
      toast.error(err?.message || 'Could not load the acceptances.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Publish a new version</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Publishing makes it the version shown at registration immediately. A published
              version can never be edited — correct it by publishing another.
            </p>
          </div>
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            aria-label="Document kind"
            className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="legal-version" className="block text-xs font-semibold text-muted-foreground mb-1">
              Version *
            </label>
            <input id="legal-version" value={form.version} onChange={(e) => set('version', e.target.value)}
              placeholder="e.g. 2.0"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground font-mono" />
          </div>
          <div>
            <label htmlFor="legal-title" className="block text-xs font-semibold text-muted-foreground mb-1">
              Title *
            </label>
            <input id="legal-title" value={form.title} onChange={(e) => set('title', e.target.value)}
              placeholder="Terms & Conditions and Privacy Policy"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="legal-summary" className="block text-xs font-semibold text-muted-foreground mb-1">
              What changed
            </label>
            <input id="legal-summary" value={form.summary} onChange={(e) => set('summary', e.target.value)}
              placeholder="Shown in the history below — worth a sentence for whoever reads this in two years"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground" />
          </div>
          <div>
            <label htmlFor="legal-file" className="block text-xs font-semibold text-muted-foreground mb-1">
              Upload the document (PDF)
            </label>
            <input id="legal-file" type="file" accept=".pdf,text/html,text/plain"
              onChange={(e) => set('file', e.target.files?.[0] || null)}
              className="w-full text-xs text-muted-foreground file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border file:bg-muted file:text-xs file:font-medium file:text-foreground" />
          </div>
          <div>
            <label htmlFor="legal-url" className="block text-xs font-semibold text-muted-foreground mb-1">
              …or link to it
            </label>
            <input id="legal-url" value={form.externalUrl} onChange={(e) => set('externalUrl', e.target.value)}
              placeholder="https://…"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground" />
            <p className="text-[11px] text-muted-foreground mt-1">
              An uploaded copy is better: a link can change without anybody knowing, which
              is the problem this replaces.
            </p>
          </div>
        </div>

        <button onClick={submit} disabled={busy === 'publish'}
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50">
          {busy === 'publish' ? 'Publishing…' : 'Publish and make active'}
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Version history</h2>
          <p className="text-xs text-muted-foreground">
            Every version ever published. Inactive ones are kept because people accepted them.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-5 py-3 bg-red-50 border-b border-red-200">
            <Icon name="AlertCircle" size={15} color="#dc2626" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Icon name="FileText" size={26} color="currentColor" />
            <p className="text-sm mt-2">Nothing published yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  {['Version', 'Title', 'In force from', 'Status', ''].map((h, i) => (
                    <th key={h || i} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {documents.map(d => (
                  <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{d.version}</td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground">{d.title}</p>
                      {d.summary && <p className="text-[11px] text-muted-foreground">{d.summary}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{when(d.effective_from)}</td>
                    <td className="px-4 py-3">
                      {d.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          In force
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                          Superseded
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {legalDocumentUrl(d) && (
                          <a href={legalDocumentUrl(d)} target="_blank" rel="noopener noreferrer"
                            className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground">
                            Read
                          </a>
                        )}
                        <button onClick={() => showAcceptances(d)} disabled={busy === d.id}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
                          Who accepted
                        </button>
                        {!d.is_active && (
                          <button onClick={() => makeActive(d)} disabled={busy === d.id}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50">
                            Make active
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {seen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">
                Accepted version {seen.doc.version}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {seen.rows.length} acceptance{seen.rows.length === 1 ? '' : 's'} on record
              </p>
            </div>
            <div className="p-5 overflow-y-auto">
              {seen.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nobody has accepted this version. If it is the one in force, that means
                  nobody has registered since it was published.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {seen.rows.map(r => (
                    <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{r.full_name || r.email || 'Unknown'}</p>
                        {r.full_name && r.email && (
                          <p className="text-[11px] text-muted-foreground truncate">{r.email}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.accepted_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end">
              <button onClick={() => setSeen(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LegalDocumentsTab;
