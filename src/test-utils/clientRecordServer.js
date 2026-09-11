/**
 * A JavaScript MIRROR of the client-record functions in migration
 * 20260911120000, for the fake Supabase to answer with.
 *
 * public.clients has no INSERT path of its own in this feature — every record
 * is made by finhub_create_client, a SECURITY DEFINER function. Modelling the
 * creation as a `.insert()` in a test would therefore prove a path that does
 * not exist: it would skip the lead link, the idempotency and the duplicate
 * refusal, which are the whole of what the feature is.
 *
 * The rules here are copies of decisions made in SQL, so they can drift.
 * clientRecords.sync.test.js reads the migration and fails when they do.
 */

const digits = (v) => String(v ?? '').replace(/[^0-9]/g, '');

/** The last nine digits, or nothing. Mirrors public.normalise_msisdn. */
export const normaliseMsisdn = (phone) => {
  const d = digits(phone);
  return d.length < 9 ? null : d.slice(-9);
};

/** Letters and digits, upper-cased. Mirrors public.normalise_identifier. */
export const normaliseIdentifier = (v) =>
  String(v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null;

export const normaliseEmail = (v) => String(v ?? '').trim().toLowerCase() || null;

export const normaliseName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase() || null;

/** Weighted exactly as the migration weights them. */
export const MATCH_WEIGHTS = {
  kra_pin: 50, national_id: 40, phone: 30, email: 25, name: 10,
};

/** The score at or above which finhub_create_client refuses. */
export const BLOCKING_SCORE = 25;

const scoreOf = (matched) => matched.reduce((s, m) => s + (MATCH_WEIGHTS[m] || 0), 0);

const matchRow = (needle, c) => {
  const matched = [];
  const pin  = normaliseIdentifier(needle.p_kra_pin);
  const nid  = normaliseIdentifier(needle.p_national_id);
  const tel  = normaliseMsisdn(needle.p_phone);
  const mail = normaliseEmail(needle.p_email);
  const name = normaliseName(needle.p_full_name);

  if (pin  && normaliseIdentifier(c.kra_pin)     === pin)  matched.push('kra_pin');
  if (nid  && normaliseIdentifier(c.national_id) === nid)  matched.push('national_id');
  if (tel  && normaliseMsisdn(c.phone)           === tel)  matched.push('phone');
  if (mail && normaliseEmail(c.email)            === mail) matched.push('email');
  if (name && normaliseName(c.full_name)         === name) matched.push('name');
  return matched;
};

/**
 * @param {object} opts
 * @param {string} opts.adminId  the tenant every created record lands in, and
 *                               the only one the duplicate scan may see
 * @param {string} [opts.role]   the caller's role; anything but client /
 *                               sacco_member is staff, as is_staff_member() says
 */
export const clientRecordRpcs = ({ adminId = 'admin_1', role = 'sales_agent' } = {}) => {
  const isStaff = () => !['client', 'sacco_member'].includes(role);

  const raise = (message, code) => {
    const err = new Error(message);
    err.code = code;
    throw err;
  };

  const scan = (db, args) => {
    const rows = (db.clients || [])
      .filter(c => c.admin_id === adminId)
      .filter(c => !args.p_exclude_id || c.id !== args.p_exclude_id)
      .map(c => ({ row: c, matched_on: matchRow(args, c) }))
      .filter(({ matched_on }) => matched_on.length > 0)
      // A name on its own is not a duplicate: two people share one every day.
      .filter(({ matched_on }) => !(matched_on.length === 1 && matched_on[0] === 'name'))
      .map(({ row, matched_on }) => ({
        id: row.id,
        account_number: row.account_number,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        kra_pin: row.kra_pin,
        customer_type: row.customer_type,
        client_status: row.client_status,
        lead_id: row.lead_id ?? null,
        outstanding_balance: row.outstanding_balance ?? 0,
        created_at: row.created_at,
        matched_on,
        // PostgREST sends integers back as numbers and numerics as strings; the
        // score is an integer, so a number is what production sends.
        match_score: scoreOf(matched_on),
      }))
      .sort((a, b) => b.match_score - a.match_score);
    return rows.slice(0, args.p_limit || 10);
  };

  return {
    finhub_find_client_duplicates: (args, { db }) => scan(db, args),

    finhub_create_client: (args, { db, user, nextId }) => {
      if (!isStaff()) raise('Only staff may create a client record.', '42501');

      const name = String(args.p_full_name ?? '').trim();
      if (!name && !args.p_use_existing) raise('A client record needs a name.', 'P0001');

      const clients = (db.clients || (db.clients = []));
      const leads   = (db.leads   || (db.leads   = []));

      // Already converted -> hand back what it became. A second click on
      // Convert is not a second customer.
      //
      // Two signals: clients.lead_id is where a record CAME FROM and is unique,
      // leads.converted_ref_id is where a lead ENDED UP and is not. A lead
      // closed onto a customer already on file carries only the second.
      if (args.p_lead_id) {
        const lead = leads.find(l => l.id === args.p_lead_id);
        const existing = clients.find(c => c.lead_id === args.p_lead_id)
          || (lead?.converted_entity === 'client' && lead.converted_ref_id
              ? clients.find(c => c.id === lead.converted_ref_id)
              : null);
        if (existing) return existing;
      }

      let row;
      if (args.p_use_existing) {
        row = clients.find(c => c.id === args.p_use_existing);
        if (!row) raise('That client record could not be found.', 'P0002');
        if (row.admin_id !== adminId) raise('That client record belongs to another tenant.', '42501');
        // Filled, never overwritten — and a record that already came from a
        // lead keeps that origin while the new lead is stamped onto it below.
        row.lead_id          = row.lead_id          ?? args.p_lead_id ?? null;
        row.agent_id         = row.agent_id         ?? args.p_agent_id ?? null;
        row.email            = row.email            ?? normaliseEmail(args.p_email);
        row.phone            = row.phone            ?? (args.p_phone || null);
        row.kra_pin          = row.kra_pin          ?? (args.p_kra_pin || null);
        row.national_id      = row.national_id      ?? (args.p_national_id || null);
        row.physical_address = row.physical_address ?? (args.p_billing_address || null);
      } else {
        if (!args.p_force) {
          const dupes = scan(db, { ...args, p_limit: 3 }).filter(d => d.match_score >= BLOCKING_SCORE);
          if (dupes.length > 0) {
            raise(
              'A client record already exists for these details: '
              + dupes.map(d => `${d.full_name} (${d.account_number})`).join(', ')
              + '. Use that record, or tick "create anyway" if they are different people.',
              '23505',
            );
          }
        }
        row = {
          id: nextId('clients'),
          account_number: `AF-2026-${String(clients.length + 1).padStart(6, '0')}`,
          full_name: name,
          email: normaliseEmail(args.p_email),
          phone: args.p_phone || null,
          national_id: args.p_national_id || null,
          kra_pin: args.p_kra_pin || null,
          physical_address: args.p_billing_address || null,
          notes: args.p_notes || null,
          customer_type: args.p_customer_type || 'account',
          client_status: 'active',
          kyc_status: 'unverified',
          outstanding_balance: 0,
          admin_id: adminId,
          created_by: user?.id || null,
          agent_id: args.p_agent_id || null,
          lead_id: args.p_lead_id || null,
          created_at: new Date().toISOString(),
        };
        clients.push(row);
      }

      // Same transaction as the creation, so a converted buyer can never be
      // left sitting in the open pipeline.
      if (args.p_lead_id) {
        const lead = leads.find(l => l.id === args.p_lead_id);
        if (lead) {
          lead.stage            = 'closed';
          lead.converted_entity = 'client';
          lead.converted_ref_id = row.id;
          lead.converted_at     = new Date().toISOString();
        }
      }

      (db.audit_logs || (db.audit_logs = [])).push({
        id: nextId('audit_logs'),
        user_id: user?.id || null,
        action: 'create',
        table_name: 'clients',
        record_id: row.id,
        description: args.p_use_existing
          ? `Linked existing client record ${row.account_number} (${row.full_name}) to a lead`
          : `Created FinHub client record ${row.account_number} (${row.full_name})`,
        new_values: { forced_past_duplicates: Boolean(args.p_force), linked_existing: args.p_use_existing || null },
        severity: args.p_force ? 'warning' : 'info',
      });

      return row;
    },

    finhub_client_book: (args, { db }) => {
      const term = (args.p_search || '').trim().toLowerCase();
      const all = (db.clients || [])
        .filter(c => c.admin_id === adminId)
        .filter(c => !term || [c.full_name, c.account_number, c.email, c.phone, c.kra_pin]
          .some(v => String(v ?? '').toLowerCase().includes(term)))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

      const limit  = args.p_limit  ?? 50;
      const offset = args.p_offset ?? 0;

      return all.slice(offset, offset + limit).map((c) => {
        const invoices = (db.company_invoices || [])
          .filter(i => i.client_id === c.id && !['draft', 'cancelled'].includes(i.status));
        const payments = (db.payments || [])
          .filter(p => p.client_id === c.id && p.payment_status === 'completed');
        const invoiced = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
        const paid     = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        return {
          id: c.id,
          account_number: c.account_number,
          full_name: c.full_name,
          email: c.email,
          phone: c.phone,
          kra_pin: c.kra_pin,
          customer_type: c.customer_type,
          client_status: c.client_status,
          lead_id: c.lead_id ?? null,
          agent_id: c.agent_id ?? null,
          created_at: c.created_at,
          // Money comes back from PostgREST as a STRING. Sending numbers here
          // would hide the Number() coercion the hook exists to do.
          invoiced: String(invoiced),
          paid: String(paid),
          balance: String(invoiced - paid),
          invoice_count: invoices.length,
          overdue_count: invoices.filter(i => i.status === 'overdue').length,
          last_payment_at: payments.map(p => p.payment_date).sort().pop() || null,
          total_count: String(all.length),
        };
      });
    },

    finhub_client_summary: (args, { db }) => {
      const invoices = (db.company_invoices || [])
        .filter(i => i.client_id === args.p_client_id && !['draft', 'cancelled'].includes(i.status));
      const payments = (db.payments || [])
        .filter(p => p.client_id === args.p_client_id && p.payment_status === 'completed');
      const invoiced = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
      const paid     = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
      const client   = (db.clients || []).find(c => c.id === args.p_client_id);
      return [{
        client_id: args.p_client_id,
        invoiced: String(invoiced),
        paid: String(paid),
        balance: String(invoiced - paid),
        invoice_count: invoices.length,
        unpaid_count: invoices.filter(i => ['pending', 'overdue'].includes(i.status)).length,
        overdue_count: invoices.filter(i => i.status === 'overdue').length,
        payment_count: payments.length,
        first_invoice_at: invoices.map(i => i.issue_date).sort()[0] || null,
        last_invoice_at: invoices.map(i => i.issue_date).sort().pop() || null,
        last_payment_at: payments.map(p => p.payment_date).sort().pop() || null,
        hire_purchase_due: String(client?.outstanding_balance || 0),
      }];
    },

    finhub_client_statement: (args, { db }) => {
      const rows = [
        ...(db.company_invoices || [])
          .filter(i => i.client_id === args.p_client_id && !['draft', 'cancelled'].includes(i.status))
          .map(i => ({
            entry_at: i.issue_date, kind: 'invoice', reference: i.invoice_no,
            description: i.notes || 'Invoice', charged: Number(i.total || 0), received: 0,
            status: i.status, method: i.payment_method || null, source_id: i.id,
          })),
        ...(db.payments || [])
          .filter(p => p.client_id === args.p_client_id && p.payment_status === 'completed')
          .map(p => ({
            entry_at: p.payment_date, kind: 'payment', reference: p.reference_number || p.transaction_id,
            description: p.notes || 'Payment received', charged: 0, received: Number(p.amount || 0),
            status: p.payment_status, method: p.payment_method, source_id: p.id,
          })),
      ].sort((a, b) => String(a.entry_at).localeCompare(String(b.entry_at)));

      // The running balance is computed over the WHOLE history before the page
      // is cut, which is what makes the newest page's balance a true one.
      let running = 0;
      const withBalance = rows.map(r => {
        running += r.charged - r.received;
        return { ...r, charged: String(r.charged), received: String(r.received), running_balance: String(running) };
      });
      return withBalance.reverse().slice(0, args.p_limit ?? 100);
    },
  };
};

export default clientRecordRpcs;
