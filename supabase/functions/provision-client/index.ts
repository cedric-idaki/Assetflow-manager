/**
 * Ararat — provision-client Edge Function (v2 — fixed)
 *
 * Fixes from v1:
 *   1. Role check now correctly filters by the caller's user id from JWT
 *   2. SECRET name corrected to SERVICE_ROLE_KEY (not SUPABASE_SERVICE_ROLE_KEY)
 *   3. Falls back gracefully if role check query fails — logs reason clearly
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { clientId, email, fullName, phone, accountNumber } = await req.json();

    if (!clientId || !email || !fullName) {
      return new Response(
        JSON.stringify({ error: 'clientId, email, and fullName are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!;
    const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173';

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller's JWT and get their user ID
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callerUser }, error: callerUserErr } = await adminClient.auth.getUser(token);

    if (callerUserErr || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch role using verified user ID
    const { data: callerProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('role, admin_id')
      .eq('id', callerUser.id)
      .single();

    if (profileErr) {
      console.error('Role fetch error:', profileErr.message);
    }

    if (!callerProfile || !['admin', 'super_admin'].includes(callerProfile.role)) {
      return new Response(
        JSON.stringify({ error: `Forbidden. Role '${callerProfile?.role ?? 'unknown'}' cannot provision accounts.` }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Tenant guard ────────────────────────────────────────────────────────
    // Everything below runs with the service role, which bypasses RLS, so the
    // caller's role alone is NOT enough: clientId arrives from the request body
    // and must be proven to belong to the caller's own tenant. Without this an
    // admin at tenant A could bind tenant B's client row to an auth account
    // they control and read B's data through the client portal.
    const callerTenant = callerProfile.admin_id || callerUser.id;

    const { data: targetClient, error: targetErr } = await adminClient
      .from('clients')
      .select('id, admin_id')
      .eq('id', clientId)
      .maybeSingle();

    if (targetErr || !targetClient) {
      return new Response(
        JSON.stringify({ error: 'Client not found.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // super_admin is the platform-wide operator; everyone else is tenant-bound.
    if (callerProfile.role !== 'super_admin' && targetClient.admin_id !== callerTenant) {
      return new Response(
        JSON.stringify({ error: 'Client not found.' }), // no cross-tenant existence oracle
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if auth user already exists
    const { data: existingList } = await adminClient.auth.admin.listUsers();
    const alreadyExists = existingList?.users?.find((u: any) => u.email === email.toLowerCase());

    if (alreadyExists) {
      // Never rewrite an existing profile that is not already a client: this
      // path would otherwise let anyone holding a staff account demote an
      // admin (or another tenant's user) to role 'client' by provisioning
      // against their email address.
      const { data: existingProfile } = await adminClient
        .from('user_profiles')
        .select('role')
        .eq('id', alreadyExists.id)
        .maybeSingle();

      if (existingProfile && existingProfile.role !== 'client') {
        return new Response(
          JSON.stringify({ error: 'That email already belongs to a non-client account.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await adminClient.from('user_profiles').upsert({
        id: alreadyExists.id, role: 'client', full_name: fullName,
        email: email.toLowerCase(), phone: phone || null,
      }, { onConflict: 'id' });
      await adminClient.from('clients').update({ client_auth_id: alreadyExists.id }).eq('id', clientId);
      return new Response(
        JSON.stringify({ success: true, authUserId: alreadyExists.id, note: 'Auth account already existed.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Invite new user — sends email with set-password link
    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      email.toLowerCase(),
      {
        redirectTo: `${appUrl}/reset-password`,
        data: { full_name: fullName, role: 'client', account_number: accountNumber || '' },
      }
    );

    if (inviteErr) {
      return new Response(
        JSON.stringify({ error: `Failed to create auth account: ${inviteErr.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authUserId = inviteData.user.id;

    await adminClient.from('user_profiles').insert({
      id: authUserId, role: 'client', full_name: fullName,
      email: email.toLowerCase(), phone: phone || null,
    });

    await adminClient.from('clients').update({ client_auth_id: authUserId }).eq('id', clientId);

    return new Response(
      JSON.stringify({ success: true, authUserId, message: `Invitation email sent to ${email}.` }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('provision-client error:', err?.message);
    return new Response(
      JSON.stringify({ error: 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
