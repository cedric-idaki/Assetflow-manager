# Server Access and Credentials

**This document names things. It never contains values.**

Every secret below lives in the password-manager vault. If you find a value
written into this file, into `.env` in a commit, into a chat message or into a
spreadsheet, treat it as leaked and follow
[RESTORE_RUNBOOK.md §6](RESTORE_RUNBOOK.md#6-leaked-key).

---

## 1. Who has access to what

| Person | Role | Supabase | Vault | Deploy host | Git | Rotates secrets |
|---|---|---|---|---|---|---|
| _(fill in)_ | Platform Administrator | Owner | full | yes | admin | yes |
| _(fill in)_ | Deputy Administrator | Owner | full | yes | admin | yes |
| _(fill in)_ | Verifier | Developer (read) | **no** | no | write | no |
| _(fill in)_ | Developer | Developer | **no** | no | write | no |

Four rules:

1. **Two people, never one, hold Owner and vault access.** One person with the
   only copy is a single point of failure who can also go on holiday.
2. **Developers do not hold production secrets.** They do not need them to
   build, and a secret held by five people is a secret held by nobody.
3. **The Verifier holds no vault access.** The quarterly drill is supposed to
   prove the *documented* process works. Somebody who can improvise around a
   gap will not notice the gap.
4. **Access is removed the day somebody leaves**, and the secrets they could
   read are rotated within the week. Removing the login is not enough — they
   may have copied a key.

---

## 2. The credential register

Names only. Where each lives, who holds it, what breaks without it, and when it
was last rotated.

### 2.1 Platform

| Name | Held in | Breaks without it | Rotate |
|---|---|---|---|
| Supabase account login (+ MFA) | vault, MFA on two devices | everything | on staff change |
| `SUPABASE_SERVICE_ROLE_KEY` / `SERVICE_ROLE_KEY` | vault + function env | every edge function; bypasses RLS entirely | immediately on suspicion; annually otherwise |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | function env + frontend build | the app cannot reach the API | with the service key |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | not secret; recorded for the rebuild | — | — |
| Database connection string | vault | backups | with the database password |
| Deploy-host login | vault | releases | on staff change |
| Git remote | SSO | releases | on staff change |

> **The service-role key bypasses row-level security completely.** Every
> tenant-isolation policy in this system is irrelevant to a caller holding it.
> It belongs in edge-function environment variables and the vault, and nowhere
> a browser can reach.

### 2.2 Encryption keys — the irreplaceable ones

| Name | Encrypts | Lose it and… |
|---|---|---|
| `PII_ENC_KEY` | `employee_private_data`: bank account, NSSF number, next-of-kin ID | those columns are unreadable **for ever**. Not corrupted — unrecoverable. |
| `MPESA_CRED_ENC_KEY` | per-tenant M-Pesa consumer key/secret/passkey in Vault | every tenant re-enters their M-Pesa credentials; collections 409 until they do |
| `ETIMS_CRED_ENC_KEY` | per-tenant KRA eTIMS credentials | eTIMS filing stops for every tenant using it |
| `SIGNNOW_CRED_ENC_KEY` | per-tenant SignNow API credentials | certificate and guarantee signing stops |

These four are the reason a database backup on its own is not a backup. They
are held in the vault **and** written on paper in a sealed envelope in the
company safe, because a vault outage during a rebuild is exactly when you need
them. The paper copy is opened only by the Administrator or Deputy, and
re-sealed with a new envelope and a dated signature.

### 2.3 Providers

| Name | Service | Breaks without it |
|---|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend | all email: credentials, receipts, reminders, guarantor notices |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, `MPESA_SHORTCODE`, `MPESA_HEAD_OFFICE_SHORTCODE`, `MPESA_ENV`, `MPESA_ACCOUNT_TYPE` | Safaricom Daraja | platform-level M-Pesa collection |
| `STRIPE_SECRET_KEY` | Stripe | card payments |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Twilio | SMS |
| `CRON_SECRET` | internal | scheduled jobs can be triggered by anyone who guesses the URL |
| `ALLOWED_ORIGINS` | internal | CORS opens up; not secret, but security-relevant |
| `APP_URL`, `PORTAL_URL`, `ESIGN_ALLOWED_PORTALS` | internal | links in emails point at the wrong host |

`EMAIL_FROM` deserves a note. Every sender reads it from one place,
[_shared/email.ts](../supabase/functions/_shared/email.ts), and unset it falls
back to `Ararat <notifications@araratsbc.com>`. That fallback used to be
Resend's sandbox `onboarding@resend.dev`, which delivers **only to the Resend
account owner's own address** — email appeared to work in testing and reached
no customer. A missing secret now fails at Resend instead, which is visible.
Both the secret and Resend's verification of `araratsbc.com` need confirming
after every rebuild; an unverified sending domain bounces every send.

### 2.4 Per-tenant secrets in Vault

Tenants enter their own M-Pesa, eTIMS and SignNow credentials through the app.
Those are stored as encrypted rows in `vault.secrets`, under the keys in §2.2.
They are inside a full database backup and useless without those keys — which
is the whole point of §2.2 being on paper as well as in the vault.

---

## 3. Rotation

| Trigger | Rotate |
|---|---|
| Somebody with access leaves | everything they could read, within one week |
| Suspected exposure | that secret, immediately, before investigating |
| Annually | service-role key, database password, provider API keys |
| Never on a schedule | `PII_ENC_KEY` and the `*_CRED_ENC_KEY` values — see below |

Rotating an encryption key is not a key change, it is a **data migration**:
decrypt with the old key, re-encrypt with the new, in one pass, with both keys
present and a verified backup taken first. It is planned work, never an
incident-time improvisation. If one of these is exposed, the correct response
is to plan that migration urgently — not to replace the key and discover the
columns no longer read.

**Whoever rotates a secret updates the vault entry in the same sitting** and
adds a line to §5. A rotation not recorded is a rebuild that will fail.

---

## 4. Environments

| | Purpose | Data |
|---|---|---|
| **Production** | live tenants | real. Treat every row as somebody's money or identity. |
| **Staging** | pre-release verification | a restored copy with PII scrubbed, or synthetic. **Never a straight copy of production.** |
| **Local** | development | seeded or synthetic |

A staging environment holding real customer data is a second production system
with none of the controls. If a restored copy is used for a drill, it is
destroyed when the drill ends — see [RESTORE_RUNBOOK.md §8](RESTORE_RUNBOOK.md#8-quarterly-drill).

---

## 5. Rotation log

| Date | Secret | Rotated by | Reason | Vault updated |
|---|---|---|---|---|
| | | | | |

---

## 6. Adoption

| | |
|---|---|
| Adopted on | _(date)_ |
| Adopted by | _(name, role)_ |
| Next access review | _(quarter end)_ |

Related: [BACKUP_PROTOCOL.md](BACKUP_PROTOCOL.md) ·
[RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md) · [TRAINING.md](TRAINING.md)
