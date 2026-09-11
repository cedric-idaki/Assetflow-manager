# Moving the portal to araratsbc.com

**From:** `assetflow.smebusinessclinic.com`
**To:** `araratsbc.com`
**Owner:** the Platform Administrator named in [SERVER_ACCESS_AND_CREDENTIALS.md](SERVER_ACCESS_AND_CREDENTIALS.md).

---

## 0. What was true when this was written (2026-09-11)

| Fact | Value |
| --- | --- |
| `assetflow.smebusinessclinic.com` resolves to | `94.136.170.164`, Apache |
| `araratsbc.com` and `www.araratsbc.com` resolve to | `94.136.170.163` |
| Nameservers, both domains | `ns1`–`ns4.ciscowebservers.net` |
| HTTPS on `araratsbc.com` | wrong certificate — the server answers with someone else's |

Two things follow from that table. The registrar does not need touching: both
domains already answer to the same host's nameservers, so the DNS record is
edited in the same panel as everything else. And the new domain is on a
*different IP* from the live site, which is the one thing that actually has to
move.

The React app itself needs no change. Every portal link, reset link and share
link is built from `window.location.origin`, so the app serves correctly under
whatever hostname reaches it. What breaks if the steps below are skipped is
Supabase: the auth email links and the Edge Function CORS allowlist are pinned
to an origin, and the new one is not on either list yet.

Do the steps in order. Steps 1–3 are safe at any time; nothing is visible to
users until Step 6.

---

## 1. Attach the domain to the hosting account

The live site's cPanel account sits on `.164`. `araratsbc.com` currently answers
on `.163`, which is a different account — almost certainly the host's parked
default, not your site.

In the cPanel account that serves the live site, add `araratsbc.com` as an
**Addon Domain**, and set its document root to the folder the live site already
uses rather than a new `araratsbc.com/` folder. One document root means one
upload, not two that drift apart.

Adding the domain inside the account normally rewrites its zone to that
account's IP. Confirm it did:

```bash
nslookup araratsbc.com
```

It must come back `94.136.170.164`. If it still says `.163`, edit the A records
for `@` and `www` in the host's DNS zone editor and wait for the TTL.

## 2. Issue the certificate

Run AutoSSL (or Let's Encrypt) for `araratsbc.com` **and** `www.araratsbc.com`.
Until this passes, the site cannot be used and must not be advertised:

```bash
curl -sSI https://araratsbc.com/
```

A `200` with no certificate complaint means done. Today this fails with
`SEC_E_WRONG_PRINCIPAL`, which is the host's default certificate answering for
a domain it was not issued for.

## 3. Serve the app there

If Step 1 pointed the addon at the existing document root, there is nothing to
upload — the same files answer on both hostnames immediately.

If it has its own root, upload the full contents of `dist/` there, including the
two hidden entries `.htaccess` and `.well-known/`. See
[PLAY_STORE.md](../PLAY_STORE.md) for what each file is for.

## 4. Supabase auth URLs

Dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://araratsbc.com`
- **Redirect URLs:** add `https://araratsbc.com/**`, and keep the old host's
  entries until it is retired.

This is not cosmetic. Password reset sends `origin + /reset-password`, signup
sends `origin + /login`, and the `provision-client` function invites new clients
to `APP_URL + /reset-password`. An origin missing from the allowlist turns every
one of those emails into a dead link.

## 5. Edge Function secrets

Three secrets carry the origin. As of 2026-09-11 two are set and one has never
been set at all.

| Secret | State | Set to |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | set 2026-09-03 | the old origin plus `https://araratsbc.com,https://www.araratsbc.com` |
| `APP_URL` | set 2026-05-15 | `https://araratsbc.com` |
| `PORTAL_URL` | **never set** | `https://araratsbc.com` |

```bash
npx supabase secrets set --project-ref ektyvejahnkxqumeibke PORTAL_URL=https://araratsbc.com APP_URL=https://araratsbc.com
```

`ALLOWED_ORIGINS` is a whole-value replacement, not an append — pass every
origin you want to keep in one comma-separated string, including the old host,
or browser calls from the old domain start returning 403 the moment the secret
is rewritten.

Functions read these at cold start, so a redeploy is not required but a short
lag is normal.

`PORTAL_URL` being unset is a pre-existing defect this step happens to fix: the
agent follow-up reminders, e-sign reminders, SACCO governance tick and statutory
return reminders all build their links from it, and have been sending mail with
the link omitted.

## 6. Cutover

Only once Step 2 passes. In [public/.htaccess](../public/.htaccess), uncomment
the two `Canonical host` lines, rebuild, and upload:

```bash
npm run build
```

From then on `assetflow.smebusinessclinic.com` answers `301` to
`araratsbc.com`.

**Do not delete the old hostname.** Agent share links, client portal links and
onboarding emails already in circulation carry it, and that redirect is the only
thing that still honours them. It costs nothing to leave it resolving.

## 7. Android app

The app has not been packaged yet — `public/.well-known/assetlinks.json` still
holds the `REPLACE_WITH_` placeholders — so there is no migration to do. Package
it against `araratsbc.com` from the start; PLAY_STORE.md now says so throughout.

The package ID `com.smebusinessclinic.assetflow` is not a web address and does
not change. Renaming it would make a different app, not a renamed one.
