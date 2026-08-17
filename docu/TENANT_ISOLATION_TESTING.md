# Verifying per-user data isolation

How to prove that one account cannot see, change or delete another account's
data. Run this after applying
`supabase/migrations/20260817120000_per_user_data_isolation.sql`.

The ownership rule under test, in one line:

> a row belongs to a **tenant**, identified by an admin's `auth.users.id`.
> `public.current_admin_id()` resolves the caller's tenant — their own id if
> they are an admin/sacco_admin, `user_profiles.admin_id` otherwise — and every
> tenant table's RLS policy compares its `admin_id` column against it.

Nothing in this model uses a name, an email, a role on its own, an array index,
a localStorage value or "the first row returned".

---

## 0. Before you start — see what the live database actually has

```sql
-- paste supabase/checks/verify_tenant_isolation.sql into the SQL editor
```

Section 1 of that script lists every policy that grants by role or
unconditionally. **After the migration it must return zero rows for
`assets`, `payments`, `clients`, `agents`, `audit_logs` and `user_profiles`.**
Section 4 lists rows the backfill could not attribute to any tenant — deal with
those by hand (see "Unowned rows" at the end).

---

## 1. Two-user walkthrough (the reported symptom)

### User A

1. Register at `/admin-registration` as a company.
   - Full name: `TEST ADMIN A`
   - Email: `test-admin-a@example.com`
   - Phone: `0700000001`
   - Company name: `USER_A_TEST_DATA Ltd`
2. Complete registration and sign in.
3. Register one asset (`/asset-client-management`) described `USER_A_ASSET`.
4. Add one client named `USER_A_CLIENT`.
5. Note what the dashboard header shows: `USER_A_TEST_DATA Ltd` and
   `Welcome, TEST ADMIN A`.
6. Sign out.

### User B — **in the same browser tab, without refreshing**

7. Register as a company.
   - Full name: `TEST ADMIN B`
   - Email: `test-admin-b@example.com`
   - Phone: `0700000002`
   - Company name: `USER_B_TEST_DATA Ltd`
8. Sign in.

**Expected, and the whole point of the fix:**

| Where | Must show | Must NOT show |
|---|---|---|
| Dashboard header | `USER_B_TEST_DATA Ltd`, `Welcome, TEST ADMIN B` | anything with A in it |
| Clients tab | empty | `USER_A_CLIENT` |
| Assets tab | empty | `USER_A_ASSET` |
| Staff / HR list | only B | `TEST ADMIN A` |
| Stats cards | all zeros | A's totals |
| Audit trail | B's own events | A's events |

Not even for a flash while the page loads — the providers now clear their state
the moment the signed-in user changes, before any new request goes out.

### Back to User A

9. Sign out, sign in as A again. A still sees `USER_A_ASSET`,
   `USER_A_CLIENT` and nothing of B's.

---

## 2. Cross-user tests that ignore the UI

The UI filtering is not the control being tested here — RLS is. Run these with
each user's own access token so PostgREST applies their policies.

Get a token: sign in as the user, open DevTools → Application → Local Storage →
`ararat_auth_token` → copy `access_token`.

```bash
# ── User A's token, asking for User B's rows ────────────────────────────────
# Expect: [] — not a 403, not B's data. RLS filters rows, it does not error.
curl -s "$SUPABASE_URL/rest/v1/clients?select=id,full_name" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_A" | grep -c USER_B
# → 0

curl -s "$SUPABASE_URL/rest/v1/assets?select=id,description" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_A" | grep -c USER_B
# → 0

# ── UPDATE another tenant's row by id ───────────────────────────────────────
# Expect: [] (zero rows matched) — the row is invisible, so nothing updates.
curl -s -X PATCH "$SUPABASE_URL/rest/v1/clients?id=eq.$USER_B_CLIENT_ID" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"full_name":"HACKED"}'
# → []

# ── DELETE another tenant's row by id ───────────────────────────────────────
curl -s -X DELETE "$SUPABASE_URL/rest/v1/assets?id=eq.$USER_B_ASSET_ID" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_A" \
  -H "Prefer: return=representation"
# → []

# ── INSERT into another tenant ──────────────────────────────────────────────
# Expect: 403, new row violates row-level security policy.
curl -s -X POST "$SUPABASE_URL/rest/v1/clients" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"PLANTED","admin_id":"'"$USER_B_ADMIN_ID"'"}'
# → 403

# ── Read another admin's profile (name, phone, salary, national id) ─────────
curl -s "$SUPABASE_URL/rest/v1/user_profiles?select=full_name,phone" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_A" | grep -c "TEST ADMIN B"
# → 0
```

Then repeat every one of them with `$TOKEN_B` against User A's ids. Both
directions must fail; a policy that is right in one direction and wrong in the
other is a common way to get this half-fixed.

### Tenant-crossing account creation

The `create-staff-user` Edge Function used to take `admin_id` from the request
body. Confirm it no longer does:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/create-staff-user" \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d '{"email":"planted@example.com","password":"Passw0rd!x","full_name":"Planted",
       "role":"manager","admin_id":"'"$USER_B_ADMIN_ID"'"}'
# → 403 {"error":"Not authorised to create an account in another tenant."}
```

---

## 3. Session and state tests

| Test | Expected |
|---|---|
| Sign out → sign in as the other user, same tab, no refresh | new user's data only, no flash of the previous user's |
| Hard refresh (F5) while signed in | same user's data, nothing from the previous session |
| Two tabs, different accounts | each tab shows its own account; signing out of one does not paint the other's data into it |
| Leave a tab idle past the 30-minute inactivity timeout | signed out; signing back in loads fresh data |
| Let the access token refresh (default 1 h) | no reload, no data change — `TOKEN_REFRESHED` for the same user is ignored on purpose |
| Sign out, press Back | no dashboard data rendered from cache |

---

## 4. Roles are not ownership

Two admins both have `role = 'admin'` and must still be invisible to each
other. Check that being staff of a tenant grants that tenant's data only:

1. As User A, create a staff member (HR → add employee, or System
   Administration → users) with role `manager`.
2. Sign in as that manager. They see A's clients, assets and payments —
   **the same rows as A**, because `current_admin_id()` resolves to A for them.
3. They must not see B's anything.
4. Repeat with role `director`. A director is a tenant role now: their
   dashboard is company-wide **within their own tenant**, not platform-wide.
   Only `super_admin` reads across tenants.

---

## 5. Unowned rows

If section 4 of `verify_tenant_isolation.sql` reports rows with
`admin_id IS NULL`, those are rows whose owner could not be established from
anything the row itself carries. They are visible to `super_admin` only.

Identify the owner from the row's own history — `registered_by` /
`processed_by` / the linked client — then set it explicitly, one tenant at a
time:

```sql
-- Example: attribute a specific asset after confirming who registered it.
update public.assets set admin_id = '<the-admin-uuid>' where id = '<asset-uuid>';
```

Never bulk-assign unowned rows to "the first admin" or to whoever is
convenient. That is how one tenant ends up holding another's records — the bug
this whole exercise exists to remove.
