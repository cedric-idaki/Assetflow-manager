// supabase/functions/delete-staff-user/index.ts
// Deploy with: supabase functions deploy delete-staff-user --no-verify-jwt
//
// The --no-verify-jwt flag is CRITICAL — without it, Supabase rejects any
// token that doesn't belong to a super-admin, causing a 401. Authorisation is
// handled manually below by checking the caller's role and ownership.
//
// PERMANENTLY deletes a staff/employee account (auth user + user_profiles row)
// while GUARANTEEING the audit trail is retained:
//   • Before deletion we write a full-snapshot `delete` entry into audit_logs,
//     attributed to the admin performing the action (so it is never nulled by
//     the cascade) and carrying the deleted employee's complete record.
//   • The employee's existing audit_logs rows are kept by the schema:
//     audit_logs.user_id is ON DELETE SET NULL, so the cascade that removes the
//     profile only nulls the link — it never deletes the history.
// If the deletion fails, the snapshot audit entry is rolled back so the log
// never claims a deletion that did not happen.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Only account-holder admins (and super admins, who oversee everything) may
// permanently delete staff. This keeps the destructive action confined to the
// admin portal.
const CAN_DELETE = ['admin', 'super_admin'];

// Roles that represent account holders / clients — never deletable through this
// staff-deletion endpoint. Only employees (staff/HR roles) can be removed here.
const PROTECTED_ROLES = ['admin', 'super_admin', 'client'];

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── 1. Verify the caller has a valid session ──────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Missing authorization header' }, 401);
    }

    const callerToken    = authHeader.replace('Bearer ', '');
    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return json({ error: 'Unauthorized: invalid or expired session' }, 401);
    }

    // ── 2. Resolve the caller's role from user_profiles ───────────────────
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('role, admin_id')
      .eq('id', caller.id)
      .single();

    if (profileErr || !callerProfile) {
      return json({ error: 'Caller profile not found' }, 403);
    }

    const callerRole = callerProfile.role as string;
    if (!CAN_DELETE.includes(callerRole)) {
      return json({ error: `Role "${callerRole}" is not permitted to delete staff.` }, 403);
    }

    // ── 3. Parse and validate the request body ────────────────────────────
    const body = await req.json();
    const userId = body.user_id as string | undefined;
    if (!userId) {
      return json({ error: 'user_id is required' }, 400);
    }
    if (userId === caller.id) {
      return json({ error: 'You cannot delete your own account.' }, 400);
    }

    // ── 4. Load the target employee (service role bypasses RLS) ───────────
    const { data: target, error: targetErr } = await adminClient
      .from('user_profiles')
      .select('id, admin_id, full_name, email, role, department, phone, national_id, is_active, employment_type, date_joined')
      .eq('id', userId)
      .maybeSingle();

    if (targetErr) throw targetErr;
    if (!target) {
      return json({ error: 'Employee not found (already deleted?).' }, 404);
    }

    // Account holders / clients are off-limits to this endpoint.
    if (PROTECTED_ROLES.includes(target.role as string)) {
      return json({ error: `"${target.role}" accounts cannot be deleted from the HR portal.` }, 403);
    }

    // A plain admin may only delete staff that belong to their own account.
    // Super admins oversee every company, so they may delete any staff member.
    if (callerRole === 'admin' && target.admin_id !== caller.id) {
      return json({ error: 'You can only delete staff that belong to your account.' }, 403);
    }

    // ── 5. Write the retained audit snapshot BEFORE deleting ──────────────
    // Attributed to the acting admin (caller.id) so the cascade never nulls it,
    // and scoped to the company so it appears in the right activity feed.
    const snapshot = {
      id:              target.id,
      full_name:       target.full_name,
      email:           target.email,
      role:            target.role,
      department:      target.department,
      phone:           target.phone,
      national_id:     target.national_id,
      employment_type: target.employment_type,
      date_joined:     target.date_joined,
      admin_id:        target.admin_id,
    };

    const { data: auditRow, error: auditErr } = await adminClient
      .from('audit_logs')
      .insert({
        user_id:     caller.id,
        admin_id:    target.admin_id || caller.id,
        action:      'delete',
        table_name:  'user_profiles',
        record_id:   target.id,
        old_values:  snapshot,
        description: `Permanently deleted employee ${target.full_name} (${target.email}) — role ${target.role}`,
        severity:    'warning',
        metadata:    { deleted_employee: snapshot, deleted_by: caller.id, deleted_by_role: callerRole },
      })
      .select('id')
      .single();

    if (auditErr) {
      // Never delete without a recoverable audit trail.
      return json({ error: `Could not record the audit entry, deletion aborted: ${auditErr.message}` }, 500);
    }

    // ── 6. Delete the auth user (cascades to user_profiles) ───────────────
    const { error: delErr } = await adminClient.auth.admin.deleteUser(target.id);
    if (delErr) {
      // Roll back the snapshot so the log doesn't claim a deletion that failed.
      await adminClient.from('audit_logs').delete().eq('id', auditRow.id);
      // The most common cause is a dependent record (e.g. a sales-agent wallet)
      // protected by a foreign key. Surface it clearly instead of silently
      // destroying linked data.
      return json({ error: `Could not delete employee: ${delErr.message}` }, 409);
    }

    return json({ success: true, id: target.id, full_name: target.full_name }, 200);

  } catch (err) {
    console.error('delete-staff-user error:', err);
    return json({ error: (err as Error).message || 'Internal server error' }, 500);
  }
});
