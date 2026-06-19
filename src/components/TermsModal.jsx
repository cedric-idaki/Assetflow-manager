import React, { useEffect } from 'react';
import Icon from './AppIcon';

// Google Drive preview of the AssetFlow Terms & Conditions / Privacy Policy.
export const TERMS_DOC_URL = 'https://drive.google.com/file/d/1xKuwpqByoANSrOrcz5qSOFzGKfwokkSg/preview';

// Full-screen overlay that shows the Terms & Privacy Policy document in the
// same tab (no new window). Used during account registration.
const TermsModal = ({ open, onClose }) => {
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
            <h3 className="text-base font-bold" style={{ color: '#0c2037' }}>
              Terms &amp; Privacy Policy
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={TERMS_DOC_URL}
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
        <div className="flex-1 bg-slate-50">
          <iframe
            src={TERMS_DOC_URL}
            title="AssetFlow Terms and Privacy Policy"
            className="w-full h-full border-0"
            allow="autoplay"
          />
        </div>
      </div>
    </div>
  );
};

export default TermsModal;
