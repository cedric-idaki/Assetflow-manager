/**
 * SACCO / CHAMA SUBSCRIPTION TIERS
 *
 * Tiered, usage-based billing per the Chama Management System BRS v3.0 §7.
 * The number of registered members selects the tier, which sets the monthly
 * base fee, the per-member fee, and the free storage quota — and the bill is
 * raised on at least MIN_BILLABLE_MEMBERS members, never fewer. Excess storage
 * is billed per GB. A one-time installation fee applies on first onboarding.
 *
 * Shared by the sacco registration path (src/pages/admin-registration) and the
 * Sacco dashboard billing tab (src/pages/sacco-dashboard) so pricing stays in
 * sync. Numbers come straight from BRS §7.1–§7.2.
 */

// One-time onboarding fee, charged on first registration only (BRS §7.1).
// Covers account setup, initial configuration and a 30-minute onboarding
// session with the administrator.
export const INSTALLATION_FEE = 4000; // KES

/**
 * SACCO MINIMUM BILLING — the fewest members a sacco / chama subscription is
 * ever priced on.
 *
 * A three-member chama is quoted, charged and invoiced as five. The floor
 * applies to the RECURRING per-member charge only: the tier's base fee, the
 * installation fee and every other applicable charge sit on top of it
 * untouched. So a first registration costs
 *
 *     base + (5 x perMemberFee) + modules + installation
 *
 * and a renewal base + (5 x perMemberFee) — KES 720/month on Bronze.
 *
 * WHY FIVE: it is the number Bronze already advertises as its floor ("5–50
 * members"). Before this, a 3-member chama paid KES 632 against a tier whose
 * own card says 720; the price list and the invoice disagreed, and the smaller
 * the sacco the wider the gap.
 *
 * WHY A FLOOR RATHER THAN A HIGHER BRONZE RATE: raising perMemberFee would move
 * every Bronze sacco's bill, including the 50-member ones. The floor moves only
 * the sub-minimum case, which is the one the business is unwilling to serve at
 * its own headcount's price. It is the same rule the Business line runs on
 * MIN_BILLABLE_USERS (companyPlans.js).
 *
 * KEEP IN SYNC: supabase/functions/_shared/plans.ts declares the same constant
 * and applies it the same way. If the two disagree, mpesa-stk-push refuses
 * every sacco registration below the floor with SUBSCRIPTION_PRICE_MISMATCH.
 */
export const MIN_BILLABLE_MEMBERS = 5;

/**
 * The member count a sacco subscription is PRICED on — never fewer than
 * MIN_BILLABLE_MEMBERS.
 *
 * Zero stays zero deliberately, exactly as billableUsers() does it: no members
 * means no subscription has been asked for, and a floor must not conjure a bill
 * out of a blank registration form. Only a real request (>= 1 member) is lifted
 * to the minimum. Idempotent, so it is safe to apply on both sides of a price
 * check.
 */
export const billableMembers = (n) => {
  const members = Math.max(0, Math.floor(Number(n) || 0));
  return members < 1 ? 0 : Math.max(members, MIN_BILLABLE_MEMBERS);
};

// Excess storage above the tier's free quota (BRS §7.2 / §7.5).
export const EXCESS_STORAGE_PER_GB = 10; // KES per additional GB / month

export const SACCO_TIERS = [
  {
    id: 'bronze',
    name: 'Bronze',
    minMembers: 5,
    maxMembers: 50,
    baseFee: 500,          // monthly Chama base fee (KES)
    perMemberFee: 44,      // per active member / month (KES)
    storageGb: 5,          // free storage
    memberRange: '5–50 members',
    color: '#CD7F32',
    features: ['5–50 members', 'KES 500 base / month', 'KES 44 per active member', '5 GB free storage'],
  },
  {
    id: 'silver',
    name: 'Silver',
    minMembers: 51,
    maxMembers: 110,
    baseFee: 700,
    perMemberFee: 36,
    storageGb: 10,
    memberRange: '51–110 members',
    color: '#C0C0C0',
    features: ['51–110 members', 'KES 700 base / month', 'KES 36 per active member', '10 GB free storage'],
    popular: true,
  },
  {
    id: 'gold',
    name: 'Gold',
    minMembers: 111,
    maxMembers: null,
    baseFee: 900,
    perMemberFee: 27,
    storageGb: 15,
    memberRange: '111+ members',
    color: '#C9A84C',
    features: ['111+ members', 'KES 900 base / month', 'KES 27 per active member', '15 GB free storage'],
  },
];

/** Pick the tier that covers the given active-member count (BRS §7.4). */
export const tierForMembers = (n) => {
  const count = parseInt(n, 10) || 0;
  if (count < 1) return SACCO_TIERS[0]; // default to Bronze for a brand-new sacco
  return (
    SACCO_TIERS.find((t) => count >= t.minMembers && (t.maxMembers == null || count <= t.maxMembers)) ||
    // Below the Bronze minimum (e.g. a 3-member starter chama) still bills as
    // Bronze — and, since billableMembers(), on Bronze's minimum quantity too.
    SACCO_TIERS[0]
  );
};

/** Look up a tier by its id (e.g. 'silver'). */
export const tierById = (id) => SACCO_TIERS.find((t) => t.id === id) || null;

/**
 * Monthly bill for a sacco (BRS §7.6 worked examples):
 *   base fee + (billed members × per-member fee) + storage excess.
 *
 * Billed members is billableMembers(members) — the sacco's own headcount, or
 * MIN_BILLABLE_MEMBERS if it has fewer. Returns a breakdown so the UI can
 * itemise it, including which figure the member charge was struck on: a sacco
 * that reads "3 members" and is billed for five must be told so on the page.
 */
export const calculateMonthlyBill = ({ members = 0, storageGb = 0, tier } = {}) => {
  const activeMembers = parseInt(members, 10) || 0;
  const billedMembers = billableMembers(activeMembers);
  // The tier is chosen on the BILLED count so the bracket and the quantity
  // charged against it can never disagree. (Both land on Bronze below 5 today —
  // it is written this way so that stays true if the tiers are ever re-cut.)
  const activeTier = tier
    ? (tierById(tier) || tierForMembers(billedMembers))
    : tierForMembers(billedMembers);
  const used = Number(storageGb) || 0;

  const baseFee = activeTier.baseFee;
  const perMemberFeeTotal = billedMembers * activeTier.perMemberFee;
  const excessGb = Math.max(0, Math.ceil(used - activeTier.storageGb));
  const storageFee = excessGb * EXCESS_STORAGE_PER_GB;
  const total = baseFee + perMemberFeeTotal + storageFee;

  return {
    tier: activeTier,
    members: activeMembers,                        // what the sacco actually has
    billedMembers,                                 // what it is priced on
    minimumApplied: billedMembers > activeMembers, // did the floor lift it?
    baseFee,
    perMemberFeeTotal,
    excessGb,
    storageFee,
    total,
  };
};
