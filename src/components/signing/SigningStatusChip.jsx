import React from 'react';
import Icon from '../AppIcon';
import { signingVerdict } from '../../utils/certificateSigning';

/**
 * Where a document has got to on its way to being signed, in one chip.
 *
 * Used in list rows, so it has to read at a glance and stay narrow. The signer
 * count is shown while a request is out because "2 of 3 signed" is the only
 * thing anyone actually wants to know at that point — the status word alone
 * ("Out for signature") is the same on day one and day nine.
 */

const TONES = {
  success: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'CheckCircle2' },
  pending: { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'Clock' },
  warning: { cls: 'bg-orange-50 text-orange-700 border-orange-200', icon: 'AlertTriangle' },
  danger: { cls: 'bg-red-50 text-red-700 border-red-200', icon: 'XCircle' },
  muted: { cls: 'bg-muted/50 text-muted-foreground border-border', icon: 'Minus' },
};

const SigningStatusChip = ({ request, requireSignature = false, className = '' }) => {
  // No request at all is two different things, and they must not look alike:
  // a tenant that requires a signature has an outstanding job to do, while one
  // that does not has nothing to show.
  if (!request) {
    if (!requireSignature) return <span className={`text-xs text-muted-foreground ${className}`}>—</span>;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${TONES.warning.cls} ${className}`}>
        <Icon name="PenLine" size={11} color="currentColor" />
        Needs signing
      </span>
    );
  }

  // docKind travels with the status so a kind with its own vocabulary gets its
  // own words — a guarantee agreement is "Executed", never "Issued".
  const verdict = signingVerdict(request.status, request.docKind);
  const tone = TONES[verdict.tone] || TONES.muted;
  const inFlight = ['sent', 'viewed'].includes(request.status);
  const count = inFlight && request.signersTotal
    ? ` · ${request.signersSigned || 0}/${request.signersTotal}`
    : '';

  return (
    <span
      title={verdict.detail}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${tone.cls} ${className}`}
    >
      <Icon name={tone.icon} size={11} color="currentColor" />
      {verdict.label}{count}
    </span>
  );
};

export default SigningStatusChip;
