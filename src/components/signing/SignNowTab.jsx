import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../AppIcon';
import { useToast } from '../Toast';
import { resolveFileUrl } from '../../lib/storageUrl';
import SignNowSettingsPanel from './SignNowSettingsPanel';
import SigningStatusChip from './SigningStatusChip';
import SendForSignatureModal from './SendForSignatureModal';
import SigningRequestDrawer from './SigningRequestDrawer';
import { signingStatusFor, openSignedCertificate } from '../../utils/signnowClient';
import { appendContractSignaturePage } from '../../utils/certificatePdf';

/**
 * The SignNow tab on /e-signature.
 *
 * Two things live here, and the order is the order an operator needs them:
 * send a document out through SignNow, and — below that — connect the account
 * and set the rules.
 *
 * WHAT THIS IS FOR, GIVEN THE APP ALREADY SIGNS PDFs
 * --------------------------------------------------
 * The in-house engine is the right tool when the tenant is asking THEIR OWN
 * customer to sign, on this platform, where we control the whole experience.
 * SignNow is the right tool when the signature has to stand up to somebody
 * else's scrutiny — a bank, a registry, a court — because their completion
 * certificate is not ours to write. Both are available per document; neither
 * replaces the other.
 */

/** doc._source → the table its id belongs to, and which id field carries it. */
const SOURCES = {
  generated: { table: 'generated_contracts', idKey: '_dbId' },
  company: { table: 'company_contracts', idKey: '_companyId' },
  esign_doc: { table: 'esign_documents', idKey: '_esignId' },
};

const sourceOf = (doc) => SOURCES[doc?._source] || SOURCES.generated;
const rowIdOf = (doc) => doc?.[sourceOf(doc).idKey] || doc?._dbId || doc?.id;

const fmt = (d) => (d
  ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

const SignNowTab = ({ docs = [] }) => {
  const toast = useToast();
  const [statusByTable, setStatusByTable] = useState({});
  const [sendDoc, setSendDoc] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const [loading, setLoading] = useState(true);

  // Only documents with an actual file can be sent: SignNow signs a PDF, and a
  // contract row with no file_url has nothing to sign.
  const sendable = useMemo(() => docs.filter((d) => d.file_url), [docs]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // The documents on this screen come from three tables, and
      // signing_status_for answers per table — so one call each, in parallel,
      // rather than one per document.
      const groups = {};
      for (const d of sendable) {
        const { table } = sourceOf(d);
        (groups[table] ||= []).push(rowIdOf(d));
      }
      const entries = await Promise.all(
        Object.entries(groups).map(async ([table, ids]) => [table, await signingStatusFor(table, ids)]),
      );
      setStatusByTable(Object.fromEntries(entries));
    } catch (_) {
      // No signing history is the normal state for a tenant that has not
      // started using this.
    } finally {
      setLoading(false);
    }
  }, [sendable]);

  useEffect(() => { refresh(); }, [refresh]);

  const statusOf = (doc) => statusByTable[sourceOf(doc).table]?.[rowIdOf(doc)] || null;

  /**
   * Fetch the document's existing PDF and append an execution page to it.
   *
   * The original is never redrawn — whatever the parties are agreeing to is
   * exactly the file that was already on record, with one page added that says
   * so and carries the signature blocks.
   */
  const buildFor = (doc) => async ({ serial, signers }) => {
    const url = await resolveFileUrl(doc.file_url);
    if (!url) throw new Error('That document’s file could not be opened.');

    const res = await fetch(url);
    if (!res.ok) throw new Error('That document’s file could not be downloaded.');
    const bytes = new Uint8Array(await res.arrayBuffer());

    return appendContractSignaturePage(bytes, {
      title: doc.name || 'Agreement',
      subtitle: doc.client ? `Counterparty: ${doc.client}` : '',
      serial,
      signers,
    });
  };

  const rows = sendable.map((d) => ({ doc: d, state: statusOf(d) }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">SignNow</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Send documents for signature through your own SignNow account, and decide which
          certificates cannot be issued until they come back signed.
        </p>
      </div>

      {/* ── Documents ──────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Icon name="Send" size={15} color="currentColor" /> Send a document
          </h3>
          <button onClick={refresh} className="text-xs text-primary font-semibold hover:underline">
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
              <Icon name="FileText" size={20} color="var(--color-muted-foreground)" />
            </div>
            <p className="text-sm font-semibold text-foreground">No document has a file attached</p>
            <p className="text-xs text-muted-foreground mt-1">
              SignNow signs a PDF, so a document has to have one before it can be sent.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map(({ doc, state }) => (
              <div key={`${doc._source}:${rowIdOf(doc)}`} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{doc.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {doc.client ? `${doc.client} · ` : ''}{fmt(doc.sent)}
                  </p>
                </div>

                <SigningStatusChip request={state} />

                <div className="flex items-center gap-3 shrink-0">
                  {state?.status === 'released' && state.signedPath ? (
                    <button
                      onClick={async () => {
                        const ok = await openSignedCertificate(state.signedPath);
                        if (!ok) toast.error('Allow pop-ups for this site to open the signed document.');
                      }}
                      className="text-xs text-primary font-semibold hover:underline"
                    >
                      Signed copy
                    </button>
                  ) : state ? (
                    <button
                      onClick={() => setDrawerId(state.requestId)}
                      className="text-xs text-primary font-semibold hover:underline"
                    >
                      Track
                    </button>
                  ) : (
                    <button
                      onClick={() => setSendDoc(doc)}
                      className="text-xs text-primary font-semibold hover:underline"
                    >
                      Send via SignNow
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Settings ───────────────────────────────────────────────────── */}
      <SignNowSettingsPanel />

      <SendForSignatureModal
        open={!!sendDoc}
        onClose={() => setSendDoc(null)}
        onSent={refresh}
        docKind="contract"
        sourceTable={sendDoc ? sourceOf(sendDoc).table : undefined}
        sourceId={sendDoc ? rowIdOf(sendDoc) : undefined}
        documentName={sendDoc?.name || 'Agreement'}
        build={sendDoc ? buildFor(sendDoc) : undefined}
      />

      <SigningRequestDrawer
        open={!!drawerId}
        requestId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={refresh}
      />
    </div>
  );
};

export default SignNowTab;
