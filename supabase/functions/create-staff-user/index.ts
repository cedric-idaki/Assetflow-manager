// supabase/functions/create-staff-user/index.ts
// Deploy with: supabase functions deploy create-staff-user --no-verify-jwt
//
// The --no-verify-jwt flag is CRITICAL — without it, Supabase rejects any
// token that doesn't belong to a super-admin, causing the 401 you saw.
// Security is handled manually below by checking the caller's role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // ── 1. Verify the caller has a valid session ──────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const callerToken = authHeader.replace('Bearer ', '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Use anon client to validate the caller's JWT
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized: invalid or expired session' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. Check caller role (must be admin or agent) ─────────────────────
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile, error: profileErr } = await adminClient
      .from('profiles')
      .select('role, admin_id')
      .eq('id', caller.id)
      .single();

    if (profileErr || !callerProfile) {
      return new Response(JSON.stringify({ error: 'Caller profile not found' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const allowedRoles = ['admin', 'agent', 'sales_agent', 'staff'];
    if (!allowedRoles.includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: `Role "${callerProfile.role}" is not permitted to create users` }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. Parse and validate the request body ────────────────────────────
    const body = await req.json();
    const { email, password, full_name, role = 'client', phone, department, admin_id } = body;

    if (!email || !password || !full_name) {
      return new Response(JSON.stringify({ error: 'email, password, and full_name are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 4. Create the auth user with service role (bypasses RLS) ──────────
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,   // auto-confirm so they can log in immediately
      user_metadata: {
        full_name,
        role,
        phone: phone || null,
        department: department || null,
        admin_id: admin_id || null,
        created_by: caller.id,
      },
    });

    if (createErr) {
      // Surface friendly messages for common errors
      const msg = createErr.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return new Response(JSON.stringify({ error: 'A user with this email already exists.' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw createErr;
    }

    // ── 5. Upsert the profile row ─────────────────────────────────────────
    const { error: profileInsertErr } = await adminClient
      .from('profiles')
      .upsert({
        id:         newUser.user.id,
        full_name,
        email:      email.toLowerCase().trim(),
        phone:      phone || null,
        role,
        department: department || null,
        admin_id:   admin_id || null,
      }, { onConflict: 'id' });

    // Profile upsert failure is non-fatal — log it but don't abort
    if (profileInsertErr) {
      console.error('Profile upsert error (non-fatal):', profileInsertErr.message);
    }

    return new Response(JSON.stringify({
      success: true,
      id:        newUser.user.id,
      email:     newUser.user.email,
      full_name,
      role,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('create-staff-user error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});