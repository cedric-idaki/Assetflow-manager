# Restore Runbook

**Read this before you need it.** The first time anybody follows these steps
should be a drill, not an outage.

**Authorised to run a production restore:** the Platform Administrator or the
Deputy named in [SERVER_ACCESS_AND_CREDENTIALS.md](SERVER_ACCESS_AND_CREDENTIALS.md).
Nobody else, and never without the second person on the call.

---

## 0. Before you touch anything

Answer these three in writing, in the incident channel, before step 1:

1. **What was lost?** One table, one tenant, or the project? The answer changes
   which section you use, and restoring a whole project to recover one deleted
   row destroys everything anybody has done since.
2. **When was it lost?** You are restoring to a point *before* that. If you do
   not know, you cannot pick a backup.
3. **Is the loss still happening?** A restore on top of an active compromise or
   a still-running bad job just gives the problem fresh data to eat. Stop the
   cause first.

Then take a backup of the *current* broken state. It is evidence, and
occasionally it turns out to contain something the older backup does not.

---

## 1. Scenarios

| What happened | Go to |
|---|---|
| Rows deleted or corrupted, database otherwise healthy | §2 — targeted restore |
| Bad migration applied to production | §3 |
| Storage objects lost, database intact | §4 |
| Whole Supabase project lost or inaccessible | §5 — full rebuild |
| Service-role key or a provider secret leaked | §6 |

---

## 2. Targeted restore (some rows are wrong)

The instinct is to restore the whole database. Resist it: everything since the
backup would be lost to recover a fraction of it.

1. Restore the most recent good dump into a **scratch project or a local
   Postgres**, never over production:

   ```bash
   createdb ararat_scratch
   pg_restore --dbname=ararat_scratch --no-owner --no-privileges ararat-db-YYYY-MM-DD.dump
   ```

2. Extract only what is needed:

   ```bash
   psql ararat_scratch -c "\copy (select * from public.payments where admin_id = '<tenant>' and payment_date >= '<date>') to 'recover.csv' csv header"
   ```

3. Load into production **inside a transaction, with the row count checked
   before commit**:

   ```sql
   begin;
   create temp table incoming (like public.payments including defaults);
   \copy incoming from 'recover.csv' csv header
   -- Look at this number before going further.
   select count(*) from incoming i
    where not exists (select 1 from public.payments p where p.id = i.id);
   insert into public.payments select * from incoming i
    where not exists (select 1 from public.payments p where p.id = i.id);
   -- commit;   <- type this yourself, having read the count
   ```

   The `commit` is deliberately commented out. Uncommenting it is the moment a
   human takes responsibility for the number they just read.

4. Re-run the relevant verification script from `scripts/` and record what you
   did in the incident log.

> **Watch the triggers.** Several tables fire on insert — `payments` stamps
> reconciliation status, `sales` stamps customer type, `agent_wallets` refuses
> a withdrawal without an approved payment request. A bulk re-insert
> re-triggers all of it. Restore into the scratch database first and read what
> the triggers do there.

---

## 3. Bad migration

1. **Do not "fix forward" under pressure.** Write the down-migration first,
   review it with the second person, then apply it.
2. If the migration dropped or rewrote data, treat it as §2: the down-migration
   restores the *shape*, and the data comes from the dump.
3. Every migration in this repository is written to be idempotent and re-runnable.
   A migration that is not is a defect — fix that before anything else.
4. After recovery, add a `scripts/verify-*.sql` for whatever went wrong. Every
   one of those files exists because something once went wrong there.

---

## 4. Storage objects lost, database intact

The database still holds the paths; only the bytes are gone.

```bash
# Restore into the same bucket layout. Paths are <admin_id>/... and the RLS
# policies match on the first folder, so the structure is not optional.
supabase storage upload --recursive --experimental \
  "./storage-YYYY-MM-DD/kyc-documents/" "ss:///kyc-documents/"
```

Then find what is still missing — the database is the index:

```sql
-- Documents the registry claims exist. Check a sample of these paths really
-- resolve before declaring the restore complete.
select file_path, file_name, issued_at
  from public.document_archive
 order by issued_at desc
 limit 50;
```

Spot-check at least one object per private bucket by opening it through the
app, not by listing the bucket. A file that exists but whose RLS policy refuses
it is still, to a user, a missing file.

---

## 5. Full rebuild — the whole project is gone

Budget four hours. Work in this order; every step depends on the one above it.

### 5.1 New project

Create a fresh Supabase project. Record the new project ref, URL and keys in
the vault **immediately** — a rebuild done from a terminal with the keys only
in scrollback is a rebuild you cannot repeat.

### 5.2 Schema and data

```bash
pg_restore --dbname="$NEW_DB_URL" --no-owner --no-privileges \
           --clean --if-exists ararat-db-YYYY-MM-DD.dump
```

If `pg_restore` reports errors about extensions, install them first
(`pgcrypto`, `pg_trgm`) and re-run. Errors about roles that do not exist are
expected with `--no-owner` and can be ignored; **errors about tables cannot**.

### 5.3 Auth — the step everybody forgets

`auth.users` is **not** in the dump (see BACKUP_PROTOCOL §3.2). Every row in
`public.user_profiles` references a user id that does not exist in the new
project, so at this point the database is complete and **nobody can log in.**

Either:

- **restore the whole project** from Supabase's own backup, which does include
  `auth`, if the project still exists and this is a data-loss rather than a
  project-loss event; or
- **re-create the auth users with their original ids**, using the service-role
  admin API, driven from `public.user_profiles`:

  ```
  for each row in user_profiles:
      admin.createUser({ id: row.id, email: row.email,
                         email_confirm: true, password: <one-time> })
  ```

  Passwords cannot be recovered — they are hashes, and that is correct. Every
  user goes through a password reset. Plan the communication before you start,
  not after the first support call.

### 5.4 Secrets

```bash
supabase secrets set --project-ref <new-ref> \
  RESEND_API_KEY=... PII_ENC_KEY=... MPESA_CRED_ENC_KEY=... \
  ETIMS_CRED_ENC_KEY=... SIGNNOW_CRED_ENC_KEY=... CRON_SECRET=... \
  ALLOWED_ORIGINS=... APP_URL=... PORTAL_URL=...
```

**The `*_ENC_KEY` values must be the originals.** A new key does not fail
loudly — it fails as an employee's bank details that will not decrypt, a tenant
M-Pesa integration that returns 409, and a KRA filing that cannot authenticate.
If a key is genuinely lost, the affected columns must be re-entered by hand;
say so in the incident report rather than leaving unreadable data in place.

### 5.5 Functions

```bash
supabase functions deploy --project-ref <new-ref>
```

All 33. Then confirm `send-email`, `mpesa-callback` and `mpesa-stk-push`
respond — those three are the ones an outage is noticed through.

### 5.6 Storage

As §4, all twelve buckets. The bucket rows themselves are created by the
migrations; only the objects need uploading.

### 5.7 Frontend

```bash
npm ci
VITE_SUPABASE_URL=<new-url> VITE_SUPABASE_ANON_KEY=<new-anon-key> npm run build
# deploy dist/ to the host
```

Update `site_url` and `additional_redirect_urls` in `supabase/config.toml` and
push, or password reset links will point at the dead project.

### 5.8 Scheduled jobs

Re-create the cron entries that drive `sacco-governance-tick`,
`agent-followup-reminders`, `kyc-renewal-reminders`, `esign-reminders`,
`statutory-return-reminders` and `etims-transmit`. They are not in the database
dump. Nothing breaks visibly when they are missing — reminders simply stop, and
you find out weeks later.

---

## 6. Leaked key

1. **Rotate first, investigate second.** In the Supabase dashboard, rotate the
   service-role key, then redeploy every function.
2. Rotate any provider secret that shared the same exposure — M-Pesa, Resend,
   Stripe, Twilio, SignNow.
3. `PII_ENC_KEY` and the `*_CRED_ENC_KEY` values cannot simply be rotated: the
   data is encrypted under them. Rotating requires decrypt-with-old,
   encrypt-with-new, in one pass, with both keys present. Plan it; do not
   improvise it during an incident.
4. Read `audit_logs` for the exposure window and report to affected tenants.

---

## 7. Restore is not complete until this passes

Tick every line. A restore that fails any of them is a partial restore, and
saying otherwise is how a gap is discovered by a customer.

- [ ] A super admin can log in.
- [ ] A tenant admin can log in and sees **only** their own tenant's clients.
- [ ] A SACCO member can open their portal and see correct shares and loans.
- [ ] A KYC document opens from `kyc-documents`.
- [ ] A signed contract opens from `contracts`.
- [ ] An employee's encrypted bank details decrypt (proves `PII_ENC_KEY` travelled).
- [ ] An M-Pesa STK push reaches a phone in sandbox.
- [ ] An email sends through `send-email`.
- [ ] `supabase db query --linked -f supabase/checks/verify_tenant_isolation.sql` passes.
- [ ] Row counts in `payments`, `sacco_loans` and `clients` match the source
      backup, not merely "look plausible".
- [ ] The scheduled jobs are re-created and one has fired.

Record in the log: date, who ran it, which backup, elapsed time, and every box
that did not tick first time.

---

## 8. Quarterly drill

Same procedure, run by the **Verifier** — someone who does not administer the
system day to day. Into a fresh project, from the real weekly backup, following
this document and nothing else.

The drill has two outputs and both matter:

- **the checklist in §7**, and
- **the elapsed time**, which is your real RTO. Write it down even when —
  especially when — it embarrasses the target in the protocol.

If the Verifier had to ask the Administrator a question to get through, that
question is a gap in this runbook. Fix the document while the drill is fresh.

---

Related: [BACKUP_PROTOCOL.md](BACKUP_PROTOCOL.md) ·
[SERVER_ACCESS_AND_CREDENTIALS.md](SERVER_ACCESS_AND_CREDENTIALS.md) ·
[TRAINING.md](TRAINING.md)
