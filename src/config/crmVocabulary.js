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

export default { LEAD_SOURCES, sourceMeta, LOST_REASONS, LOST_REASON_VALUES, lostReasonMeta, isLostLead };
