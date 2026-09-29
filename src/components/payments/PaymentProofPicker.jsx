import React, { useRef, useState } from 'react';
import Icon from '../AppIcon';
import { PROOF_ACCEPT, validateProofFile } from '../../utils/paymentProofs';

const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Pick a proof-of-payment file inside a form, before the payment exists.
 * The form uploads it after the payment is recorded (uploadPaymentProof),
 * because the register row needs the payment's id.
 */
const PaymentProofPicker = ({ file, onChange, required = false, hint, error: externalError }) => {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);

  const pick = (f) => {
    if (!f) return;
    const problem = validateProofFile(f);
    setError(problem);
    onChange(problem ? null : f);
  };

  const shown = error || externalError;

  return (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground mb-1">
        Proof of payment {required ? <span className="text-red-500">*</span> : <span className="font-normal">(optional)</span>}
      </label>

      {file ? (
        <div className="flex items-center gap-3 px-3 py-2.5 border border-emerald-200 bg-emerald-50 rounded-xl">
          <Icon name={file.type === 'application/pdf' ? 'FileText' : 'Image'} size={16} color="#047857" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-emerald-900 truncate">{file.name}</p>
            <p className="text-xs text-emerald-700">{fmtSize(file.size)}</p>
          </div>
          <button type="button" onClick={() => { onChange(null); setError(null); if (inputRef.current) inputRef.current.value = ''; }}
            className="text-xs font-medium text-emerald-800 hover:underline">
            Remove
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()}
          className={`w-full flex items-center justify-center gap-2 px-3 py-3 border-2 border-dashed rounded-xl text-sm transition-colors ${
            shown ? 'border-red-300 text-red-600 bg-red-50' : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
          }`}>
          <Icon name="Upload" size={15} color="currentColor" />
          Upload deposit / transfer slip
        </button>
      )}

      <input ref={inputRef} type="file" accept={PROOF_ACCEPT} className="hidden"
        onChange={(e) => pick(e.target.files?.[0])} />

      {shown
        ? <p className="text-xs text-red-500 mt-0.5">{shown}</p>
        : <p className="text-xs text-muted-foreground mt-0.5">{hint || 'PDF or photo of the bank slip, up to 10 MB.'}</p>}
    </div>
  );
};

export default PaymentProofPicker;
