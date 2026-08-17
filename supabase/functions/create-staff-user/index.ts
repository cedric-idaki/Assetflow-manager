// supabase/functions/create-staff-user/index.ts
// Deploy with: supabase functions deploy create-staff-user --no-verify-jwt
//
// The --no-verify-jwt flag is CRITICAL — without it, Supabase rejects any
// token that doesn't belong to a super-admin, causing a 401. Security is
// handled manually below by checking the caller's role against CAN_CREATE.

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

// Which roles each caller role is allowed to create.
// NOTE: sales agents may now create client, admin (company) AND sacco_admin
// (sacco) accounts — a sacco-side agent registers saccos instead of companies.
const CAN_CREATE: Record<string, string[]> = {
  super_admin: ['admin', 'sacco_admin', 'manager', 'finance', 'operations', 'collections_officer', 'accountant', 'director', 'sales_agent', 'sales', 'staff', 'client'],
  admin:       ['admin', 'manager', 'finance', 'operations', 'collections_officer', 'accountant', 'director', 'sales_agent', 'sales', 'staff', 'client'],
  // A sacco_admin staffs its own tenant like a company admin, but cannot
  // create other admin (company) accounts. sacco_member is the self-service
  // portal login for a sacco_members row (BRS v3.0 member portal).
  sacco_admin: ['manager', 'finance', 'operations', 'collections_officer', 'accountant', 'director', 'sales_agent', 'sales', 'staff', 'hr', 'client', 'sacco_member'],
  sales_agent: ['client', 'admin', 'sacco_admin'],
  sales:       ['client', 'admin', 'sacco_admin'],
  agent:       ['client', 'admin', 'sacco_admin'],
  manager:     ['client', 'staff'],
  staff:       ['client'],
};

// Server-side password policy — mirrors PASSWORD_POLICY in src/utils/validation.js.
// Enforced here so the rule cannot be bypassed by calling the API directly;
// keep the two in sync.
const passwordPolicyError = (pw: string): string | null => {
  const failed: string[] = [];
  if (pw.length < 8) failed.push('at least 8 characters');
  if (!/[A-Z]/.test(pw)) failed.push('an uppercase letter');
  if (!/[a-z]/.test(pw)) failed.push('a lowercase letter');
  if (!/[0-9]/.test(pw)) failed.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) failed.push('a special character');
  return failed.length > 0 ? `Password must include ${failed.join(', ')}.` : null;
};

// Fallback plan pricing if the subscription_plans lookup misses.
// Flat KES 360 / month per plan; maxUsers is the staff-portal seat limit.
const PLAN_DEFAULTS: Record<string, { price: number; maxUsers: number | null }> = {
  bronze: { price: 360, maxUsers: 5 },
  silver: { price: 360, maxUsers: 16 },
  gold:   { price: 360, maxUsers: null },
};

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

    // Use anon client to validate the caller's JWT
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

    // ── 3. Parse and validate the request body ────────────────────────────
    const body = await req.json();
    const {
      email, password, full_name, role = 'client', phone, gender, department, admin_id,
      // When provisioning a client login, the caller passes the clients.id so we
      // can hard-link the auth user to the exact client row.
      client_id,
      // When provisioning a sacco member login, the caller passes the
      // sacco_members.id so we can hard-link the auth user to the member row.
      sacco_member_id,
      // Company fields (only used when role === 'admin')
      company_name, business_reg_number, business_type, location, city, asset_types, plan,
      // Sacco fields (only used when role === 'sacco_admin')
      sacco_name, sasra_licence_no, tier, member_cap,
    } = body;

    // ── 3b. Password reset for an existing sacco member login ─────────────
    // Generates nothing itself — the caller supplies the new password and
    // shows it once in the UI (there is no email delivery dependency).
    if (body.action === 'reset-password') {
      if (!['sacco_admin', 'admin', 'super_admin'].includes(callerRole)) {
        return json({ error: `Role "${callerRole}" is not permitted to reset member passwords.` }, 403);
      }
      if (!sacco_member_id || !password) {
        return json({ error: 'sacco_member_id and password are required' }, 400);
      }
      const resetPwError = passwordPolicyError(password);
      if (resetPwError) {
        return json({ error: resetPwError }, 400);
      }
      const { data: memberRow } = await adminClient
        .from('sacco_members')
        .select('id, user_id, email, full_name')
        .eq('id', sacco_member_id)
        // Tenant guard: the member row must belong to the caller's tenant.
        .eq('admin_id', callerProfile.admin_id || caller.id)
        .maybeSingle();
      if (!memberRow?.user_id) {
        return json({ error: 'No portal login found for this member in your sacco.' }, 404);
      }
      const { error: resetErr } = await adminClient.auth.admin.updateUserById(
        memberRow.user_id,
        // The new password is temporary too: flag the account so the member
        // portal forces the member to set their own password on next login.
        { password, user_metadata: { must_change_password: true } },
      );
      if (resetErr) throw resetErr;
      return json({ success: true, email: memberRow.email, full_name: memberRow.full_name }, 200);
    }

    // ── 3c. Delete a sacco member (and their portal login, if any) ────────
    // The member row is deleted FIRST: frozen election registers and cast
    // ballots reference sacco_members with no ON DELETE action, so a member
    // with election history aborts here before the login is touched.
    if (body.action === 'delete-member') {
      if (!['sacco_admin', 'admin', 'super_admin'].includes(callerRole)) {
        return json({ error: `Role "${callerRole}" is not permitted to delete members.` }, 403);
      }
      if (!sacco_member_id) {
        return json({ error: 'sacco_member_id is required' }, 400);
      }
      const { data: memberRow } = await adminClient
        .from('sacco_members')
        .select('id, user_id')
        .eq('id', sacco_member_id)
        // Tenant guard: the member row must belong to the caller's tenant.
        .eq('admin_id', callerProfile.admin_id || caller.id)
        .maybeSingle();
      if (!memberRow) {
        return json({ error: 'Member not found in your sacco.' }, 404);
      }
      const { error: delErr } = await adminClient
        .from('sacco_members')
        .delete()
        .eq('id', memberRow.id);
      if (delErr) {
        if (delErr.code === '23503') {
          return json({
            error: 'This member is on a frozen election register or has cast ballots, records that must be kept for audit. Set their status to inactive instead.',
          }, 409);
        }
        throw delErr;
      }
      if (memberRow.user_id) {
        // Non-fatal: the member row is already gone; an orphaned login has no
        // member to resolve and the portal denies it, but log for cleanup.
        const { error: authDelErr } = await adminClient.auth.admin.deleteUser(memberRow.user_id);
        if (authDelErr) console.error('auth user delete error (non-fatal):', authDelErr.message);
        await adminClient.from('user_profiles').delete().eq('id', memberRow.user_id);
      }
      return json({ success: true }, 200);
    }

    if (!email || !password || !full_name) {
      return json({ error: 'email, password, and full_name are required' }, 400);
    }
    const pwError = passwordPolicyError(password);
    if (pwError) {
      return json({ error: pwError }, 400);
    }

    // ── 4. Authorise the requested role ───────────────────────────────────
    const allowed = CAN_CREATE[callerRole] || [];
    if (!allowed.includes(role)) {
      return json({ error: `Role "${callerRole}" is not permitted to create "${role}" accounts.` }, 403);
    }

    // ── 4b. Decide the new account's TENANT — server-side ──────────────────
    // SECURITY: admin_id decides which tenant's data the new login can reach
    // (public.current_admin_id() reads it, and every tenant policy is built on
    // that). It used to be taken straight from the request body, so any caller
    // could POST `admin_id: <another tenant's admin uuid>` and mint themselves
    // an account inside that tenant. It is now derived from the caller's own
    // session, and only super_admin — the one role that legitimately acts
    // across tenants — may still name a tenant explicitly.
    //
    //   • tenant-owner roles (admin, sacco_admin) sit at the top of their own
    //     tree, so their admin_id is NULL. That is what makes a newly
    //     registered admin a clean, independent account.
    //   • everyone else joins the caller's tenant.
    const callerTenantId = (callerProfile.admin_id as string | null) ?? caller.id;
    const isTenantOwnerRole = role === 'admin' || role === 'sacco_admin';

    let resolvedAdminId: string | null;
    if (isTenantOwnerRole) {
      resolvedAdminId = null;
    } else if (callerRole === 'super_admin') {
      // The platform operator may place an account in any tenant.
      resolvedAdminId = (admin_id as string | null) ?? null;
    } else {
      resolvedAdminId = callerTenantId;
    }

    // A sales agent's tenant lives on their `agents` row, which can differ from
    // user_profiles.admin_id for agents provisioned by a super admin. Accept a
    // body-supplied tenant ONLY when the caller demonstrably belongs to it.
    if (
      !isTenantOwnerRole &&
      callerRole !== 'super_admin' &&
      admin_id &&
      admin_id !== resolvedAdminId
    ) {
      const { data: ownAgentRow } = await adminClient
        .from('agents')
        .select('id')
        .eq('user_id', caller.id)
        .eq('admin_id', admin_id)
        .maybeSingle();

      if (!ownAgentRow) {
        return json({
          error: 'Not authorised to create an account in another tenant.',
        }, 403);
      }
      resolvedAdminId = admin_id as string;
    }

    const cleanEmail = String(email).toLowerCase().trim();

    // ── 5. Create the auth user with service role (bypasses RLS) ──────────
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true, // auto-confirm so they can log in immediately
      user_metadata: {
        full_name,
        role,
        phone:      phone || null,
        department: department || null,
        admin_id:   resolvedAdminId,
        created_by: caller.id,
        // Every account provisioned here starts on a password someone else
        // chose (a temp password or one typed by the creating admin). The app
        // blocks portal access until the user replaces it with their own.
        must_change_password: true,
      },
    });

    if (createErr) {
      const msg = createErr.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return json({ error: 'A user with this email already exists.' }, 409);
      }
      throw createErr;
    }

    const newUserId = newUser.user.id;

    // ── 6. Upsert the app-facing profile row ──────────────────────────────
    const { error: profileInsertErr } = await adminClient
      .from('user_profiles')
      .upsert({
        id:         newUserId,
        full_name,
        email:      cleanEmail,
        phone:      phone || null,
        gender:     gender || null, // 'male' | 'female' (constrained in DB)
        role,
        department: department || null,
        admin_id:   resolvedAdminId,
        is_active:  true,
      }, { onConflict: 'id' });

    if (profileInsertErr) {
      console.error('Profile upsert error (non-fatal):', profileInsertErr.message);
    }

    // ── 6b. For client logins, hard-link the clients row to this auth user ──
    // This is what lets the portal resolve the correct client even when several
    // clients share an email. Non-fatal: the account still works via the email
    // fallback if the link can't be set.
    if (role === 'client') {
      try {
        if (client_id) {
          await adminClient
            .from('clients')
            .update({ client_auth_id: newUserId })
            .eq('id', client_id);
        } else {
          // No explicit id — match the unlinked client by email + name.
          const { data: match } = await adminClient
            .from('clients')
            .select('id')
            .ilike('email', cleanEmail)
            .ilike('full_name', full_name)
            .is('client_auth_id', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (match?.id) {
            await adminClient
              .from('clients')
              .update({ client_auth_id: newUserId })
              .eq('id', match.id);
          }
        }
      } catch (linkErr) {
        console.error('client_auth_id link error (non-fatal):', (linkErr as Error).message);
      }
    }

    // ── 6c. For sacco member logins, hard-link the sacco_members row ────────
    // The member portal resolves everything through sacco_members.user_id, so
    // this link is what actually grants the member their own-data RLS scope.
    if (role === 'sacco_member' && sacco_member_id) {
      const { error: memberLinkErr } = await adminClient
        .from('sacco_members')
        .update({ user_id: newUserId, email: cleanEmail })
        .eq('id', sacco_member_id)
        // Tenant guard: the member row must belong to the caller's tenant.
        .eq('admin_id', callerProfile.admin_id || caller.id)
        .is('user_id', null);
      if (memberLinkErr) {
        console.error('sacco_members link error (non-fatal):', memberLinkErr.message);
      }
    }

    // ── 7. For admin/company accounts, provision the company profile +
    //        subscription server-side (service role bypasses RLS). ─────────
    const warnings: string[] = [];

    if (role === 'admin') {
      const { error: companyErr } = await adminClient.from('company_profiles').insert({
        admin_id:                     newUserId,
        company_name:                 company_name || full_name,
        business_registration_number: business_reg_number || null,
        business_type:                business_type || null,
        asset_types:                  Array.isArray(asset_types) ? asset_types : [],
        email:                        cleanEmail,
        phone:                        phone || null,
        location:                     location || null,
        city:                         city || null,
        kyc_status:                   'pending',
      });
      if (companyErr) {
        warnings.push(`company_profiles: ${companyErr.message}`);
        console.error('company_profiles insert error:', companyErr.message);
      }

      if (plan) {
        const { data: planRow } = await adminClient
          .from('subscription_plans')
          .select('id')
          .eq('name', plan)
          .maybeSingle();

        const def = PLAN_DEFAULTS[plan as string] || { price: 0, maxUsers: null };

        const { error: subErr } = await adminClient.from('company_subscriptions').insert({
          admin_id:   newUserId,
          plan_id:    planRow?.id || null,
          plan_name:  plan,
          status:     'pending',
          price_paid: def.price,
          max_users:  def.maxUsers,
          start_date: new Date().toISOString(),
          end_date:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (subErr) {
          warnings.push(`company_subscriptions: ${subErr.message}`);
          console.error('company_subscriptions insert error:', subErr.message);
        }
      }
    }

    // ── 7b. For sacco_admin accounts, provision the sacco tenant record +
    //        subscription, mirroring the self-service sacco registration
    //        (src/pages/admin-registration). Used by sacco sales agents. ───
    if (role === 'sacco_admin') {
      const saccoTier = (tier as string) || 'bronze';

      // UPSERT, not insert: ensure_sacco_admin_tenant_row stubs a saccos row
      // the moment the active sacco_admin profile appears, and saccos is
      // unique per admin_id — this overwrites the stub with the real details.
      const { error: saccoErr } = await adminClient.from('saccos').upsert({
        admin_id:         newUserId,
        name:             sacco_name || company_name || full_name,
        registration_no:  business_reg_number || null,
        sasra_licence_no: sasra_licence_no || null,
        business_type:    business_type || null,
        email:            cleanEmail,
        phone:            phone || null,
        location:         location || null,
        city:             city || null,
        tier:             saccoTier,
        member_cap:       member_cap || null,
        kyc_status:       'pending',
      }, { onConflict: 'admin_id' });
      if (saccoErr) {
        warnings.push(`saccos: ${saccoErr.message}`);
        console.error('saccos upsert error:', saccoErr.message);
      }

      const { data: planRow } = await adminClient
        .from('subscription_plans')
        .select('id')
        .eq('name', saccoTier)
        .maybeSingle();

      const { error: subErr } = await adminClient.from('company_subscriptions').insert({
        admin_id:   newUserId,
        plan_id:    planRow?.id || null,
        plan_name:  saccoTier,
        status:     'pending',
        price_paid: typeof body.price_paid === 'number' ? body.price_paid : 0,
        max_users:  member_cap || null,
        start_date: new Date().toISOString(),
        end_date:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (subErr) {
        warnings.push(`company_subscriptions: ${subErr.message}`);
        console.error('company_subscriptions insert error:', subErr.message);
      }
    }

    return json({
      success:   true,
      id:        newUserId,
      email:     newUser.user.email,
      full_name,
      role,
      warnings,
    }, 200);

  } catch (err) {
    console.error('create-staff-user error:', err);
    return json({ error: (err as Error).message || 'Internal server error' }, 500);
  }
});
