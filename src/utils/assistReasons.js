// The vocabulary both ends of an assist share.
//
// A bronze agent picks WHY they need help; a gold agent who won't take the job
// picks WHY NOT. Both used to be free text (or nothing at all), which made them
// unreadable in aggregate — the super admin could see that a gold agent had
// turned work down but never why, so a pattern of refusals looked identical to
// bad luck. Codes are stored on the row; the labels below are the only place
// they are spelled out, so the portal, the oversight table and the emails can
// never drift apart.

// ── Why the bronze agent needs a gold agent ──────────────────────────────────
export const HELP_TYPES = [
  {
    code:  'sales_assist',
    label: 'Assistance to make sales',
    hint:  'The client is interested but needs a stronger pitch to close.',
    icon:  'TrendingUp',
  },
  {
    code:  'installation_training',
    label: 'Installation and training',
    hint:  'The account exists — someone has to set it up and train the staff.',
    icon:  'GraduationCap',
  },
  {
    code:  'other',
    label: 'Other',
    hint:  'Anything else — say what you need in the box below.',
    icon:  'HelpCircle',
  },
];

// ── Why the gold agent is turning it down ────────────────────────────────────
// A decline is never silent and never unexplained: the bronze agent has to know
// whether to ask someone else or fix something first.
export const DECLINE_REASONS = [
  { code: 'unavailable',      label: 'Fully booked / not available' },
  { code: 'out_of_region',    label: 'Client is outside my region' },
  { code: 'not_my_expertise', label: 'Outside my expertise' },
  { code: 'insufficient_info',label: 'Not enough detail to act on' },
  { code: 'client_not_ready', label: 'Client / admin is not ready yet' },
  { code: 'duplicate',        label: 'Already handled or duplicate request' },
  { code: 'other',            label: 'Other (explain below)' },
];

const labelFrom = (list, code, fallback) =>
  list.find(r => r.code === code)?.label || fallback;

export const helpTypeLabel    = (code) => labelFrom(HELP_TYPES, code, code ? 'Other' : '');
export const declineReasonLabel = (code) => labelFrom(DECLINE_REASONS, code, code ? 'Other' : '');

// Free text is mandatory when the picked code explains nothing on its own.
export const needsDetail = (code) => code === 'other';

export const isHelpType       = (code) => HELP_TYPES.some(t => t.code === code);
export const isDeclineReason  = (code) => DECLINE_REASONS.some(r => r.code === code);
