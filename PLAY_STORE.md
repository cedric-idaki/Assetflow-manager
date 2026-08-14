# Publishing Ararat to Google Play

The Android app is a **Trusted Web Activity (TWA)** — a thin native shell that
renders `https://assetflow.smebusinessclinic.com` fullscreen, with no browser
UI. It is the same site, not a second codebase, so a content change on the web
is live in the app immediately with no Play release.

The catch is that the app only loses its browser address bar if the site can
prove it authorises the app. That proof is `/.well-known/assetlinks.json`, and
getting it right is most of what follows.

---

## Step 1 — Deploy the site (do this first)

Nothing downstream works until the live site serves the new files. PWABuilder
reads your site over HTTP to build the app, so it has to see the real manifest
and icons.

```bash
npm run build
```

Upload **everything inside `dist/`** (4.4 MB) to the web root on your Apache
host, including the two hidden entries — many FTP clients hide them by default,
so turn on "show hidden files":

| File | Why it matters |
| --- | --- |
| `.htaccess` | Stops the SPA catch-all from swallowing `/.well-known/`. Without it the app cannot verify. |
| `.well-known/assetlinks.json` | The proof itself. Fingerprints get filled in at Step 3. |
| `manifest.json` | Name, icons, colours, display mode. PWABuilder reads this. |
| `icons/` | 192/512 plus maskable variants. |
| `sw.js`, `offline.html` | Branded offline screen instead of Chrome's dinosaur. |
| `index.html`, `assets/` | The app itself. |

Then confirm the server is doing the right thing:

```bash
curl -sI https://assetflow.smebusinessclinic.com/.well-known/assetlinks.json | grep -i content-type
```

It must say **`application/json`**. If it says `text/html`, the `.htaccess`
did not upload or `mod_rewrite` is off — fix that before going further, because
every later step depends on it.

---

## Step 2 — Package the app with PWABuilder

1. Go to **pwabuilder.com** and enter `https://assetflow.smebusinessclinic.com`.
2. Click **Package for stores → Android**.
3. Open the advanced options and set:

| Field | Value |
| --- | --- |
| Package ID | `com.smebusinessclinic.assetflow` |
| App name | `Ararat Management Platform` |
| Launcher name | `Ararat` |
| Start URL | `/login?src=twa` |
| Display mode | Standalone |
| Status bar / nav colour | `#0c2037` |
| Signing key | **Create new** — download and keep the ZIP |

   The **Start URL matters**: `?src=twa` is how the app knows it is the Play
   build and hides the subscription signup (see "Why signup is hidden" below).
   There is a referrer-based fallback if the parameter is ever lost, but the
   parameter is the reliable signal.

4. Download the ZIP. It contains `app-release-bundle.aab` (what you upload),
   `signing.keystore` + `signing-key-info.txt`, and an `assetlinks.json`.

> **Back up the keystore and its passwords somewhere you will not lose them**
> — a password manager, not just this folder. It is the identity of your app.
> If Play App Signing is enabled (Step 4) a lost upload key can be reset by
> Google, but that is a support round-trip you would rather avoid.

---

## Step 3 — Wire up Digital Asset Links

PWABuilder's ZIP has an `assetlinks.json` already filled in with your upload
key's fingerprint. Copy its `sha256_cert_fingerprints` value into
`public/.well-known/assetlinks.json` in this repo, replacing
`REPLACE_WITH_UPLOAD_KEY_SHA256`.

You will do this **twice** — once now with the upload key, and again in Step 4
with the key Google signs the released app with. Both belong in the array:

```json
"sha256_cert_fingerprints": [
  "AA:BB:CC:...",   // Play App Signing key  (from Play Console, Step 4)
  "DD:EE:FF:..."    // your upload key       (from PWABuilder's ZIP)
]
```

Rebuild, re-upload, and check it:

```bash
curl -s https://assetflow.smebusinessclinic.com/.well-known/assetlinks.json
```

**If this is wrong, the app still works — it just opens with a browser address
bar across the top.** That is the symptom to recognise; it always means the
fingerprints or the content-type are off.

---

## Step 4 — Play Console

A **$25 one-time** registration fee opens a developer account at
`play.google.com/console`.

> **Check which account type you need.** Google requires personal developer
> accounts created recently to run a closed test with a minimum number of
> testers for a continuous period before production access is unlocked;
> organisation accounts are treated differently. The exact thresholds change,
> so read what Console tells you at signup — if it applies to you it adds
> weeks, and it is much better to find that out now than after the app is
> built. Registering as your business rather than as an individual is usually
> the right call here.

Then: **Create app** → upload `app-release-bundle.aab` to a release track.

Once uploaded, go to **Test and release → Setup → App integrity → App signing**
and copy the **SHA-256 certificate fingerprint** of the *app signing key*. That
is the second fingerprint for Step 3. Add it, redeploy, done.

### App access — do not skip this

Ararat is entirely behind a login, and the Play build deliberately has no
signup. **A reviewer who cannot sign in will reject the app.** Under
**App access**, choose "All or some functionality is restricted" and provide
working demo credentials — ideally a throwaway tenant with representative but
non-real data.

This is the single most likely cause of rejection for this app.

### The rest of the checklist

| Section | Notes |
| --- | --- |
| Privacy policy | **Required.** Must be a public URL. Non-negotiable here — the app handles KYC documents and ID numbers. |
| Data safety | Declare it honestly: personal identifiers, financial info, documents. Say that data is encrypted in transit and that users can request deletion. |
| Content rating | Fill in the questionnaire — it's a business/utility app, so this is quick. |
| Target audience | 18+. Do not tick anything that implies a child audience. |
| Store listing | Assets are in `store-assets/` (see below). |

### Store listing copy

**App name** (30 max): `Ararat Management Platform`

**Short description** (80 max):
`Manage assets, SACCOs, members, KYC, payments and e-signatures in one portal.`

**Full description** — a starting point, edit freely:

> Ararat is a management platform for asset companies, SACCOs and chamas.
> Keep members, clients and assets in one register, move applications through
> KYC and renewals, collect and reconcile payments, and get documents signed
> without leaving the portal.
>
> • Member, client and asset registers with per-organisation separation
> • KYC capture, review and renewal tracking
> • Payment collection, receipts and reconciliation
> • E-signature with audit trail
> • SACCO share registers, contributions and governance
> • Role-based dashboards for directors, finance, operations and agents
> • Reporting and analytics
>
> An Ararat account is required to sign in. Accounts are set up at
> assetflow.smebusinessclinic.com.

That last line matters — it tells a reviewer why there is no signup button.

### Graphics

| Asset | Status |
| --- | --- |
| App icon 512×512 | `store-assets/playstore-icon-512.png` ✅ |
| Feature graphic 1024×500 | `store-assets/feature-graphic-1024x500.png` ✅ |
| Phone screenshots (min 2) | **You need to capture these.** |

For screenshots: open the live site in Chrome, press F12, toggle device mode
(Ctrl+Shift+M), pick a phone size like Pixel 7, sign in, and capture the
dashboard, a register, and the payments screen. Play wants at least two,
between 320px and 3840px on the long edge. Avoid real customer data.

---

## Why signup is hidden in the app

Google Play's Payments policy expects purchases of digital services made inside
an app to go through Google Play Billing. The registration wizard charges
M-Pesa for portal access, which is exactly the shape of transaction reviewers
look at.

Rather than integrate Play Billing and give up a cut, the app hides that path
entirely: customers register and pay on the web, and the app signs them in.
This is the ordinary pattern for B2B SaaS on Play.

In practice, inside the app:

- `/` (the pricing landing page) redirects to `/login`
- `/admin-registration` (the paid wizard) redirects to `/login`
- The "Register Your Company / Sacco" buttons on the login screen are gone

The web keeps all of it. The mechanism is `src/utils/androidApp.js` — worth
reading before changing any of those routes, since it explains why the check is
at runtime rather than a build flag, and why the flag lives in `sessionStorage`
and must never move to `localStorage`.

---

## Rebuilding later

Content and feature changes need **no Play release** — deploy the site and the
app picks them up on next launch.

You only need a new `.aab` when the app's own shell changes: name, icon,
package ID, start URL, or target API level. Re-run PWABuilder with the **same
package ID and the same keystore**, bump the version code, and upload.

Google raises the minimum target API level roughly annually and will eventually
refuse updates to an app targeting an old one. Console warns you well ahead;
that warning is your cue to re-package.

---

## Regenerating brand assets

```bash
node scripts/generate-icons.mjs         # PWA + Play icons, from public/icons/icon.svg
node scripts/generate-store-assets.mjs  # 1024x500 feature graphic
```

Both read the same source artwork, so editing `public/icons/icon.svg` and
re-running them keeps the launcher icon and the store listing in agreement.
