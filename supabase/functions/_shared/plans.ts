// Server-side subscription pricing.
//
// WHY THIS FILE EXISTS: the amount an admin pays for portal access arrives from
// their browser (admin-registration computes `totalPrice` and posts it to
// mpesa-stk-push). Nothing server-side has ever checked it, and
// /admin-registration is a public route — so the price was whatever the payer
// said it was.
//
// SOURCE OF TRUTH WARNING: these numbers mirror src/config/companyPlans.js and
// src/config/saccoTiers.js. Deno cannot import those (different bundle), and
// public.subscription_plans is only ever read for its `id` — the app stores no
// price there. So this is a third copy, and a third copy drifts. If
// subscription_plans is given real price columns, replace the tables below with
// a read from it and delete them. Until then, any price change must be made in
// all three places.
//
// The formulas match the registration wizard exactly:
//   company: seats × pricePerUser  + INSTALLATION_FEE
//   sacco:   baseFee + members × perMemberFee + INSTALLATION_FEE
// The installation fee is first-registration only; renewals must not re-charge
// it, which is why chargeInstallation is a parameter rather than an assumption.

export const INSTALLATION_FEE = 4000; // KES, both product lines

interface CompanyPlan {
  id: string;
  pricePerUser: number;
  minUsers: number;
  maxUsers: number | null;
}

interface SaccoTier {
  id: string;
  baseFee: number;
  perMemberFee: number;
  minMembers: number;
  maxMembers: number | null;
}

const COMPANY_PLANS: CompanyPlan[] = [
  { id: 'silver', pricePerUser: 305, minUsers: 1, maxUsers: 5 },
  { id: 'bronze', pricePerUser: 360, minUsers: 6, maxUsers: 16 },
  { id: 'gold', pricePerUser: 267, minUsers: 17, maxUsers: null },
];

const SACCO_TIERS: SaccoTier[] = [
  { id: 'bronze', baseFee: 500, perMemberFee: 44, minMembers: 5, maxMembers: 50 },
  { id: 'silver', baseFee: 700, perMemberFee: 36, minMembers: 51, maxMembers: 110 },
  { id: 'gold', baseFee: 900, perMemberFee: 27, minMembers: 111, maxMembers: null },
];

/** Mirrors planForUsers() in companyPlans.js. */
function companyPlanForUsers(n: number): CompanyPlan | null {
  if (!n || n < 1) return null;
  return COMPANY_PLANS.find((p) => n >= p.minUsers && (p.maxUsers == null || n <= p.maxUsers)) ?? null;
}

/**
 * Mirrors tierForMembers() in saccoTiers.js — including the deliberate quirk
 * that a sacco below the Bronze minimum still bills as Bronze.
 */
function saccoTierForMembers(n: number): SaccoTier {
  const count = Number(n) || 0;
  if (count < 1) return SACCO_TIERS[0];
  return (
    SACCO_TIERS.find((t) => count >= t.minMembers && (t.maxMembers == null || count <= t.maxMembers)) ??
    SACCO_TIERS[0]
  );
}

/**
 * What a registration for `seats` should cost, in whole shillings.
 *
 * Note the seat count itself is caller-supplied and therefore untrusted — that
 * is fine and intended. The check this feeds enforces "you paid the right price
 * for what you claimed", and max_users then bounds what the account actually
 * gets. Someone can still buy a 1-seat plan; they cannot buy 50 seats for the
 * price of one.
 *
 * Returns null when no tier covers the request, which means the claim itself is
 * malformed and no amount can be verified against it.
 */
export function expectedSubscriptionPrice(
  { isSacco, seats, chargeInstallation = true }: {
    isSacco: boolean;
    seats: number;
    chargeInstallation?: boolean;
  },
): number | null {
  const n = Math.floor(Number(seats));
  if (!Number.isFinite(n) || n < 1) return null;

  const installation = chargeInstallation ? INSTALLATION_FEE : 0;

  if (isSacco) {
    const tier = saccoTierForMembers(n);
    return Math.round(tier.baseFee + n * tier.perMemberFee + installation);
  }

  const plan = companyPlanForUsers(n);
  if (!plan) return null;
  return Math.round(n * plan.pricePerUser + installation);
}
