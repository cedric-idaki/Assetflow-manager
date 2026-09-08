# Backup Protocol

**Status:** in force from the date of adoption below.
**Owner:** the Platform Administrator named in [SERVER_ACCESS_AND_CREDENTIALS.md](SERVER_ACCESS_AND_CREDENTIALS.md).
**Reviewed:** at every quarter end, and after any change to the stack.

---

## 0. Why this document is specific

A backup policy that says "the database is backed up nightly" is not a policy.
It does not say what a backup *contains*, so nobody can tell whether a restore
would come back complete; it does not say who does it, so it is nobody's job;
and it does not say how it is verified, so the first test of the backups is the
outage.

This document names the four things that have to be true for this system to
survive a loss, and what is done about each. **Section 5 is the one that
matters**: a backup nobody has restored is a hypothesis.

---

## 1. What this system actually is

Four stores, not one. A restore that recovers only the first is not a restore.

| # | What | Where it lives | Lose it and… |
|---|------|----------------|--------------|
| 1 | **Postgres database** — 127 tables, every RLS policy, every RPC, every trigger | Supabase managed Postgres | everything. Members, loans, payments, ledger, audit trail. |
| 2 | **Storage objects** — 12 buckets (see §2.2) | Supabase Storage (S3-backed) | every KYC document, signed contract, certificate, collateral proof and archived receipt. The database rows survive and point at nothing. |
| 3 | **Secrets** — edge-function environment and Vault entries (§2.3) | Supabase project settings + `vault.secrets` | the app runs but cannot take an M-Pesa payment, send an email, decrypt employee PII, or file with KRA. **These are not in any database backup you can read back.** |
| 4 | **Code and configuration** — this repository, `supabase/migrations`, `supabase/functions`, `.env` | Git remote + the deploy host | the ability to rebuild anything. |

The frontend build (`dist/`) is deliberately **not** on this list. It is
reproducible from item 4 with `npm ci && npm run build`, and a stale copy is
worse than none.

### 1.1 The dependency nobody expects

Items 1 and 3 are coupled. Several columns are encrypted at rest with keys held
outside the database:

- `employee_private_data` — bank details, NSSF number, next-of-kin ID, under `PII_ENC_KEY`
- tenant M-Pesa credentials — under `MPESA_CRED_ENC_KEY`
- tenant eTIMS credentials — under `ETIMS_CRED_ENC_KEY`
- tenant SignNow credentials — under `SIGNNOW_CRED_ENC_KEY`

**A database restored without those keys is a database with permanently
unreadable columns.** Not corrupted — unreadable, forever. This is why §3.3
exists and why it is not optional.

---

## 2. What is backed up

### 2.1 Database

| | |
|---|---|
| **Method** | Supabase automated daily backup (project-level), plus a weekly logical dump held off-platform |
| **Automated backup retention** | 7 days rolling (Supabase Pro default — confirm against the project's current plan at each quarterly review) |
| **Off-platform dump** | `pg_dump` custom format, weekly, retained 12 weeks + one dump per calendar quarter retained 2 years |
| **Contents** | Schema, data, RLS policies, functions, triggers, enums, extensions, sequences |
| **Excludes** | `auth.users` password hashes are Supabase-managed and are **not** in a `pg_dump` of the `public` schema — see §3.2 |

The weekly off-platform dump exists because the automated backup lives in the
same account as the thing it protects. An account compromise, a billing lapse
or a mistaken project deletion takes both. The off-platform copy is the answer
to "what if we lose the Supabase project itself".

```bash
# Weekly, run by the Platform Administrator (see §4)
# The connection string comes from the credential register, never from history.
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --schema=public \
  --file="ararat-db-$(date +%Y-%m-%d).dump"
```

### 2.2 Storage objects

Twelve buckets, all but three private:

| Bucket | Public | Contents |
|---|---|---|
| `kyc-documents` | no | client identity documents |
| `contracts` | no | executed sale and hire-purchase contracts |
| `esign-documents` | no | documents in the e-signature flow |
| `signed-certificates` | no | SignNow-executed certificates and guarantee agreements |
| `employee-documents` | no | HR files |
| `sacco-asset-documents` | no | SACCO fixed-asset supporting documents |
| `sacco-loan-collateral` | no | ownership and valuation proofs for pledged assets |
| `payment-request-documents` | no | invoices and delivery evidence behind payment approvals |
| `document-archive` | no | every PDF the system has issued |
| `asset-images` | **yes** | marketplace photos |
| `client-photos` | **yes** | passport photos |
| `agent-*` / misc | varies | see `supabase/migrations/*storage*` |

```bash
# Weekly, same run as the database dump.
supabase storage download --recursive --experimental \
  "ss:///" "./storage-$(date +%Y-%m-%d)/"
```

> **The private buckets are the ones that matter for compliance.** A KYC
> document that cannot be produced is a regulatory finding, not an
> inconvenience. Confirm the private-bucket byte count in the verification run
> (§5), not just that the command exited zero.

### 2.3 Secrets

Two places, and they are backed up differently because they are different
things.

**Edge-function environment** (`supabase secrets list` shows the names, never
the values):

```
SUPABASE_URL              SERVICE_ROLE_KEY          SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY RESEND_API_KEY            EMAIL_FROM
APP_URL                   PORTAL_URL                ALLOWED_ORIGINS
CRON_SECRET               ESIGN_ALLOWED_PORTALS
MPESA_ENV                 MPESA_CONSUMER_KEY        MPESA_CONSUMER_SECRET
MPESA_PASSKEY             MPESA_SHORTCODE           MPESA_HEAD_OFFICE_SHORTCODE
MPESA_ACCOUNT_TYPE        MPESA_CRED_ENC_KEY
ETIMS_CRED_ENC_KEY        SIGNNOW_CRED_ENC_KEY      PII_ENC_KEY
STRIPE_SECRET_KEY
TWILIO_ACCOUNT_SID        TWILIO_AUTH_TOKEN         TWILIO_PHONE_NUMBER
```

**Vault entries** — per-tenant provider credentials, encrypted rows in
`vault.secrets`. These *are* inside a full database backup, but are useless
without the corresponding `*_CRED_ENC_KEY` above.

**Storage rule for secrets:** a password manager vault (1Password / Bitwarden
business tier), one entry per secret, shared with the Platform Administrator
and the named deputy and **nobody else**. Not in Git. Not in `.env` committed
anywhere. Not in a spreadsheet on a shared drive. Not in this repository —
`.env` is gitignored and must stay so.

### 2.4 Code

Git, pushed to the remote on every merge to `main`. The migration files in
`supabase/migrations/` are the schema's source of truth; the deployed database
is a consequence of them, not the other way round.

---

## 3. Frequency, retention and where it goes

| Item | Frequency | Retention | Location |
|---|---|---|---|
| Database (automated) | daily | 7 days rolling | Supabase-managed |
| Database (logical dump) | weekly, Sunday | 12 weeks; quarterly kept 2 years | encrypted off-platform object storage, separate provider and separate account |
| Storage buckets | weekly, Sunday | 12 weeks | same off-platform location |
| Secrets | on change, and verified quarterly | current + previous value | password manager vault |
| Code | every merge | indefinite | Git remote |

### 3.1 Off-platform means a different account

Not a different bucket in the same project. Not a different Supabase project on
the same login. **A different provider, or at minimum a different account with
different credentials and a different MFA device.** The scenario being defended
against is losing access to the primary account, and a copy inside it does not
help.

### 3.2 What the database dump does not contain

`pg_dump --schema=public` does not carry:

- **`auth.users`** — logins, password hashes, MFA enrolments. Supabase manages
  this schema. A restore into a fresh project produces a database full of rows
  referencing user ids that no longer exist, and **nobody can log in.**
- **Storage object bytes** — only the `storage.objects` metadata rows, if the
  storage schema is included. The files themselves come from §2.2.
- **Realtime publications, cron jobs, and project settings** — reconfigured by
  hand on restore, see the runbook.

This is the single most common way a "successful" restore turns out to be
useless, which is why the drill in §5.2 restores into a *fresh project* and
tries to log in.

### 3.3 Secrets are backed up on change, not on schedule

A secret rotated on Tuesday and backed up on Sunday leaves five days where the
vault holds the wrong value. Whoever rotates a secret updates the vault entry
**in the same sitting**, and records the rotation in the register in
[SERVER_ACCESS_AND_CREDENTIALS.md](SERVER_ACCESS_AND_CREDENTIALS.md).

---

## 4. Who does it

| Role | Named person | Responsibility |
|---|---|---|
| **Platform Administrator** | _(fill in)_ | Runs the weekly backup. Owns the credential vault. Authorises restores. |
| **Deputy** | _(fill in)_ | Everything the Administrator does, when they are unavailable. Holds independent vault access. |
| **Verifier** | _(fill in — must NOT be the Administrator)_ | Runs the quarterly restore drill and signs it off. |

Three rules:

1. **Two people always hold vault access.** One person with the only copy of the
   credentials is a single point of failure wearing a lanyard.
2. **The Verifier is not the Administrator.** Somebody who has never restored
   this system before should be able to follow the runbook. If only its author
   can, it is not a runbook.
3. **Every name above is filled in before this document is adopted.** A blank
   is not a placeholder, it is an unowned responsibility.

---

## 5. Verification — the part that makes the rest true

### 5.1 Weekly, after every backup run (10 minutes)

```bash
node scripts/verify-backup.mjs --dump ararat-db-YYYY-MM-DD.dump --storage ./storage-YYYY-MM-DD/
```

The script checks what a green exit code from `pg_dump` does not:

- the dump is a readable custom-format archive, not a truncated file
- it contains the expected table count, and specifically the tables that hold
  money and identity (`payments`, `sacco_loans`, `clients`, `audit_logs`)
- row counts are in the same order of magnitude as last week's — a dump with
  90% fewer payments succeeded at exiting zero and failed at being a backup
- every private bucket is present in the storage copy and non-empty
- no `*_ENC_KEY` value appears anywhere in the dump or the storage copy

Record the result in the backup log. A failed check is an incident, not a
retry.

### 5.2 Quarterly restore drill (half a day)

The full procedure is [RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md). In summary: the
**Verifier**, not the Administrator, restores the most recent weekly backup into
a **fresh, empty Supabase project**, and the drill passes only when they can:

1. log in as a super admin,
2. open a SACCO member's portal and see their shares and loans,
3. open a KYC document and a signed contract from storage,
4. read an employee's encrypted bank details (proves the PII key travelled),
5. run `scripts/verify_tenant_isolation.sql` clean.

Anything less is a partial restore, and the drill fails. Sign off in the log
with the date, the person, the backup restored, and the elapsed time — the last
of these is your real RTO, whatever the policy says.

### 5.3 What "verified" is not

- `pg_dump` exiting zero
- a file existing at the expected path with a plausible size
- a restore that completes without an error message

None of these say the data is *usable*. Only §5.2 does.

---

## 6. Recovery objectives

| | Target | Basis |
|---|---|---|
| **RPO** (how much data we can lose) | 24 hours | daily automated backup |
| **RPO, worst case** | 7 days | if the Supabase account itself is lost and the weekly off-platform dump is the newest copy |
| **RTO** (how long to be back up) | 4 hours | measured, not assumed — see the elapsed time on the last drill |

If the measured drill time exceeds the RTO, the RTO is wrong. Change the
number or change the process; do not leave a target nobody has ever met.

---

## 7. Incident triggers

Run the restore runbook on any of these, without waiting for permission to
investigate first:

- data loss reported by more than one tenant
- a migration applied to production that cannot be rolled back
- suspected unauthorised access to the service-role key
- the Supabase project becoming inaccessible for more than 30 minutes

---

## 8. Adoption

| | |
|---|---|
| Adopted on | _(date)_ |
| Adopted by | _(name, role)_ |
| Next review | _(quarter end)_ |

Related: [RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md) ·
[SERVER_ACCESS_AND_CREDENTIALS.md](SERVER_ACCESS_AND_CREDENTIALS.md) ·
[TRAINING.md](TRAINING.md)
