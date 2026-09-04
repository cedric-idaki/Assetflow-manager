/**
 * REPORT CATALOGUE — what a custom report is allowed to be built from.
 *
 * The report builder lets a user name a table, a set of columns and a set of
 * predicates. That is a query language pointed at the tenant's own database, so
 * the first question is what it may name. This file is the answer: an
 * ALLOWLIST, not a reflection of the schema.
 *
 * ── WHY AN ALLOWLIST AND NOT information_schema ──────────────────────────────
 *
 * Reflecting the live schema would be less code and would be wrong three ways:
 *
 *   1. It would offer columns that exist for the machine, not the reader —
 *      stripe_payment_method_id, retry_count, updated_at on every table. A
 *      field picker with 400 entries is a field picker nobody uses.
 *   2. It would offer columns that must never leave the module that owns them.
 *      Employee bank details, NSSF numbers and next-of-kin IDs are sealed in
 *      employee_private_data under PII_ENC_KEY precisely so that no general
 *      query path can read them; a reflected catalogue would re-open that door
 *      the day somebody adds a plaintext column back.
 *   3. It would drift silently. A column renamed in a migration would take the
 *      saved reports that named it with no warning, because nothing would have
 *      declared the dependency. Here, a renamed column is a one-line edit in a
 *      file that says which reports depended on it.
 *
 * ── WHAT ACTUALLY ENFORCES ACCESS ────────────────────────────────────────────
 *
 * RLS. Every query the builder runs goes out under the caller's own JWT, so the
 * database decides what comes back, exactly as it does for every other screen.
 * The `roles` list on each source below decides what a user is OFFERED, which
 * is a product decision and a defence-in-depth layer — it is not the boundary.
 * A user who edits the running JavaScript can ask for a source they were not
 * offered, and will get precisely what RLS lets them have and nothing more.
 * That is the correct division: the catalogue shapes the tool, the database
 * guards the data.
 *
 * ── MODULES ──────────────────────────────────────────────────────────────────
 *
 * Each source names the module it belongs to. A tenant that has frozen a module
 * does not see its data offered here, for the same reason the nav hides it —
 * see src/config/modules.js. Freezing never deletes rows, so a saved report
 * against a frozen module is kept and simply refuses to run until it is back.
 *
 * ── KEEP IN SYNC ─────────────────────────────────────────────────────────────
 *
 * `table` and every `column` must exist in the live schema, and `module` must
 * be a key in MODULES. src/config/reportSchema.test.js asserts the module keys
 * and the internal consistency of each source; the columns themselves are
 * checked against the migrations by hand when a source is added.
 */

import { MODULE_KEYS } from './modules';
import { LEAD_SOURCES, LOST_REASONS, CONTACT_CHANNELS, SCHEDULABLE_CHANNELS } from './crmVocabulary';
import {
  ACQUISITION_CHANNEL_VALUES, REGISTRATION_SOURCE_VALUES,
} from './clientAcquisition';

// ─── FIELD TYPES ─────────────────────────────────────────────────────────────
/**
 * A field's type decides three things and nothing else: which operators it may
 * be filtered with, how a cell is rendered, and whether it can be added up.
 *
 * `money` is `number` that formats as KES. `datetime` is `date` that keeps the
 * clock time when rendered.
 *
 * `month` is its own type and not a `date`, because one real column is stored
 * that way: payroll_records.pay_month holds 'YYYY-MM'. Treating it as a date
 * would compare '2026-08' against '2026-08-01', which is FALSE lexicographically
 * — so "payroll for August" would return nothing at all, and look like a month
 * where nobody was paid. A month field compares against 'YYYY-MM' bounds.
 */
export const FIELD_TYPES = ['text', 'number', 'money', 'date', 'datetime', 'month', 'boolean', 'enum'];

const NUMERIC_TYPES  = ['number', 'money'];
const TEMPORAL_TYPES = ['date', 'datetime', 'month'];

export const isNumericType  = (type) => NUMERIC_TYPES.includes(type);
export const isTemporalType = (type) => TEMPORAL_TYPES.includes(type);

// ─── OPERATORS ───────────────────────────────────────────────────────────────
/**
 * The filter vocabulary. `arity` is how many values the user must supply, and
 * it is what stops a half-filled filter from being applied: a `between` with
 * one date is not a narrower query, it is a different one.
 *
 * `types` is which field types the operator is offered for. Note what is NOT
 * here: no free-form SQL, no `or`, no raw PostgREST pass-through. Every filter
 * a user can build is one of these against one catalogued column, which is what
 * makes a saved definition safe to store and re-run months later.
 */
export const OPERATORS = [
  { value: 'is',           label: 'is',           arity: 1,      types: ['text', 'number', 'money', 'date', 'datetime', 'month', 'enum'] },
  { value: 'is_not',       label: 'is not',       arity: 1,      types: ['text', 'number', 'money', 'date', 'datetime', 'month', 'enum'] },
  { value: 'contains',     label: 'contains',     arity: 1,      types: ['text'] },
  { value: 'starts_with',  label: 'starts with',  arity: 1,      types: ['text'] },
  { value: 'gt',           label: 'is more than', arity: 1,      types: ['number', 'money'] },
  { value: 'gte',          label: 'is at least',  arity: 1,      types: ['number', 'money'] },
  { value: 'lt',           label: 'is less than', arity: 1,      types: ['number', 'money'] },
  { value: 'lte',          label: 'is at most',   arity: 1,      types: ['number', 'money'] },
  { value: 'after',        label: 'is after',     arity: 1,      types: ['date', 'datetime', 'month'] },
  { value: 'before',       label: 'is before',    arity: 1,      types: ['date', 'datetime', 'month'] },
  { value: 'between',      label: 'is between',   arity: 2,      types: ['number', 'money', 'date', 'datetime', 'month'] },
  { value: 'any_of',       label: 'is any of',    arity: 'list', types: ['enum', 'text'] },
  { value: 'none_of',      label: 'is none of',   arity: 'list', types: ['enum', 'text'] },
  { value: 'is_true',      label: 'is yes',       arity: 0,      types: ['boolean'] },
  { value: 'is_false',     label: 'is no',        arity: 0,      types: ['boolean'] },
  { value: 'is_empty',     label: 'is blank',     arity: 0,      types: ['text', 'number', 'money', 'date', 'datetime', 'month', 'enum'] },
  { value: 'is_not_empty', label: 'is not blank', arity: 0,      types: ['text', 'number', 'money', 'date', 'datetime', 'month', 'enum'] },
];

const OPERATOR_BY_VALUE = OPERATORS.reduce((acc, op) => { acc[op.value] = op; return acc; }, {});

export const operatorByValue = (value) => OPERATOR_BY_VALUE[value] || null;

/** Operators offered for a field type. */
export const operatorsForType = (type) => OPERATORS.filter((op) => op.types.includes(type));

// ─── AGGREGATIONS ────────────────────────────────────────────────────────────
/**
 * `count` counts rows and so applies to any field. The rest need something to
 * add up, so they are numeric only — offering "average status" would produce a
 * column of NaN and a reader who stops trusting the whole report.
 */
export const AGGREGATIONS = [
  { value: 'count', label: 'Count',   types: 'any' },
  { value: 'sum',   label: 'Sum',     types: NUMERIC_TYPES },
  { value: 'avg',   label: 'Average', types: NUMERIC_TYPES },
  { value: 'min',   label: 'Minimum', types: NUMERIC_TYPES },
  { value: 'max',   label: 'Maximum', types: NUMERIC_TYPES },
];

export const aggregationsForType = (type) =>
  AGGREGATIONS.filter((a) => a.types === 'any' || a.types.includes(type));

// ─── REPORTING PERIODS ───────────────────────────────────────────────────────
/**
 * Why a saved report stores a PRESET and not two dates.
 *
 * "Collections this month" saved with 1–31 August is a report that is wrong on
 * 1 September and stays wrong forever, while still looking like it ran. The
 * preset is resolved against the clock at RUN time — see resolvePeriod() in
 * src/utils/reportQuery.js — so the saved thing is the question, not one
 * answer to it. `custom` is the escape hatch for a genuinely fixed window (an
 * audit of one quarter), and only then are absolute dates stored.
 */
export const PERIOD_PRESETS = [
  { value: 'all',          label: 'All time'      },
  { value: 'today',        label: 'Today'         },
  { value: 'this_week',    label: 'This week'     },
  { value: 'this_month',   label: 'This month'    },
  { value: 'last_month',   label: 'Last month'    },
  { value: 'this_quarter', label: 'This quarter'  },
  { value: 'this_year',    label: 'This year'     },
  { value: 'last_7_days',  label: 'Last 7 days'   },
  { value: 'last_30_days', label: 'Last 30 days'  },
  { value: 'last_90_days', label: 'Last 90 days'  },
  { value: 'custom',       label: 'Custom range…' },
];

export const PERIOD_PRESET_VALUES = PERIOD_PRESETS.map((p) => p.value);

/** Buckets a date field can be grouped into. */
export const DATE_GRANULARITIES = [
  { value: 'day',   label: 'By day'   },
  { value: 'month', label: 'By month' },
  { value: 'year',  label: 'By year'  },
];

// ─── ROLE GROUPS ─────────────────────────────────────────────────────────────
/**
 * Who is OFFERED what. Grouped rather than repeated per source so that a new
 * role is added in one place, and so the intent of each group stays readable.
 *
 * Deliberately absent everywhere: `client`, `sacco_member` and `sales_agent`.
 * The first two are the tenant's customers and have their own portals. The
 * third is the SUBJECT of half these reports rather than a reader of them — an
 * agent's own numbers are already in the sales portal, and a tool that reports
 * across the whole pipeline is a supervisor's tool. Same line
 * CRM_SUPERVISOR_ROLES draws in useCrmOversight.
 */
const OWNERS   = ['super_admin', 'admin', 'sacco_admin'];
const EXEC     = [...OWNERS, 'director', 'manager'];
const FINANCE  = [...OWNERS, 'director', 'finance', 'accountant'];
const COMMERCE = [...EXEC, 'operations', 'collections_officer', 'collections', 'finance', 'accountant'];
const PEOPLE   = [...OWNERS, 'director', 'hr'];

/** Anyone who may open the builder at all. The union of every source's roles. */
export const REPORT_BUILDER_ROLES = Array.from(new Set([...COMMERCE, ...FINANCE, ...PEOPLE]));

export const canBuildReports = (role) => REPORT_BUILDER_ROLES.includes(role);

// ─── HELPERS FOR THE CATALOGUE BELOW ─────────────────────────────────────────
const titleCase = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const enumOptions = (values) =>
  values.map((v) => (typeof v === 'string'
    ? { value: v, label: titleCase(v) }
    : { value: v.value, label: v.label }));

/** A field read through a PostgREST embed rather than off the row itself. */
const joined = (key, label, alias, table, column, extra = {}) => ({
  key,
  label,
  type: 'text',
  join: { alias, table, column },
  // Embedded columns are display-only. PostgREST CAN filter on them, but only
  // by turning the embed into an inner join, which silently drops every row
  // with no parent — a payment whose client was deleted would vanish from a
  // report that never asked it to. Filter on this table's own columns instead.
  filterable: false,
  sortable: false,
  ...extra,
});

// ─── THE CATALOGUE ───────────────────────────────────────────────────────────
/**
 * One entry per reportable table.
 *
 * `tenant` is how rows are narrowed to the caller's own organisation:
 *
 *   { mode: 'column', column: 'admin_id' }
 *       The table carries a tenant key. The client adds the filter too — a
 *       NARROWING of what RLS already allows, so a tampered request can only
 *       ever ask for less, never more. Same rule as useCrmOversight.
 *
 *   { mode: 'rls' }
 *       The table has no tenant key of its own and its policies scope it
 *       through a parent (installment_plans through clients.admin_id, leads
 *       and follow_ups through agents.admin_id). A client-side filter would
 *       mean pulling the whole parent id list into the request URL, so the
 *       server does it alone — as it already does for every other screen
 *       reading these tables.
 *
 * `dateField` is the column the reporting period applies to. A source without
 * one cannot be period-filtered, and the UI says so rather than filtering on
 * some other date and quietly answering a different question.
 *
 * `pending: true` on a field means it was added by a migration that may not be
 * applied to every database yet. Naming a missing column fails the WHOLE query,
 * so the runner retries without them — see useReportBuilder.
 */
export const REPORT_SOURCES = [
  // ── Clients ───────────────────────────────────────────────────────────────
  {
    key: 'clients',
    label: 'Clients',
    description: 'The customer register — status, balances and who signed them up.',
    icon: 'Users',
    table: 'clients',
    module: 'clients',
    roles: COMMERCE,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'created_at',
    defaultFields: ['account_number', 'full_name', 'phone', 'client_status', 'outstanding_balance', 'created_at'],
    fields: [
      { key: 'account_number',      label: 'Account no.', type: 'text',     column: 'account_number' },
      { key: 'full_name',           label: 'Client',      type: 'text',     column: 'full_name' },
      { key: 'email',               label: 'Email',       type: 'text',     column: 'email' },
      { key: 'phone',               label: 'Phone',       type: 'text',     column: 'phone' },
      { key: 'client_status',       label: 'Status',      type: 'enum',     column: 'client_status',
        options: enumOptions(['active', 'inactive', 'suspended', 'pending']) },
      { key: 'city',                label: 'Town / City', type: 'text',     column: 'city' },
      { key: 'country',             label: 'Country',     type: 'text',     column: 'country' },
      { key: 'address',             label: 'Address',     type: 'text',     column: 'address' },
      { key: 'credit_score',        label: 'Credit score', type: 'number',  column: 'credit_score' },
      { key: 'total_assets',        label: 'Items held',  type: 'number',   column: 'total_assets' },
      { key: 'outstanding_balance', label: 'Outstanding', type: 'money',    column: 'outstanding_balance' },
      { key: 'notes',               label: 'Notes',       type: 'text',     column: 'notes' },
      { key: 'created_at',          label: 'Registered',  type: 'datetime', column: 'created_at' },
      { key: 'updated_at',          label: 'Last updated', type: 'datetime', column: 'updated_at' },
      { key: 'acquisition_channel', label: 'Acquired via', type: 'enum',
        column: 'acquisition_channel', options: enumOptions(ACQUISITION_CHANNEL_VALUES) },
      { key: 'registration_source', label: 'Registered by', type: 'enum',
        column: 'registration_source', options: enumOptions(REGISTRATION_SOURCE_VALUES) },
      joined('agent_name', 'Signed up by', 'agent', 'agents', 'full_name'),
      // acquisition_channel rather than agent_name is what a commission split
      // should be counted off: agents.agent_id is ON DELETE SET NULL, so the
      // joined name goes blank the day an agent leaves and every client they
      // ever signed silently reads as a walk-in.
      //
      // national_id is deliberately absent: it identifies a person and answers
      // no reporting question that account_number does not answer better.
    ],
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    key: 'payments',
    label: 'Payments',
    description: 'Every receipt — amount, method, status and what it was against.',
    icon: 'CreditCard',
    table: 'payments',
    module: 'payments',
    roles: COMMERCE,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'payment_date',
    defaultFields: ['payment_date', 'client_name', 'amount', 'payment_method', 'payment_status'],
    fields: [
      { key: 'transaction_id',   label: 'Transaction', type: 'text',     column: 'transaction_id' },
      { key: 'payment_date',     label: 'Paid on',     type: 'datetime', column: 'payment_date' },
      { key: 'amount',           label: 'Amount',      type: 'money',    column: 'amount' },
      { key: 'payment_method',   label: 'Method',      type: 'enum',     column: 'payment_method',
        options: enumOptions(['cash', 'bank_transfer', 'mpesa', 'cheque', 'card']) },
      { key: 'payment_status',   label: 'Status',      type: 'enum',     column: 'payment_status',
        options: enumOptions(['pending', 'completed', 'failed', 'reversed']) },
      { key: 'reference_number', label: 'Reference',   type: 'text',     column: 'reference_number' },
      { key: 'notes',            label: 'Notes',       type: 'text',     column: 'notes' },
      { key: 'created_at',       label: 'Recorded',    type: 'datetime', column: 'created_at' },
      joined('client_name', 'Client', 'client', 'clients', 'full_name'),
      joined('asset_code',  'Item',   'asset',  'assets',  'asset_code'),
      joined('agent_name',  'Agent',  'agent',  'agents',  'full_name'),
    ],
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  {
    key: 'assets',
    label: 'Inventory & Assets',
    description: 'Stock and asset records — value, condition and where they are.',
    icon: 'Package',
    table: 'assets',
    module: 'assets',
    roles: COMMERCE,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'created_at',
    defaultFields: ['asset_code', 'description', 'asset_type', 'asset_status', 'selling_price'],
    fields: [
      { key: 'asset_code',     label: 'Code',          type: 'text',     column: 'asset_code' },
      { key: 'description',    label: 'Description',   type: 'text',     column: 'description' },
      // The last four came from 20260721100500, which extended asset_type for
      // multi-type dealers. Leaving them out would not break the report — it
      // would just make every electronics or furniture item unfilterable, which
      // is the quieter failure.
      { key: 'asset_type',     label: 'Type',          type: 'enum',     column: 'asset_type',
        options: enumOptions(['property', 'vehicle', 'equipment', 'other',
                              'construction_dealers', 'electronics', 'furnitures', 'heavy_equipment']) },
      { key: 'asset_status',   label: 'Status',        type: 'enum',     column: 'asset_status',
        options: enumOptions(['available', 'reserved', 'sold', 'under_maintenance']) },
      { key: 'purchase_price', label: 'Cost',          type: 'money',    column: 'purchase_price' },
      { key: 'selling_price',  label: 'Selling price', type: 'money',    column: 'selling_price' },
      { key: 'current_value',  label: 'Current value', type: 'money',    column: 'current_value' },
      { key: 'location',       label: 'Location',      type: 'text',     column: 'location' },
      { key: 'serial_number',  label: 'Serial no.',    type: 'text',     column: 'serial_number' },
      { key: 'make',           label: 'Make',          type: 'text',     column: 'make' },
      { key: 'model',          label: 'Model',         type: 'text',     column: 'model' },
      { key: 'year',           label: 'Year',          type: 'number',   column: 'year' },
      { key: 'plate_number',   label: 'Plate no.',     type: 'text',     column: 'plate_number' },
      { key: 'created_at',     label: 'Added',         type: 'datetime', column: 'created_at' },
      joined('client_name', 'Assigned to', 'linked_client', 'clients', 'full_name'),
    ],
  },

  // ── Hire purchase ─────────────────────────────────────────────────────────
  {
    key: 'installment_plans',
    label: 'Installment Plans',
    description: 'Hire-purchase agreements and how far through them each client is.',
    icon: 'CalendarClock',
    table: 'installment_plans',
    module: 'hire_purchase',
    roles: COMMERCE,
    // No admin_id on this table — installment_plans_tenant_staff scopes it
    // through clients.admin_id (20260802170000).
    tenant: { mode: 'rls' },
    dateField: 'start_date',
    defaultFields: ['client_name', 'plan_name', 'total_amount', 'installments_paid', 'total_installments', 'plan_status'],
    fields: [
      { key: 'plan_name',          label: 'Plan',            type: 'text',   column: 'plan_name' },
      { key: 'total_amount',       label: 'Total',           type: 'money',  column: 'total_amount' },
      { key: 'installment_amount', label: 'Per installment', type: 'money',  column: 'installment_amount' },
      { key: 'total_installments', label: 'Installments',    type: 'number', column: 'total_installments' },
      { key: 'installments_paid',  label: 'Paid',            type: 'number', column: 'installments_paid' },
      { key: 'frequency',          label: 'Frequency',       type: 'enum',   column: 'frequency',
        options: enumOptions(['weekly', 'biweekly', 'monthly', 'quarterly']) },
      { key: 'plan_status',        label: 'Status',          type: 'enum',   column: 'plan_status',
        options: enumOptions(['active', 'paused', 'completed', 'cancelled', 'failed']) },
      { key: 'start_date',         label: 'Started',         type: 'date',   column: 'start_date' },
      { key: 'next_charge_date',   label: 'Next charge',     type: 'date',   column: 'next_charge_date' },
      { key: 'end_date',           label: 'Ends',            type: 'date',   column: 'end_date' },
      { key: 'notes',              label: 'Notes',           type: 'text',   column: 'notes' },
      joined('client_name', 'Client', 'client', 'clients', 'full_name'),
      joined('asset_code',  'Item',   'asset',  'assets',  'asset_code'),
    ],
  },

  // ── CRM: leads ────────────────────────────────────────────────────────────
  {
    key: 'leads',
    label: 'Leads',
    description: 'The pipeline — stage, source, and why the lost ones were lost.',
    icon: 'Target',
    table: 'leads',
    module: 'crm',
    roles: EXEC,
    // Scoped by the supervisor policies through agents.admin_id (20260820140000).
    tenant: { mode: 'rls' },
    dateField: 'created_at',
    defaultFields: ['full_name', 'stage', 'source', 'priority', 'agent_name', 'created_at'],
    fields: [
      { key: 'full_name',      label: 'Lead',           type: 'text',     column: 'full_name' },
      { key: 'phone',          label: 'Phone',          type: 'text',     column: 'phone' },
      { key: 'email',          label: 'Email',          type: 'text',     column: 'email' },
      { key: 'stage',          label: 'Stage',          type: 'enum',     column: 'stage',
        options: enumOptions(['new_lead', 'contacted', 'qualified', 'proposal_sent', 'closed']) },
      { key: 'priority',       label: 'Priority',       type: 'enum',     column: 'priority',
        options: enumOptions(['low', 'medium', 'high']) },
      // One vocabulary with the agent portal that writes these — see
      // src/config/crmVocabulary.js. Two lists would mean two spellings of the
      // same source, and a report that under-counts both.
      { key: 'source',         label: 'Lead source',    type: 'enum',     column: 'source',
        options: enumOptions(LEAD_SOURCES) },
      { key: 'asset_interest', label: 'Interested in',  type: 'text',     column: 'asset_interest' },
      { key: 'budget_range',   label: 'Budget',         type: 'text',     column: 'budget_range' },
      { key: 'lost_reason',    label: 'Lost reason',    type: 'enum',     column: 'lost_reason',
        options: enumOptions(LOST_REASONS), pending: true },
      { key: 'lost_at',        label: 'Lost on',        type: 'datetime', column: 'lost_at', pending: true },
      { key: 'converted_at',   label: 'Converted on',   type: 'datetime', column: 'converted_at' },
      { key: 'last_contact_at', label: 'Last contacted', type: 'datetime', column: 'last_contact_at' },
      { key: 'created_at',     label: 'Captured',       type: 'datetime', column: 'created_at' },
      { key: 'notes',          label: 'Notes',          type: 'text',     column: 'notes' },
      joined('agent_name', 'Agent', 'agent', 'agents', 'full_name'),
    ],
  },

  // ── CRM: interactions ─────────────────────────────────────────────────────
  {
    key: 'crm_interactions',
    label: 'Customer Contacts',
    description: 'Every logged call, message and visit, and what came of it.',
    icon: 'PhoneCall',
    table: 'crm_interactions',
    module: 'crm',
    roles: EXEC,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'occurred_at',
    defaultFields: ['occurred_at', 'contact_name', 'interaction_type', 'direction', 'outcome', 'agent_name'],
    fields: [
      { key: 'occurred_at',      label: 'When',      type: 'datetime', column: 'occurred_at' },
      { key: 'contact_name',     label: 'Contact',   type: 'text',     column: 'contact_name' },
      { key: 'interaction_type', label: 'Channel',   type: 'enum',     column: 'interaction_type',
        options: enumOptions(CONTACT_CHANNELS.filter((c) => c.loggable)) },
      { key: 'direction',        label: 'Direction', type: 'enum',     column: 'direction',
        options: enumOptions(['outbound', 'inbound']) },
      { key: 'outcome',          label: 'Outcome',   type: 'enum',     column: 'outcome',
        options: enumOptions(['connected', 'no_answer', 'interested', 'needs_info',
                              'not_interested', 'rescheduled', 'deal_agreed', 'lost']) },
      { key: 'subject',          label: 'Subject',   type: 'text',     column: 'subject' },
      { key: 'summary',          label: 'Summary',   type: 'text',     column: 'summary' },
      { key: 'duration_minutes', label: 'Minutes',   type: 'number',   column: 'duration_minutes' },
      { key: 'next_step',        label: 'Next step', type: 'text',     column: 'next_step' },
      { key: 'created_at',       label: 'Logged',    type: 'datetime', column: 'created_at' },
      joined('agent_name', 'Agent', 'agent', 'agents', 'full_name'),
    ],
  },

  // ── CRM: follow-ups ───────────────────────────────────────────────────────
  {
    key: 'follow_ups',
    label: 'Follow-ups',
    description: 'What was promised to whom, on which channel, and whether it happened.',
    icon: 'CalendarCheck',
    table: 'follow_ups',
    module: 'crm',
    roles: EXEC,
    tenant: { mode: 'rls' },
    dateField: 'scheduled_at',
    defaultFields: ['scheduled_at', 'lead_name', 'appointment_type', 'is_completed', 'agent_name'],
    fields: [
      { key: 'scheduled_at',     label: 'Due',      type: 'datetime', column: 'scheduled_at' },
      { key: 'lead_name',        label: 'Lead',     type: 'text',     column: 'lead_name' },
      { key: 'appointment_type', label: 'Channel',  type: 'enum',     column: 'appointment_type',
        options: enumOptions(SCHEDULABLE_CHANNELS) },
      { key: 'is_completed',     label: 'Done',     type: 'boolean',  column: 'is_completed' },
      { key: 'location',         label: 'Location', type: 'text',     column: 'location' },
      { key: 'notes',            label: 'Notes',    type: 'text',     column: 'notes' },
      { key: 'created_at',       label: 'Booked',   type: 'datetime', column: 'created_at' },
      joined('agent_name', 'Agent', 'agent', 'agents', 'full_name'),
    ],
  },

  // ── Sales agents ──────────────────────────────────────────────────────────
  {
    key: 'agents',
    label: 'Sales Agents',
    description: 'The sales force — targets, sales booked and commission earned.',
    icon: 'Award',
    table: 'agents',
    module: 'crm',
    roles: EXEC,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'created_at',
    defaultFields: ['full_name', 'region', 'agent_status', 'total_sales', 'total_commission'],
    fields: [
      { key: 'agent_code',       label: 'Agent code',   type: 'text',     column: 'agent_code' },
      { key: 'full_name',        label: 'Agent',        type: 'text',     column: 'full_name' },
      { key: 'email',            label: 'Email',        type: 'text',     column: 'email' },
      { key: 'phone',            label: 'Phone',        type: 'text',     column: 'phone' },
      { key: 'region',           label: 'Region',       type: 'text',     column: 'region' },
      { key: 'agent_status',     label: 'Status',       type: 'enum',     column: 'agent_status',
        options: enumOptions(['active', 'inactive', 'on_leave', 'terminated']) },
      { key: 'commission_rate',  label: 'Rate %',       type: 'number',   column: 'commission_rate' },
      { key: 'total_sales',      label: 'Sales booked', type: 'money',    column: 'total_sales' },
      { key: 'total_commission', label: 'Commission',   type: 'money',    column: 'total_commission' },
      { key: 'target_amount',    label: 'Target',       type: 'money',    column: 'target_amount' },
      { key: 'created_at',       label: 'Joined',       type: 'datetime', column: 'created_at' },
    ],
  },

  // ── HR ────────────────────────────────────────────────────────────────────
  {
    key: 'employees',
    label: 'Employees',
    description: 'Staff records — department, contract type and pay structure.',
    icon: 'UserCog',
    table: 'user_profiles',
    module: 'hr',
    roles: PEOPLE,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'date_joined',
    // Staff ARE user_profiles rows in this schema — there is no employees
    // table. That means the table also holds the tenant's customers and the
    // platform owner, and neither is an employee. This filter is not a default
    // the user can change: it is part of what the source is.
    baseFilter: { column: 'role', op: 'not.in', value: ['client', 'super_admin', 'sacco_member'] },
    defaultFields: ['full_name', 'role', 'department', 'employment_type', 'basic_salary', 'is_active'],
    fields: [
      { key: 'full_name',           label: 'Name',         type: 'text',    column: 'full_name' },
      { key: 'email',               label: 'Email',        type: 'text',    column: 'email' },
      { key: 'phone',               label: 'Phone',        type: 'text',    column: 'phone' },
      { key: 'role',                label: 'Role',         type: 'text',    column: 'role' },
      { key: 'department',          label: 'Department',   type: 'text',    column: 'department' },
      { key: 'employment_type',     label: 'Contract',     type: 'text',    column: 'employment_type' },
      { key: 'is_active',           label: 'Active',       type: 'boolean', column: 'is_active' },
      { key: 'basic_salary',        label: 'Basic salary', type: 'money',   column: 'basic_salary' },
      { key: 'housing_allowance',   label: 'Housing',      type: 'money',   column: 'housing_allowance' },
      { key: 'transport_allowance', label: 'Transport',    type: 'money',   column: 'transport_allowance' },
      { key: 'kra_pin',             label: 'KRA PIN',      type: 'text',    column: 'kra_pin' },
      { key: 'date_joined',         label: 'Joined',       type: 'date',    column: 'date_joined' },
      // Bank details, NSSF number and next-of-kin ID are NOT here and must not
      // be added. They live encrypted in employee_private_data behind
      // PII_ENC_KEY and are read one deliberate call at a time
      // (fetchEmployeePiiBatch), which is a decision an auditor can follow. A
      // column in this list is a column any staff report can dump to CSV.
    ],
  },

  {
    key: 'payroll_records',
    label: 'Payroll',
    description: 'Monthly pay runs with the full statutory working behind each one.',
    icon: 'Wallet',
    table: 'payroll_records',
    module: 'payroll',
    roles: PEOPLE,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'pay_month',
    defaultFields: ['pay_month', 'employee_name', 'gross_salary', 'paye', 'nssf', 'shif', 'net_salary'],
    fields: [
      // 'YYYY-MM', not a timestamp — see the note on FIELD_TYPES above.
      { key: 'pay_month',            label: 'Month',            type: 'month', column: 'pay_month' },
      { key: 'gross_salary',         label: 'Gross',            type: 'money', column: 'gross_salary' },
      { key: 'basic_salary',         label: 'Basic',            type: 'money', column: 'basic_salary' },
      { key: 'housing_allowance',    label: 'Housing',          type: 'money', column: 'housing_allowance' },
      { key: 'transport_allowance',  label: 'Transport',        type: 'money', column: 'transport_allowance' },
      { key: 'taxable_pay',          label: 'Taxable pay',      type: 'money', column: 'taxable_pay', pending: true },
      { key: 'paye',                 label: 'PAYE',             type: 'money', column: 'paye' },
      { key: 'nssf',                 label: 'NSSF',             type: 'money', column: 'nssf' },
      { key: 'shif',                 label: 'SHIF',             type: 'money', column: 'shif' },
      { key: 'housing_levy',         label: 'Housing levy',     type: 'money', column: 'housing_levy', pending: true },
      { key: 'personal_relief',      label: 'Personal relief',  type: 'money', column: 'personal_relief', pending: true },
      { key: 'insurance_relief',     label: 'Insurance relief', type: 'money', column: 'insurance_relief', pending: true },
      { key: 'pension_contribution', label: 'Pension',          type: 'money', column: 'pension_contribution', pending: true },
      { key: 'loan_deduction',       label: 'Loan deduction',   type: 'money', column: 'loan_deduction' },
      { key: 'advance_deduction',    label: 'Advance',          type: 'money', column: 'advance_deduction' },
      { key: 'net_salary',           label: 'Net pay',          type: 'money', column: 'net_salary' },
      { key: 'status',               label: 'Status',           type: 'text',  column: 'status' },
      // NULL means "computed by the old engine, basis unknown" — see
      // 20260829120000. Reportable so a PAYE reconciliation can find those rows.
      { key: 'rate_version',         label: 'Rate version',     type: 'text',  column: 'rate_version', pending: true },
      joined('employee_name', 'Employee',   'employee', 'user_profiles', 'full_name'),
      joined('department',    'Department', 'employee', 'user_profiles', 'department'),
    ],
  },

  // ── Accounting ────────────────────────────────────────────────────────────
  {
    key: 'journal_entries',
    label: 'Journal Entries',
    description: 'The posted ledger — every debit and credit with its source.',
    icon: 'BookOpen',
    table: 'journal_entries',
    module: 'accounting',
    roles: FINANCE,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'entry_date',
    defaultFields: ['entry_date', 'entry_no', 'description', 'debit_account', 'credit_account', 'amount'],
    fields: [
      { key: 'entry_date',     label: 'Date',           type: 'date',     column: 'entry_date' },
      { key: 'entry_no',       label: 'Entry no.',      type: 'text',     column: 'entry_no' },
      { key: 'description',    label: 'Description',    type: 'text',     column: 'description' },
      { key: 'debit_account',  label: 'Debit account',  type: 'text',     column: 'debit_account' },
      { key: 'credit_account', label: 'Credit account', type: 'text',     column: 'credit_account' },
      { key: 'amount',         label: 'Amount',         type: 'money',    column: 'amount' },
      { key: 'reference',      label: 'Reference',      type: 'text',     column: 'reference' },
      { key: 'status',         label: 'Status',         type: 'enum',     column: 'status',
        options: enumOptions(['posted', 'draft', 'reversed']) },
      { key: 'trigger_event',  label: 'Raised by',      type: 'text',     column: 'trigger_event' },
      { key: 'is_automated',   label: 'Automated',      type: 'boolean',  column: 'is_automated' },
      { key: 'created_at',     label: 'Posted',         type: 'datetime', column: 'created_at' },
    ],
  },

  // ── SACCO ─────────────────────────────────────────────────────────────────
  {
    key: 'sacco_members',
    label: 'SACCO Members',
    description: 'The membership roll — status, KYC and office held.',
    icon: 'Users',
    table: 'sacco_members',
    module: 'members',
    roles: EXEC,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'joined_at',
    defaultFields: ['member_no', 'full_name', 'phone', 'status', 'kyc_status', 'joined_at'],
    fields: [
      { key: 'member_no',   label: 'Member no.', type: 'text',     column: 'member_no' },
      { key: 'full_name',   label: 'Member',     type: 'text',     column: 'full_name' },
      { key: 'phone',       label: 'Phone',      type: 'text',     column: 'phone' },
      { key: 'email',       label: 'Email',      type: 'text',     column: 'email' },
      { key: 'gender',      label: 'Gender',     type: 'text',     column: 'gender' },
      { key: 'member_role', label: 'Office',     type: 'enum',     column: 'member_role',
        options: enumOptions(['member', 'treasurer', 'chairman', 'secretary', 'auditor']) },
      { key: 'status',      label: 'Status',     type: 'enum',     column: 'status',
        options: enumOptions(['active', 'inactive', 'suspended']) },
      { key: 'kyc_status',  label: 'KYC',        type: 'text',     column: 'kyc_status' },
      { key: 'joined_at',   label: 'Joined',     type: 'date',     column: 'joined_at' },
      { key: 'created_at',  label: 'Registered', type: 'datetime', column: 'created_at' },
    ],
  },

  {
    key: 'sacco_contributions',
    label: 'SACCO Contributions',
    description: 'The savings ledger — who has paid in, when, and who is behind.',
    icon: 'PiggyBank',
    table: 'sacco_contributions',
    module: 'contributions',
    roles: EXEC,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'due_date',
    defaultFields: ['member_name', 'amount', 'contribution_type', 'due_date', 'paid_date', 'status'],
    fields: [
      { key: 'amount',            label: 'Amount',    type: 'money', column: 'amount' },
      { key: 'contribution_type', label: 'Type',      type: 'text',  column: 'contribution_type' },
      { key: 'due_date',          label: 'Due',       type: 'date',  column: 'due_date' },
      { key: 'paid_date',         label: 'Paid',      type: 'date',  column: 'paid_date' },
      { key: 'status',            label: 'Status',    type: 'enum',  column: 'status',
        options: enumOptions(['pending', 'paid', 'overdue', 'waived']) },
      { key: 'penalty_amount',    label: 'Penalty',   type: 'money', column: 'penalty_amount' },
      { key: 'reference',         label: 'Reference', type: 'text',  column: 'reference' },
      { key: 'notes',             label: 'Notes',     type: 'text',  column: 'notes' },
      joined('member_name', 'Member', 'member', 'sacco_members', 'full_name'),
    ],
  },

  {
    key: 'sacco_loans',
    label: 'SACCO Loans',
    description: 'The loan book — principal, rate, method and where each loan stands.',
    icon: 'BadgeCheck',
    table: 'sacco_loans',
    module: 'loans',
    roles: EXEC,
    tenant: { mode: 'column', column: 'admin_id' },
    dateField: 'created_at',
    defaultFields: ['member_name', 'principal', 'annual_interest_rate', 'term_months', 'status', 'disbursed_at'],
    fields: [
      { key: 'principal',            label: 'Principal',     type: 'money',    column: 'principal' },
      { key: 'annual_interest_rate', label: 'Rate %',        type: 'number',   column: 'annual_interest_rate' },
      { key: 'term_months',          label: 'Term (months)', type: 'number',   column: 'term_months' },
      { key: 'method',               label: 'Method',        type: 'enum',     column: 'method',
        options: enumOptions(['reducing_balance', 'equal_principal', 'flat_rate', 'interest_only', 'balloon']) },
      { key: 'status',               label: 'Status',        type: 'enum',     column: 'status',
        options: enumOptions(['pending', 'approved', 'active', 'closed', 'rejected']) },
      { key: 'purpose',              label: 'Purpose',       type: 'text',     column: 'purpose' },
      { key: 'disbursed_at',         label: 'Disbursed',     type: 'datetime', column: 'disbursed_at' },
      { key: 'created_at',           label: 'Applied',       type: 'datetime', column: 'created_at' },
      joined('member_name', 'Member', 'member', 'sacco_members', 'full_name'),
    ],
  },
];

// ─── LOOKUPS ─────────────────────────────────────────────────────────────────
const SOURCE_BY_KEY = REPORT_SOURCES.reduce((acc, s) => { acc[s.key] = s; return acc; }, {});

export const sourceByKey = (key) => SOURCE_BY_KEY[key] || null;

export const fieldByKey = (source, fieldKey) =>
  (source?.fields || []).find((f) => f.key === fieldKey) || null;

/** A field's path into a fetched row. Joined fields read through the embed. */
export const fieldPath = (field) =>
  (field?.join ? [field.join.alias, field.join.column] : [field?.column]);

/**
 * Sources this user may be offered, in catalogue order.
 *
 * Two gates that mean different things. `role` is about authority — a
 * collections officer is not offered the payroll book. `isModuleEnabled` is
 * about what the tenant bought — a company with no SACCO does not want SACCO
 * sources cluttering the picker. A source needs both.
 */
export const sourcesFor = ({ role, isModuleEnabled } = {}) =>
  REPORT_SOURCES.filter((s) => {
    if (role && !s.roles.includes(role)) return false;
    if (isModuleEnabled && !isModuleEnabled(s.module)) return false;
    return true;
  });

/** Module keys named here that the catalogue does not know. Asserted by the test. */
export const unknownModuleKeys = () =>
  REPORT_SOURCES.filter((s) => !MODULE_KEYS.includes(s.module)).map((s) => s.key);

export default {
  REPORT_SOURCES, OPERATORS, AGGREGATIONS, PERIOD_PRESETS, DATE_GRANULARITIES,
  REPORT_BUILDER_ROLES, canBuildReports,
  sourceByKey, fieldByKey, fieldPath, sourcesFor,
  operatorByValue, operatorsForType, aggregationsForType,
  isNumericType, isTemporalType,
};
