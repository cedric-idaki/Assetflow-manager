import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const KRAPINPanel = ({ value, onChange, isVerified, onVerify, isVerifying }) => {
  const [showPin, setShowPin] = useState(false);
  const [localPin, setLocalPin] = useState(value || '');
  const [validationError, setValidationError] = useState('');

  // KRA PIN format: Letter + 9 digits + Letter (e.g., A123456789B)
  const validateKRAPin = (pin) => {
    const kraRegex = /^[A-Z]\d{9}[A-Z]$/;
    return kraRegex?.test(pin?.toUpperCase());
  };

  const handleChange = (e) => {
    const val = e?.target?.value?.toUpperCase()?.replace(/[^A-Z0-9]/g, '')?.slice(0, 11);
    setLocalPin(val);
    onChange?.(val);
    if (val?.length === 11) {
      if (!validateKRAPin(val)) {
        setValidationError('Invalid KRA PIN format. Expected: A123456789B');
      } else {
        setValidationError('');
      }
    } else {
      setValidationError('');
    }
  };

  const maskedPin = localPin ? localPin?.slice(0, 2) + '•'?.repeat(Math.max(0, localPin?.length - 4)) + localPin?.slice(-2) : '';
  const isValid = localPin?.length === 11 && validateKRAPin(localPin);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">KRA PIN</label>
        {isVerified && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-500 font-medium">
            <Icon name="ShieldCheck" size={12} color="currentColor" />
            Verified
          </span>
        )}
      </div>

      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2">
          <Icon name="Lock" size={15} color="var(--color-muted-foreground)" />
        </div>
        <input
          type={showPin ? 'text' : 'password'}
          value={showPin ? localPin : maskedPin}
          onChange={handleChange}
          placeholder="e.g. A123456789B"
          maxLength={11}
          className={`w-full pl-9 pr-10 py-2.5 text-sm bg-background border rounded-lg font-mono tracking-widest transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
            validationError ? 'border-red-500' : isValid ? 'border-emerald-500' : 'border-border'
          }`}
        />
        <button
          type="button"
          onClick={() => setShowPin(!showPin)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name={showPin ? 'EyeOff' : 'Eye'} size={15} color="currentColor" />
        </button>
      </div>

      {validationError && (
        <div className="flex items-center gap-1.5 text-red-500">
          <Icon name="AlertCircle" size={12} color="currentColor" />
          <p className="text-xs">{validationError}</p>
        </div>
      )}

      {isValid && !isVerified && (
        <button
          onClick={() => onVerify?.(localPin)}
          disabled={isVerifying}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          {isVerifying ? (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <Icon name="ShieldCheck" size={12} color="currentColor" />
          )}
          {isVerifying ? 'Verifying...' : 'Verify with KRA'}
        </button>
      )}

      <p className="text-xs text-muted-foreground">Format: 1 letter + 9 digits + 1 letter (e.g., A123456789B). Stored encrypted.</p>
    </div>
  );
};

export default KRAPINPanel;
