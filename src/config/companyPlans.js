/**
 * COMPANY (ADMIN) SUBSCRIPTION PLANS
 *
 * Per-user pricing by tier. The number of users an admin needs automatically
 * selects the tier (which also sets the free storage quota). Shared by the
 * registration wizard (src/pages/admin-registration) and the admin profile
 * plan management (src/pages/profile) so pricing never drifts between them.
 *
 * Stored on company_subscriptions as: plan_name = plan.id, max_users = seats,
 * price_paid = billed seats × pricePerUser (+ installation fee on first
 * registration), where billed seats is never below MIN_BILLABLE_USERS.
 */

// One-time fee, charged on first registration only. Renewals/upgrades must NOT
// re-charge it.
export const INSTALLATION_FEE = 4000; // KES

/**
 * BUSINESS MINIMUM BILLING — the fewest users a Business (company) subscription
 * is ever priced on.
 *
 * A one-person company is quoted, charged and provisioned as two seats. The
 * floor applies to the RECURRING user charge only: installation and every other
 * applicable charge sit on top of it untouched, so a first registration costs
 * (2 x pricePerUser) + installation + modules, and a renewal (2 x pricePerUser).
 *
 * WHY A FLOOR RATHER THAN A HIGHER BRONZE RATE: raising pricePerUser would move
 * every Bronze tenant's bill, including the 5-user ones. The floor moves only
 * the single-seat case, which is the one the business is unwilling to serve at
 * one user's price.
 *
 * Saccos and chamas have a floor of their own — MIN_BILLABLE_MEMBERS in
 * saccoTiers.js, on top of the flat base fee their tiers already carry. This
 * one governs the Business line only.
 *
 * KEEP IN SYNC: supabase/functions/_shared/plans.ts declares the same constant
 * and applies it the same way. If the two disagree, mpesa-stk-push refuses
 * every signup at the affected seat count.
 */
export const MIN_BILLABLE_USERS = 2;

/**
 * The seat count a company subscription is PRICED on — never fewer than
 * MIN_BILLABLE_USERS.
 *
 * Zero stays zero deliberately: no seats means no subscription has been asked
 * for, and a floor must not conjure a bill out of a blank form. Only a real
 * request (>= 1 seat) is lifted to the minimum. The function is idempotent, so
 * it is safe to apply on both sides of a price check.
 */
export const billableUsers = (n) => {
  const seats = Math.max(0, Math.floor(Number(n) || 0));
  return seats < 1 ? 0 : Math.max(seats, MIN_BILLABLE_USERS);
};

// Flat monthly platform fee, charged on top of the per-user rate. The corporate
// line prices entirely per-seat, so this is 0 on every tier today and the
// invoice suppresses the line — but src/config/systemBilling.js reads
// `plan.baseFee` for both product lines (the sacco tiers have a real one), so
// introducing a corporate base fee is a number here and nothing else. Change it
// together with pricePerUser: the two are one price, and
// supabase/functions/_shared/plans.ts must be updated to match or every signup
// fails the server-side amount check.

export const COMPANY_PLANS = [
  {
    id: 'bronze',
    name: 'Bronze',
    pricePerUser: 360,
    baseFee: 0,
    minUsers: 1,
    maxUsers: 5,
    storageGb: 5,
    userRange: '1–5 users',
    color: '#CD7F32',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    features: ['1–5 users', '5 GB free storage', 'Asset management', 'Client portal', 'Basic reporting'],
  },
  {
    id: 'silver',
    name: 'Silver',
    pricePerUser: 305,
    baseFee: 0,
    minUsers: 6,
    maxUsers: 16,
    storageGb: 10,
    userRange: '6–16 users',
    color: '#C0C0C0',
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    features: ['6–16 users', '10 GB free storage', 'Asset management', 'Client portal', 'Sales agent portal', 'KYC management', 'Advanced reporting'],
    popular: true,
  },
  {
    id: 'gold',
    name: 'Gold',
    pricePerUser: 267,
    baseFee: 0,
    minUsers: 17,
    maxUsers: null,
    storageGb: 15,
    userRange: '17+ users',
    color: '#C9A84C',
    bg: 'bg-yellow-50',
    border: 'border-yellow-300',
    features: ['17+ users', '15 GB free storage', 'Asset management', 'Client portal', 'Sales agent portal', 'KYC management', 'Full reporting', 'Priority support', 'Custom contracts'],
  },
];

/** Pick the tier that covers the requested number of users. */
export const planForUsers = (n) => {
  if (!n || n < 1) return null;
  return COMPANY_PLANS.find((p) => n >= p.minUsers && (p.maxUsers == null || n <= p.maxUsers)) || null;
};

/** Look up a plan by its id / plan_name (e.g. 'bronze'). */
export const planById = (id) => COMPANY_PLANS.find((p) => p.id === id) || null;

/**
 * Monthly subscription price for a given seat count (no installation fee).
 * Priced on billableUsers(n), so a 1-user company pays the 2-user minimum.
 */
export const subscriptionPriceFor = (n) => {
  const billed = billableUsers(n);
  const plan = planForUsers(billed);
  return plan ? billed * plan.pricePerUser : 0;
};
