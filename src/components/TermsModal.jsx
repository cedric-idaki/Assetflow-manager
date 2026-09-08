import React, { useEffect } from 'react';
import Icon from './AppIcon';
import { useActiveLegalDocument, legalDocumentUrl } from '../hooks/useLegalDocuments';

/**
 * The version that was hardcoded here before 20260909140000.
 *
 * Kept only as the last-resort fallback for a database that has not had that
 * migration applied yet — the modal must never come up empty during a
 * registration. Nothing should link to it; the live document comes from
 * `legal_documents`, where it is versioned and its acceptance is recorded.
 */
export const TERMS_DOC_URL = 'https://drive.google.com/file/d/1t8fTwvCcbiYa-iDAPZ9mQv8SOd-Ly6IA/preview';

/**
 * The terms, as currently published.
 *
 * Shows whichever version is ACTIVE, and names it on screen. That version
 * number is the same one `record_legal_acceptance` writes against the tick on
 * the registration form, so what somebody agreed to can be produced later —
 * which a link to a mutable Drive file could never do.
 */
const TermsModal = ({ open, onClose }) => {
  const { doc, loading } = useActiveLegalDocument('terms');

  // Inline HTML renders in place; a PDF or a link renders in the frame.
  const src = legalDocumentUrl(doc) || TERMS_DOC_URL;
  const heading = doc?.title || 'Terms & Privacy Policy';

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(12,32,55,0.6)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Terms and Privacy Policy"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden"
        style={{ height: 'min(90vh, 800px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#d0dce6' }}>
          <div className="flex items-center gap-2">
            <Icon name="FileText" size={18} color="#1da8c5" />
            <div>
              <h3 className="text-base font-bold" style={{ color: '#0c2037' }}>
                {heading}
              </h3>
              {/* The version is on screen because it is what the acceptance
                  record refers to. "I agreed to the terms" is only meaningful
                  alongside which terms. */}
              {doc?.version && (
                <p className="text-[11px]" style={{ color: '#5a7185' }}>
                  Version {doc.version}
                  {doc.effective_from ? ` · in force from ${new Date(doc.effective_from).toLocaleDateString()}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: '#1da8c5', border: '1px solid #d0dce6' }}
            >
              <Icon name="ExternalLink" size={13} color="currentColor" />
              Open full page
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-slate-100"
              style={{ color: '#5a7185' }}
            >
              <Icon name="X" size={18} color="currentColor" />
            </button>
          </div>
        </div>

        {/* Document */}
        <div className="flex-1 bg-slate-50 overflow-y-auto">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm" style={{ color: '#5a7185' }}>
              Loading the current terms&hellip;
            </div>
          ) : doc?.body_html ? (
            // Published as text rather than a file. Rendered directly so a
            // clause can be corrected without re-uploading a PDF.
            <div
              className="prose prose-sm max-w-none p-6"
              style={{ color: '#0c2037' }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: doc.body_html }}
            />
          ) : (
          <iframe
            src={src}
            title={heading}
            className="w-full h-full border-0"
            allow="autoplay"
          />
          )}
        </div>
      </div>
    </div>
  );
};

export default TermsModal;
