/**
 * SUBSCRIPTION & BILLING PRICING CONFIGURATION
 * Section 9 – Super Admin pricing rules
 *
 * Corporate model  → per-user fee based on tier
 * SACCO model      → base fee + per-member fee based on tier
 */

export const CLIENT_TYPE = {
  CORPORATE: 'corporate',
  SACCO: 'sacco',
};

export const TIER = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD:   'gold',
};

// ── Corporate pricing ─────────────────────────────────────────────────────────
export const CORPORATE_TIERS = {
  [TIER.BRONZE]: {
    label:                  'Bronze',
    pricePerUser:           240,          // KES
    externalSignings:       15,
    internalStaff:          'Unlimited',
    color:                  '#92400E',
    bg:                     '#FEF3C7',
    accent:                 '#D97706',
  },
  [TIER.SILVER]: {
    label:                  'Silver',
    pricePerUser:           320,
    externalSignings:       37,
    internalStaff:          'Unlimited',
    color:                  '#374151',
    bg:                     '#F3F4F6',
    accent:                 '#6B7280',
  },
  [TIER.GOLD]: {
    label:                  'Gold',
    pricePerUser:           390,
    externalSignings:       67,
    internalStaff:          'Unlimited',
    color:                  '#78350F',
    bg:                     '#FEF9C3',
    accent:                 '#CA8A04',
  },
};

// ── SACCO pricing ─────────────────────────────────────────────────────────────
export const SACCO_TIERS = {
  [TIER.BRONZE]: {
    label:                  'Bronze',
    baseFee:                200,          // KES
    perMemberFee:           50,
    externalSignings:       30,
    color:                  '#92400E',
    bg:                     '#FEF3C7',
    accent:                 '#D97706',
  },
  [TIER.SILVER]: {
    label:                  'Silver',
    baseFee:                300,
    perMemberFee:           50,
    externalSignings:       50,
    color:                  '#374151',
    bg:                     '#F3F4F6',
    accent:                 '#6B7280',
  },
  [TIER.GOLD]: {
    label:                  'Gold',
    baseFee:                400,
    perMemberFee:           50,
    externalSignings:       100,
    color:                  '#78350F',
    bg:                     '#FEF9C3',
    accent:                 '#CA8A04',
  },
};

// ── Shared ────────────────────────────────────────────────────────────────────
export const EXTRA_SIGNING_COST = 25; // KES per extra external document signing

/**
 * Calculate total monthly subscription for a corporate client.
 * @param {string} tier   - 'bronze' | 'silver' | 'gold'
 * @param {number} users  - number of licensed users
 * @param {number} extraSignings - extra external document signings beyond quota
 */
export function calcCorporateTotal(tier, users = 0, extraSignings = 0) {
  const t = CORPORATE_TIERS[tier];
  if (!t) return { base: 0, extra: 0, total: 0 };
  const base  = t.pricePerUser * users;
  const extra = extraSignings * EXTRA_SIGNING_COST;
  return { base, extra, total: base + extra };
}

/**
 * Calculate total monthly subscription for a SACCO client.
 * @param {string} tier    - 'bronze' | 'silver' | 'gold'
 * @param {number} members - number of SACCO members
 * @param {number} extraSignings - extra external document signings beyond quota
 */
export function calcSaccoTotal(tier, members = 0, extraSignings = 0) {
  const t = SACCO_TIERS[tier];
  if (!t) return { baseFee: 0, memberFee: 0, extra: 0, total: 0 };
  const baseFee   = t.baseFee;
  const memberFee = t.perMemberFee * members;
  const extra     = extraSignings * EXTRA_SIGNING_COST;
  return { baseFee, memberFee, extra, total: baseFee + memberFee + extra };
}
