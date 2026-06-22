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
// NOTE: sales agents may now create BOTH client and admin (company) accounts.
const CAN_CREATE: Record<string, string[]> = {
  super_admin: ['admin', 'manager', 'finance', 'operations', 'collections_officer', 'accountant', 'director', 'sales_agent', 'sales', 'staff', 'client'],
  admin:       ['admin', 'manager', 'finance', 'operations', 'collections_officer', 'accountant', 'director', 'sales_agent', 'sales', 'staff', 'client'],
  sales_agent: ['client', 'admin'],
  sales:       ['client', 'admin'],
  agent:       ['client', 'admin'],
  manager:     ['client', 'staff'],
  staff:       ['client'],
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
      email, password, full_name, role = 'client', phone, department, admin_id,
      // When provisioning a client login, the caller passes the clients.id so we
      // can hard-link the auth user to the exact client row.
      client_id,
      // Company fields (only used when role === 'admin')
      company_name, business_reg_number, business_type, location, city, asset_types, plan,
    } = body;

    if (!email || !password || !full_name) {
      return json({ error: 'email, password, and full_name are required' }, 400);
    }
    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, 400);
    }

    // ── 4. Authorise the requested role ───────────────────────────────────
    const allowed = CAN_CREATE[callerRole] || [];
    if (!allowed.includes(role)) {
      return json({ error: `Role "${callerRole}" is not permitted to create "${role}" accounts.` }, 403);
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
        admin_id:   admin_id || null,
        created_by: caller.id,
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
        role,
        department: department || null,
        admin_id:   admin_id || null,
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
