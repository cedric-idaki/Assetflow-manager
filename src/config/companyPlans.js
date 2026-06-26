/**
 * COMPANY (ADMIN) SUBSCRIPTION PLANS
 *
 * Per-user pricing by tier. The number of users an admin needs automatically
 * selects the tier (which also sets the free storage quota). Shared by the
 * registration wizard (src/pages/admin-registration) and the admin profile
 * plan management (src/pages/profile) so pricing never drifts between them.
 *
 * Stored on company_subscriptions as: plan_name = plan.id, max_users = seats,
 * price_paid = seats × pricePerUser (+ installation fee on first registration).
 */

// One-time fee, charged on first registration only. Renewals/upgrades must NOT
// re-charge it.
export const INSTALLATION_FEE = 3000; // KES

export const COMPANY_PLANS = [
  {
    id: 'silver',
    name: 'Silver',
    pricePerUser: 305,
    minUsers: 1,
    maxUsers: 5,
    storageGb: 5,
    userRange: '1–5 users',
    color: '#C0C0C0',
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    features: ['1–5 users', '5 GB free storage', 'Asset management', 'Client portal', 'Basic reporting'],
  },
  {
    id: 'bronze',
    name: 'Bronze',
    pricePerUser: 360,
    minUsers: 6,
    maxUsers: 16,
    storageGb: 10,
    userRange: '6–16 users',
    color: '#CD7F32',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    features: ['6–16 users', '10 GB free storage', 'Asset management', 'Client portal', 'Sales agent portal', 'KYC management', 'Advanced reporting'],
    popular: true,
  },
  {
    id: 'gold',
    name: 'Gold',
    pricePerUser: 267,
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

/** Look up a plan by its id / plan_name (e.g. 'silver'). */
export const planById = (id) => COMPANY_PLANS.find((p) => p.id === id) || null;

/** Monthly subscription price for a given seat count (no installation fee). */
export const subscriptionPriceFor = (n) => {
  const plan = planForUsers(n);
  return plan ? n * plan.pricePerUser : 0;
};
