/**
 * How a client came to us: directly, or through a sales agent.
 *
 * A CONTROLLED vocabulary, for the same reason LEAD_SOURCES in crmVocabulary.js
 * is one — the question it exists to answer ("how much of our book did the
 * agents actually bring in?") is an aggregation, and an aggregation over values
 * that disagree is a report that is quietly wrong rather than visibly broken.
 *
 * It lives in config because three ends need it and none owns it: the public
 * registration page writes it, the admin client list reads it, and the report
 * builder counts it. The database enforces the same two values through
 * clients_acquisition_channel_chk (20260830220000). Adding a value here means
 * adding it there too.
 *
 * WHY THIS IS NOT JUST `agent_id === null`
 *
 *   clients.agent_id is ON DELETE SET NULL. When an agent leaves, every client
 *   they signed would silently become a walk-in and the commission history
 *   would rewrite itself. Reassigning a live account to a different agent is
 *   account management, not re-acquisition, and it must not move the number
 *   either. The channel is a fact about the day the client arrived, frozen at
 *   insert by set_client_acquisition_channel().
 */

// ── Who won the customer ───────────────────────────────────────────────────
export const ACQUISITION_CHANNELS = [
  {
    value: 'direct',
    label: 'Direct',
    icon: 'Building2',
    tone: 'blue',
    hint: 'Came to the company on their own — no agent involved',
  },
  {
    value: 'agent',
    label: 'Sales agent',
    icon: 'UserCheck',
    tone: 'violet',
    hint: 'Introduced and signed by a sales agent',
  },
];

/** The set the database CHECK constraint accepts. Keep the two in step. */
export const ACQUISITION_CHANNEL_VALUES = ACQUISITION_CHANNELS.map(c => c.value);

/**
 * Describe a channel, including values this list has never heard of.
 *
 * Unknown values are titled and kept rather than dropped, the same way
 * sourceMeta keeps them: a client row that renders as nothing is a client the
 * admin thinks they do not have.
 */
export const channelMeta = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return { value: null, label: 'Unrecorded', icon: 'HelpCircle', tone: 'slate', hint: null, known: false };

  const hit = ACQUISITION_CHANNELS.find(c => c.value === key);
  if (hit) return { ...hit, known: true };

  return {
    value: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: 'HelpCircle',
    tone: 'slate',
    hint: null,
    known: false,
  };
};

// ── How the row came to exist ──────────────────────────────────────────────
/**
 * A second axis, deliberately not folded into the first.
 *
 * `acquisition_channel` answers the commission question: who won this customer.
 * This answers the trust question: who typed the record in. A walk-in entered
 * by the office and a stranger who signed themselves up online are both
 * 'direct', and staff need to be able to tell them apart — the second one has
 * not been met by anybody yet, which is why self-service accounts are created
 * `pending` and wait for activation.
 */
export const REGISTRATION_SOURCES = [
  { value: 'staff',        label: 'Entered by staff', icon: 'Keyboard',  tone: 'slate'   },
  { value: 'agent_portal', label: 'Agent portal',     icon: 'UserCheck', tone: 'violet'  },
  { value: 'self_service', label: 'Self-registered',  icon: 'Globe',     tone: 'emerald' },
  { value: 'import',       label: 'Imported',         icon: 'Upload',    tone: 'slate'   },
];

export const REGISTRATION_SOURCE_VALUES = REGISTRATION_SOURCES.map(s => s.value);

export const sourceMeta = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return { value: null, label: 'Unrecorded', icon: 'HelpCircle', tone: 'slate', known: false };

  const hit = REGISTRATION_SOURCES.find(s => s.value === key);
  if (hit) return { ...hit, known: true };

  return {
    value: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: 'HelpCircle',
    tone: 'slate',
    known: false,
  };
};

/** Signed themselves up and nobody has looked at them yet. */
export const isAwaitingActivation = (client) =>
  Boolean(client)
  && client.registration_source === 'self_service'
  && client.client_status === 'pending';

/**
 * The registration link a company hands out.
 *
 * One place builds it, because it is pasted into WhatsApp, printed on a card
 * and read out over the phone — three copies of the URL shape is three chances
 * for one of them to drift and send people to a 404.
 */
export const signupLink = (code, origin) => {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/user-registration-screen?code=${encodeURIComponent(String(code || '').trim())}`;
};

export default {
  ACQUISITION_CHANNELS, ACQUISITION_CHANNEL_VALUES, channelMeta,
  REGISTRATION_SOURCES, REGISTRATION_SOURCE_VALUES, sourceMeta,
  isAwaitingActivation, signupLink,
};
