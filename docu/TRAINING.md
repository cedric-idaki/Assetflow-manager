# Operations Training

Two sessions, both hands-on, both ending in something the trainee did rather
than watched.

| | Session | Length | Who must attend |
|---|---|---|---|
| **A** | Server access, credentials and the backup environment | half a day | Platform Administrator, Deputy, Verifier |
| **B** | Restoring the system from backup | half a day | the same three, plus anyone who might be on call |

> **What this document is.** It is the curriculum, the exercises and the
> sign-off record. It is not a substitute for running the sessions — a training
> plan nobody has sat through trains nobody. The competency record in §5 is
> only meaningful once real names and real dates are in it.

**Rule for both sessions: the trainee drives.** The trainer does not touch the
keyboard. Somebody who has watched a restore has not done a restore, and the
difference shows at 2am.

---

## Session A — Server access, credentials and the backup environment

**Pre-reading:** [SERVER_ACCESS_AND_CREDENTIALS.md](SERVER_ACCESS_AND_CREDENTIALS.md)
and [BACKUP_PROTOCOL.md](BACKUP_PROTOCOL.md).

### A1. What this system is (30 min)

Draw it on a whiteboard, from memory, before opening anything:

- Frontend (React/Vite) → Supabase Postgres + Storage + Auth + Edge Functions
- 127 tables, all tenant-scoped by row-level security
- 33 edge functions holding every secret the browser must never see
- 12 storage buckets, nine of them private
- Four external providers: Safaricom Daraja, Resend, Stripe/Twilio, SignNow

**The point to land:** row-level security is what keeps one SACCO from reading
another's members, **and the service-role key bypasses all of it.** Everything
in the credentials session follows from that one sentence.

### A2. Access, hands on (45 min)

Each trainee, on their own login:

1. Log in to Supabase with MFA. Find the project ref, the anon key and where
   the service-role key is (without copying it anywhere).
2. `supabase secrets list` — read the names. Note that no values are shown, and
   that this is deliberate.
3. Open the vault. Find `PII_ENC_KEY`. **Do not read it aloud.** Explain who
   else can see it and how you would know if somebody had.
4. Find the sealed envelope in the safe. Confirm the seal is intact and dated.

### A3. The encryption keys (30 min)

Work through §2.2 of the credentials document together and answer, out loud:

- *What exactly stops working if `MPESA_CRED_ENC_KEY` is lost?* (Every tenant's
  M-Pesa collection returns 409 until they re-enter credentials.)
- *And if `PII_ENC_KEY` is lost?* (Employee bank details, NSSF numbers and
  next-of-kin IDs are unreadable permanently. There is no recovery.)
- *Why can't we just generate a new one?* (Because the data is encrypted under
  the old one. Rotating is a migration, not a setting change.)

If a trainee cannot answer the third question in their own words, do it again.
It is the most expensive misunderstanding available in this system.

### A4. The backup environment (60 min)

Each trainee runs a real backup, end to end:

```bash
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges \
        --schema=public --file="training-$(date +%Y-%m-%d).dump"

supabase storage download --recursive --experimental "ss:///" "./training-storage/"

node scripts/verify-backup.mjs --dump training-*.dump --storage ./training-storage/
```

Then, deliberately, **break it and watch the verifier catch it**: truncate the
dump file, re-run the script, and read the failure. The lesson is not the
command; it is that `pg_dump` exiting zero proves nothing.

### A5. Off-platform storage (30 min)

- Where the weekly copy goes, and *why it is a different account* — walk
  through the scenario where the Supabase account itself is lost.
- Retention: 12 weeks rolling, quarterly kept two years.
- Each trainee locates last week's copy unaided.

### A6. Assessment

The trainee is competent when, **without notes**, they can:

- [ ] name the four things that must be backed up, and say why the database
      alone is not enough
- [ ] explain what `auth.users` not being in the dump means for a restore
- [ ] run a backup and its verification, and interpret a failure
- [ ] say which secrets cannot be rotated casually, and why
- [ ] find any named credential in the vault in under a minute

---

## Session B — Restoring the system

**Pre-reading:** [RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md), in full.

**Setup:** a throwaway Supabase project, and last week's real backup. Not a
synthetic fixture — the drill is worthless if it does not exercise the actual
backup.

### B1. Decide before you act (20 min)

Three scenarios on cards. For each, the trainee says which section of the
runbook applies and why, **before** touching a keyboard:

1. "A tenant says forty of their payments have vanished."
2. "A migration ran on production this morning and dropped a column."
3. "The Supabase project is gone."

The trap is scenario 1: the instinct is a full restore, which would throw away
everything everyone else has done today to recover forty rows. The runbook says
§2, targeted.

### B2. The full rebuild, driven by the trainee (150 min)

Follow [RESTORE_RUNBOOK.md §5](RESTORE_RUNBOOK.md#5-full-rebuild--the-whole-project-is-gone),
step by step, trainee at the keyboard, trainer silent unless asked.

Expect to get stuck at **§5.3, auth**. That is the point of the exercise. The
database will restore cleanly, look complete, and nobody will be able to log
in. Let the trainee find it. Somebody who has hit that wall once in a drill
will never forget it in an incident.

### B3. Prove it (40 min)

Work the checklist in [RESTORE_RUNBOOK.md §7](RESTORE_RUNBOOK.md#7-restore-is-not-complete-until-this-passes)
line by line. Every box, out loud, with the evidence on screen.

Pay particular attention to:

- **the employee bank-details decrypt.** It is the only check that proves the
  PII key travelled, and it is the one people skip.
- **tenant isolation.** Run `supabase/checks/verify_tenant_isolation.sql`. A
  restore that quietly loses an RLS policy is a data breach with a clean bill
  of health.

### B4. Time it, and write the number down (10 min)

Elapsed wall-clock from "project is gone" to the last tick. That number is the
organisation's real RTO. If it exceeds the four hours in the protocol, the
protocol is wrong — change the target or change the process, but do not leave a
number nobody has ever hit.

### B5. Fix the runbook while it is fresh (20 min)

Every question the trainee had to ask is a gap in the document. Edit it now,
together, in the same session. A runbook only its author can follow is not a
runbook.

### B6. Tear down

Delete the throwaway project. A restored copy of production sitting around is a
second production system with none of the controls on it.

### B7. Assessment

The trainee is competent when they can:

- [ ] choose the right recovery path for a described incident, and justify it
- [ ] complete a full rebuild from the runbook without help
- [ ] explain what `auth.users` means for a restore, having hit it
- [ ] complete the verification checklist and say why each line is on it
- [ ] state the measured RTO and what dominates it

---

## 3. Cadence

| | When |
|---|---|
| Both sessions, full | on joining an operations role |
| Session B, refresher | quarterly, as the drill in BACKUP_PROTOCOL §5.2 |
| Both, review | after any change to the stack, or any real incident |

The quarterly drill **is** the refresher. Run by the Verifier, it does double
duty: it keeps the skill current and it proves the backups are still good.

---

## 4. Common misconceptions, and what to say

| They think | Say |
|---|---|
| "Supabase backs it up, we're fine." | The automated backup lives in the account we might lose. And it does not carry the encryption keys. |
| "The dump succeeded, so the backup is good." | `pg_dump` exits zero on a backup with 90% of the rows missing. That is what the verifier script is for. |
| "We can restore in an hour." | What did the last drill actually take? Use that number. |
| "We'd work it out on the day." | The one time this was true, it took eleven hours. That is why the runbook exists. |
| "Only the database matters." | Restore it without storage and every KYC document is a broken link. Without the keys, every encrypted column is gone. |

---

## 5. Competency record

Filled in by the trainer, at the end of the session. Blank rows mean the
training has not happened, not that it went unrecorded.

| Name | Role | Session A | Session B | Assessed by | Next refresher |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

---

## 6. Drill log

| Date | Verifier | Backup restored | Elapsed | Checklist result | Runbook changes made |
|---|---|---|---|---|---|
| | | | | | |

---

Related: [BACKUP_PROTOCOL.md](BACKUP_PROTOCOL.md) ·
[RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md) ·
[SERVER_ACCESS_AND_CREDENTIALS.md](SERVER_ACCESS_AND_CREDENTIALS.md)
