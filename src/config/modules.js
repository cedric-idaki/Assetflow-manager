/**
 * MODULE CATALOGUE — the one list every part of the portal reads.
 *
 * A tenant does not get "the system"; it gets the modules it chose. This file
 * is what the registration picker offers, what the sidebar filters against,
 * what ModuleGuard checks a route with, and what the Modules tab renders. Add
 * a module here and it appears in all four.
 *
 * ── KEEP IN SYNC ─────────────────────────────────────────────────────────────
 * `key` and `requires` are mirrored in public.module_catalogue() —
 * supabase/migrations/20260822150000_tenant_module_entitlements.sql. The
 * database owns enforcement (it refuses writes into a frozen module), so a key
 * that exists only here is a module the server has never heard of: the RPC
 * rejects it. Change one, change both.
 *
 * ── STATUSES ─────────────────────────────────────────────────────────────────
 *   enabled → normal
 *   frozen  → hidden from nav, route refuses, manual writes rejected by the
 *             database, and EVERY EXISTING ROW LEFT INTACT. Unfreezing brings
 *             it all back — nothing is deleted, ever.
 */

/**
 * scope — who is offered this module at registration:
 *   'company' | 'sacco' | 'chama' | 'all'
 * requires — modules that must be enabled for this one to work. Enabling a
 *   module enables what it needs; freezing one is refused while something
 *   enabled still depends on it. Enforced in set_tenant_module() too.
 * routes — paths ModuleGuard protects on this module's behalf.
 * core — cannot be switched off from the Modules tab. Freezing the client
 *   record or the payments ledger would strand data every other module reads.
 */
export const MODULES = [
  // ── Company / general back office ──────────────────────────────────────────
  {
    key: 'clients', label: 'Clients & Members', icon: 'Users', scope: 'all',
    core: true, requires: [], routes: [],
    desc: 'One record per person — the spine every other module hangs off.',
  },
  {
    key: 'assets', label: 'Inventory & Assets', icon: 'Package', scope: 'company',
    requires: [], routes: ['/asset-client-management'],
    desc: 'Track stock levels, asset records and movement in real time.',
  },
  {
    key: 'pos', label: 'Point of Sale', icon: 'ShoppingCart', scope: 'company',
    requires: ['assets'], routes: ['/pos'],
    desc: 'Sell at the counter and reconcile automatically.',
  },
  {
    key: 'hire_purchase', label: 'Hire Purchase', icon: 'CalendarClock', scope: 'company',
    requires: ['clients'], routes: [],
    desc: 'Installment plans tracked from sale to final payment.',
  },
  {
    key: 'payments', label: 'Payments & Collections', icon: 'CreditCard', scope: 'all',
    core: true, requires: [], routes: ['/payment-collections-hub', '/payment-confirmation-screen'],
    desc: 'Receipts, arrears and the collections desk.',
  },
  {
    key: 'mpesa', label: 'M-Pesa Collections', icon: 'Smartphone', scope: 'all',
    requires: ['payments'], routes: [],
    desc: 'Payments land and reconcile without manual entry.',
  },
  {
    key: 'kyc', label: 'KYC Management', icon: 'ShieldCheck', scope: 'all',
    requires: ['clients'], routes: ['/kyc-management-screen', '/kyc-renewal-management-screen'],
    desc: 'Collect, verify and renew identity documents.',
  },
  {
    key: 'esign', label: 'Digital Signing', icon: 'PenTool', scope: 'all',
    requires: [], routes: ['/e-signature'],
    desc: 'Send, sign and store agreements without printing a page.',
  },
  {
    key: 'contracts', label: 'Contracts', icon: 'FileSignature', scope: 'all',
    requires: [], routes: [],
    desc: 'Templates and the signed-agreement register.',
  },
  {
    key: 'crm', label: 'CRM & Leads', icon: 'PhoneCall', scope: 'all',
    requires: ['clients'], routes: [],
    desc: 'Interaction log, follow-ups and lead conversion.',
  },
  {
    key: 'hr', label: 'HR Management', icon: 'UserCog', scope: 'all',
    requires: [], routes: ['/hr-management'],
    desc: 'Staff records, leave and employee files.',
  },
  {
    key: 'payroll', label: 'Payroll', icon: 'Wallet', scope: 'all',
    requires: ['hr'], routes: [],
    desc: 'Pay staff correctly and on time, every cycle.',
  },
  {
    key: 'reports', label: 'Reports & Analytics', icon: 'BarChart3', scope: 'all',
    requires: [], routes: ['/reports-analytics-center'],
    desc: 'Complete visibility, ready whenever it is asked for.',
  },
  {
    key: 'accounting', label: 'Financial Accounting', icon: 'BookOpen', scope: 'all',
    requires: [], routes: ['/finance-hub'],
    desc: 'Books that stay balanced without a month-end scramble.',
  },
  {
    // NOT in any preset, deliberately — see migration 20260902160000. Filing
    // tax documents on a tenant's behalf is not a default anyone should acquire
    // by ticking a box they did not read: a business chooses this because KRA
    // requires it of them, and it does nothing at all until a device is
    // registered under Compliance → eTIMS.
    key: 'etims', label: 'KRA eTIMS', icon: 'Receipt', scope: 'all',
    requires: [], routes: [],
    desc: 'File every invoice with KRA and print the compliant tax receipt.',
  },

  // ── Sacco / chama ──────────────────────────────────────────────────────────
  {
    key: 'members', label: 'Membership Register', icon: 'Users', scope: 'sacco',
    core: true, requires: [], routes: [],
    desc: 'The member roll every sacco module is keyed to.',
  },
  {
    key: 'contributions', label: 'Contribution Tracking', icon: 'PiggyBank', scope: 'sacco',
    requires: ['members'], routes: [],
    desc: "Know exactly who has paid in, and who hasn't.",
  },
  {
    key: 'loans', label: 'Loans & Disbursement', icon: 'BadgeCheck', scope: 'sacco',
    requires: ['members'], routes: [],
    desc: 'Applications, approvals, disbursement and amortisation.',
  },
  {
    key: 'shares', label: 'Share Capital', icon: 'PieChart', scope: 'sacco',
    requires: ['members'], routes: [],
    desc: 'Share ledger, certificates, transfers and the internal market.',
  },
  {
    key: 'voting', label: 'Digital Voting', icon: 'Vote', scope: 'sacco',
    requires: ['members'], routes: [],
    desc: 'Run AGM and committee votes members can trust.',
  },
  {
    // Gated on the DOCUMENTS table only, never on sacco_fixed_assets itself —
    // that table is also the depreciation job's input, so gating it would mean
    // freezing the register broke the period-end close in `accounting`. See
    // 20260830200000_sacco_asset_register.sql §7.
    key: 'fixed_assets', label: 'Asset Register', icon: 'Package', scope: 'sacco',
    requires: [], routes: [],
    desc: 'Everything the society owns, what it is worth, and the paperwork for it.',
  },
  {
    key: 'welfare', label: 'Welfare Fund', icon: 'HeartHandshake', scope: 'chama',
    requires: ['members'], routes: [],
    desc: 'Contributions and claims register for a welfare group.',
  },
  {
    key: 'mgr', label: 'Merry-Go-Round', icon: 'RefreshCw', scope: 'chama',
    requires: ['members'], routes: [],
    desc: 'Rotating payout cycles for a chama.',
  },
];

/**
 * What each kind of organisation starts with. The picker pre-ticks these; the
 * registrant is free to tick more or untick any non-core one.
 *
 * `custom` is the answer to the "Other" problem: an organisation that is none
 * of the presets no longer types a word into a free-text box that nothing
 * reads — it picks its own modules and the portal is built from that.
 */
export const PRESETS = {
  company: ['clients', 'assets', 'pos', 'hire_purchase', 'payments', 'mpesa', 'kyc', 'esign', 'contracts', 'crm', 'reports'],
  sacco:   ['members', 'clients', 'contributions', 'loans', 'shares', 'voting', 'payments', 'mpesa', 'accounting', 'esign', 'reports', 'fixed_assets'],
  chama:   ['members', 'clients', 'contributions', 'mgr', 'welfare', 'payments', 'mpesa', 'reports'],
  custom:  ['clients', 'payments'],
};

export const PRESET_LABELS = {
  company: 'Business / Company',
  sacco:   'SACCO',
  chama:   'Chama / Welfare group',
  custom:  'Something else — let me pick',
};

export const MODULE_KEYS = MODULES.map((m) => m.key);

const BY_KEY = MODULES.reduce((acc, m) => { acc[m.key] = m; return acc; }, {});

export const moduleByKey = (key) => BY_KEY[key] || null;

export const moduleLabel = (key) => BY_KEY[key]?.label || key;

/** Modules a registrant of this organisation type should be shown. */
export const modulesForScope = (orgType) => {
  // A sacco is offered the chama add-ons too — many run both.
  const wanted = orgType === 'sacco'   ? ['all', 'sacco', 'chama']
               : orgType === 'chama'   ? ['all', 'sacco', 'chama']
               : orgType === 'company' ? ['all', 'company']
               : ['all', 'company', 'sacco', 'chama']; // custom: everything
  return MODULES.filter((m) => wanted.includes(m.scope));
};

/** Enabled modules that would break if `key` were frozen. */
export const dependentsOf = (key, isEnabled) =>
  MODULES.filter((m) => m.requires.includes(key) && isEnabled(m.key)).map((m) => m.key);

/** Modules that must come on with `key`, transitively. */
export const dependenciesOf = (key, seen = new Set()) => {
  const mod = BY_KEY[key];
  if (!mod || seen.has(key)) return [];
  seen.add(key);
  return mod.requires.flatMap((r) => [r, ...dependenciesOf(r, seen)]);
};

/**
 * Which module owns a path. Returns null for a path no module claims, which
 * ModuleGuard treats as "always allowed" — dashboards, the profile page and
 * system administration must never be gateable, or a tenant could freeze
 * themselves out of the switchboard that unfreezes everything else.
 */
export const moduleForRoute = (pathname) =>
  MODULES.find((m) => m.routes.includes(pathname))?.key || null;

export default MODULES;
