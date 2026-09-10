/**
 * Shared CRM vocabulary: where leads come from, and why they die.
 *
 * Both lists are CONTROLLED vocabularies, and that is the whole point. The
 * questions these exist to answer — "which sources actually work" and "why are
 * we losing" — are aggregations, and free text cannot be aggregated. One agent
 * typing "facebook", another "FB" and a third "Social media" produces three
 * rows in a report that should have one. Same reasoning as
 * crm_interactions.outcome.
 *
 * This lives in config rather than in either hook because BOTH ends need it and
 * neither owns it: the sales agent portal writes these values, the admin
 * oversight dashboard counts them. If the two ever disagree, the report is
 * silently wrong rather than broken — so there is one list.
 *
 * The database enforces the same set for lost_reason via a CHECK constraint
 * (20260828140000). Adding a value here means adding it there too.
 */

// ── Where the lead came from ───────────────────────────────────────────────
// These five values are what the lead registration form has always written, so
// they are fixed by the data already in the table, not chosen fresh here.
export const LEAD_SOURCES = [
  { value: 'referral',     label: 'Referral',     icon: 'Users'      },
  { value: 'website',      label: 'Website',      icon: 'Globe'      },
  { value: 'social_media', label: 'Social Media', icon: 'Share2'     },
  { value: 'walk_in',      label: 'Walk-in',      icon: 'DoorOpen'   },
  { value: 'cold_call',    label: 'Cold Call',    icon: 'PhoneCall'  },
];

/**
 * Describe a source value, including ones this list has never heard of.
 *
 * Legacy rows and hand-written imports carry whatever they carry; a report that
 * silently dropped them would under-count the total and quietly disagree with
 * the pipeline figure next to it. Unknown values are titled and kept.
 */
export const sourceMeta = (value) => {
  const key = String(value ?? '').trim();
  if (!key) return { value: null, label: 'Unspecified', icon: 'HelpCircle', known: false };

  const hit = LEAD_SOURCES.find(s => s.value === key.toLowerCase());
  if (hit) return { ...hit, known: true };

  return {
    value: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: 'HelpCircle',
    known: false,
  };
};

// ── Where the deal sits, and what that is worth ────────────────────────────
/**
 * The pipeline board, left to right, and the odds each stage carries.
 *
 * The ORDER and LABELS were already duplicated — useCrmOversight held one copy
 * for the admin dashboard and the agent portal held a bare array of stage keys
 * for the board — which is survivable while they are only strings. The moment a
 * NUMBER hangs off each stage it stops being survivable: a weighted forecast is
 * two multiplications, and if the agent's portal weights `qualified` at 40% and
 * the admin's dashboard weights it at 50%, the two screens quote different
 * money for the same pipeline and neither is wrong on its own terms. One list.
 *
 * `probability` is the share of deals at this stage that have historically been
 * expected to land. They are DEFAULTS, deliberately conservative, and a deal
 * that deserves better odds gets them per-deal via leads.win_probability.
 *
 * `closed` carries no probability because it has no odds left: the deal either
 * converted or it did not, and `stageProbability` reads converted_at to say
 * which. A stage weight there would be a forecast for something that already
 * happened.
 *
 * `isOpportunity` marks the stages a CRM would call an opportunity rather than
 * a lead — somebody has been qualified, or has an offer in front of them. This
 * schema has no separate opportunity record and does not need one; the stage IS
 * the opportunity, and this flag is the one place that says which stages count.
 */
export const PIPELINE_STAGES = [
  { value: 'new_lead',      label: 'New',           tone: 'slate',   probability: 10, isOpportunity: false },
  { value: 'contacted',     label: 'Contacted',     tone: 'blue',    probability: 20, isOpportunity: false },
  { value: 'qualified',     label: 'Qualified',     tone: 'violet',  probability: 40, isOpportunity: true  },
  { value: 'proposal_sent', label: 'Proposal sent', tone: 'amber',   probability: 60, isOpportunity: true  },
  { value: 'closed',        label: 'Closed',        tone: 'emerald', probability: null, isOpportunity: false },
];

/** Stage keys in board order — for anything that just needs the sequence. */
export const PIPELINE_STAGE_VALUES = PIPELINE_STAGES.map(s => s.value);

/** The stages that make a lead an opportunity. */
export const OPPORTUNITY_STAGES = PIPELINE_STAGES.filter(s => s.isOpportunity).map(s => s.value);

export const stageMeta = (value) => {
  const key = String(value ?? '').trim();
  const hit = PIPELINE_STAGES.find(s => s.value === key);
  if (hit) return { ...hit, known: true };

  // Same reasoning as sourceMeta: a stage this list has never heard of belongs
  // to a row that exists, and a board that silently dropped it would show the
  // agent fewer leads than they have. Odds of 0 rather than a guess — an
  // unknown stage must never inflate a forecast.
  return {
    value: key || null,
    label: key ? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown',
    tone: 'slate',
    probability: 0,
    isOpportunity: false,
    known: false,
  };
};

/**
 * Whether a lead is an opportunity: a real deal, not just a name in a list.
 *
 * Converted and lost leads are excluded even if their stage says otherwise —
 * an opportunity is by definition still winnable, and counting settled deals
 * in the open pipeline is how a forecast starts lying.
 */
export const isOpportunity = (lead) =>
  Boolean(lead)
  && !lead.converted_at
  && OPPORTUNITY_STAGES.includes(lead.stage);

// ── Why the deal died ──────────────────────────────────────────────────────
// Chosen to be ACTIONABLE: each one implies a different response. "Price" means
// re-look at the offer; "financing" means the lender step is the bottleneck;
// "no_stock" means the problem is inventory, not the agent. A list that cannot
// change what anybody does is just a tidier way of recording failure.
export const LOST_REASONS = [
  { value: 'price',        label: 'Too expensive',           hint: 'Wanted it, could not justify the price' },
  { value: 'financing',    label: 'Financing fell through',  hint: 'Loan or SACCO facility was not approved' },
  { value: 'competitor',   label: 'Bought elsewhere',        hint: 'Went with another seller' },
  { value: 'no_response',  label: 'Went silent',             hint: 'Stopped replying and could not be reached' },
  { value: 'not_ready',    label: 'Timing not right',        hint: 'Still interested, but not now' },
  { value: 'no_stock',     label: 'Nothing suitable',        hint: 'We had nothing matching what they wanted' },
  { value: 'unqualified',  label: 'Did not qualify',         hint: 'Could not afford it or failed checks' },
  { value: 'changed_mind', label: 'No longer interested',    hint: 'Changed their mind about buying at all' },
  { value: 'other',        label: 'Other',                   hint: 'Say what happened in the note' },
];

/** The set the database CHECK constraint accepts. Keep the two in step. */
export const LOST_REASON_VALUES = LOST_REASONS.map(r => r.value);

export const lostReasonMeta = (value) => {
  const key = String(value ?? '').trim();
  if (!key) return { value: null, label: 'Not recorded', hint: null, known: false };

  const hit = LOST_REASONS.find(r => r.value === key);
  if (hit) return { ...hit, known: true };

  return {
    value: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    hint: null,
    known: false,
  };
};

/**
 * Whether a lead counts as lost.
 *
 * The single definition, because three places need to agree on it: the agent
 * portal deciding whether to ask for a reason, the loss report counting rows,
 * and summarisePipeline's `lost` figure. A lead is lost when it reached the end
 * of the board WITHOUT converting — stage alone cannot say it, since 'closed'
 * is where winners and losers both come to rest.
 */
export const isLostLead = (lead) =>
  Boolean(lead) && lead.stage === 'closed' && !lead.converted_at;

// ── How we reach them ──────────────────────────────────────────────────────
/**
 * The channel a contact happened on, or will happen on.
 *
 * ONE list for both halves of the CRM, and that is the whole point. Before
 * this, the past lived in `crm_interactions.interaction_type` (call, whatsapp,
 * sms, email, meeting, site_visit, ...) and the future lived in
 * `follow_ups.appointment_type` (follow_up, phone_call, office_meeting,
 * site_visit) — two vocabularies, invented separately, that disagreed on the
 * same four things. `phone_call` and `call` are the same act; so are
 * `office_meeting` and `meeting`. And the scheduler's list had no email, no
 * WhatsApp and no SMS at all, so "I'll email her the payment plan on Friday"
 * had to be filed as a generic "follow-up" and the reminder could not say how.
 *
 * Two vocabularies means "we have emailed this lead four times and the next
 * two touches are also emails" is a question nobody can ask. Same reasoning as
 * LOST_REASONS above: a report is an aggregation, and values that do not match
 * cannot be aggregated.
 *
 * `loggable`   — can be recorded as something that already happened.
 * `schedulable`— can be booked as the next follow-up.
 *
 * A `note` is loggable but not schedulable (you cannot book a note), and
 * `follow_up` is schedulable but not loggable: it is the honest value for
 * "I will chase them, I have not decided how". It is also the historical
 * default of follow_ups.appointment_type, so every row written before this
 * list existed already reads correctly.
 */
export const CONTACT_CHANNELS = [
  { value: 'follow_up',  label: 'Check-in',      icon: 'PhoneCall',      tone: 'amber',   loggable: false, schedulable: true,  hint: 'Any channel' },
  { value: 'call',       label: 'Phone call',    icon: 'Phone',          tone: 'blue',    loggable: true,  schedulable: true,  hint: 'Ring them' },
  { value: 'whatsapp',   label: 'WhatsApp',      icon: 'MessageCircle',  tone: 'emerald', loggable: true,  schedulable: true,  hint: 'Message them' },
  { value: 'sms',        label: 'SMS',           icon: 'MessageSquare',  tone: 'slate',   loggable: true,  schedulable: true,  hint: 'Text them' },
  { value: 'email',      label: 'Email',         icon: 'Mail',           tone: 'violet',  loggable: true,  schedulable: true,  hint: 'Write to them' },
  { value: 'meeting',    label: 'Meeting',       icon: 'Users',          tone: 'amber',   loggable: true,  schedulable: true,  hint: 'They come in' },
  { value: 'site_visit', label: 'Site visit',    icon: 'MapPin',         tone: 'orange',  loggable: true,  schedulable: true,  hint: 'You go to them' },
  { value: 'proposal',   label: 'Proposal',      icon: 'FileText',       tone: 'indigo',  loggable: true,  schedulable: true,  hint: 'Send the offer' },
  { value: 'note',       label: 'Note',          icon: 'StickyNote',     tone: 'slate',   loggable: true,  schedulable: false, hint: 'Just a record' },
  { value: 'other',      label: 'Other',         icon: 'Circle',         tone: 'slate',   loggable: true,  schedulable: true,  hint: 'Something else' },
];

/**
 * What the two old vocabularies called these before there was one.
 *
 * Kept rather than migrated-and-forgotten: the database normalises writes
 * through a trigger (20260829140000), but a browser tab that was open across
 * the deploy still sends `phone_call`, and a report reading rows written a year
 * ago still has to name them. Resolving here means neither shows up as an
 * unknown channel.
 */
const CHANNEL_ALIASES = {
  phone_call:     'call',
  office_meeting: 'meeting',
  phonecall:      'call',
  whats_app:      'whatsapp',
  'follow-up':    'follow_up',
  followup:       'follow_up',
  text:           'sms',
  visit:          'site_visit',
};

/** Channels an agent can book as the next touch. */
export const SCHEDULABLE_CHANNELS = CONTACT_CHANNELS.filter(c => c.schedulable);

/** Channels an agent can record as having already happened. */
export const LOGGABLE_CHANNELS = CONTACT_CHANNELS.filter(c => c.loggable);

/** The set the follow_ups.appointment_type CHECK constraint accepts. */
export const FOLLOW_UP_CHANNEL_VALUES = SCHEDULABLE_CHANNELS.map(c => c.value);

/**
 * Describe a channel, including values this list has never heard of.
 *
 * Unknown values are titled and kept rather than dropped, for the same reason
 * sourceMeta keeps them: a row that renders as nothing is a row the agent
 * thinks they never wrote.
 */
export const channelMeta = (value) => {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return { value: null, label: 'Contact', icon: 'Circle', tone: 'slate', known: false };

  const canonical = CHANNEL_ALIASES[key] || key;
  const hit = CONTACT_CHANNELS.find(c => c.value === canonical);
  if (hit) return { ...hit, known: true };

  return {
    value: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: 'Circle',
    tone: 'slate',
    known: false,
  };
};

/**
 * Canonicalise a channel for WRITING.
 *
 * channelMeta preserves what it does not recognise so old rows still read;
 * this one does the opposite, because the column it feeds is constrained and a
 * value outside the set would be rejected outright. Anything unrecognised
 * becomes `fallback` — the write lands, and 'other' is at least true.
 */
export const toChannelValue = (value, fallback = 'other') => {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) return fallback;
  const canonical = CHANNEL_ALIASES[key] || key;
  return CONTACT_CHANNELS.some(c => c.value === canonical) ? canonical : fallback;
};

/**
 * Canonicalise a channel for the follow_ups table specifically.
 *
 * Narrower than toChannelValue because the schedulable set is narrower: a
 * `note` is a real interaction type but not something you can book, and the
 * column's CHECK constraint does not accept it. Carrying the channel over from
 * a logged contact -- log a note, then schedule the next touch -- is exactly
 * where that value would otherwise arrive.
 */
export const toFollowUpChannel = (value, fallback = 'follow_up') => {
  const canonical = toChannelValue(value, fallback);
  return FOLLOW_UP_CHANNEL_VALUES.includes(canonical) ? canonical : fallback;
};

export default {
  LEAD_SOURCES, sourceMeta,
  PIPELINE_STAGES, PIPELINE_STAGE_VALUES, OPPORTUNITY_STAGES, stageMeta, isOpportunity,
  LOST_REASONS, LOST_REASON_VALUES, lostReasonMeta, isLostLead,
  CONTACT_CHANNELS, SCHEDULABLE_CHANNELS, LOGGABLE_CHANNELS,
  FOLLOW_UP_CHANNEL_VALUES, channelMeta, toChannelValue, toFollowUpChannel,
};
