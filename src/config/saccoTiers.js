/**
 * SACCO / CHAMA SUBSCRIPTION TIERS
 *
 * Tiered, usage-based billing per the Chama Management System BRS v3.0 §7.
 * The number of registered members selects the tier, which sets the monthly
 * base fee, the per-member fee, and the free storage quota. Excess storage is
 * billed per GB. A one-time installation fee applies on first onboarding.
 *
 * Shared by the sacco registration path (src/pages/admin-registration) and the
 * Sacco dashboard billing tab (src/pages/sacco-dashboard) so pricing stays in
 * sync. Numbers come straight from BRS §7.1–§7.2.
 */

// One-time onboarding fee, charged on first registration only (BRS §7.1).
// Covers account setup, initial configuration and a 30-minute onboarding
// session with the administrator.
export const INSTALLATION_FEE = 3000; // KES

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
    // Below the Bronze minimum (e.g. a 3-member starter chama) still bills as Bronze.
    SACCO_TIERS[0]
  );
};

/** Look up a tier by its id (e.g. 'silver'). */
export const tierById = (id) => SACCO_TIERS.find((t) => t.id === id) || null;

/**
 * Monthly bill for a sacco (BRS §7.6 worked examples):
 *   base fee + (active members × per-member fee) + storage excess.
 * Returns a breakdown so the UI can itemise it.
 */
export const calculateMonthlyBill = ({ members = 0, storageGb = 0, tier } = {}) => {
  const activeTier = tier ? (tierById(tier) || tierForMembers(members)) : tierForMembers(members);
  const activeMembers = parseInt(members, 10) || 0;
  const used = Number(storageGb) || 0;

  const baseFee = activeTier.baseFee;
  const perMemberFeeTotal = activeMembers * activeTier.perMemberFee;
  const excessGb = Math.max(0, Math.ceil(used - activeTier.storageGb));
  const storageFee = excessGb * EXCESS_STORAGE_PER_GB;
  const total = baseFee + perMemberFeeTotal + storageFee;

  return { tier: activeTier, baseFee, perMemberFeeTotal, excessGb, storageFee, total };
};
