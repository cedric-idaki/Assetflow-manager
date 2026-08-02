# Ararat — User Manual

**Asset finance, sacco/chama management, and back-office operations on one platform.**

This manual is written for the people who use Ararat day to day: system owners, company
administrators, back-office staff, sales agents, clients, sacco administrators and sacco
members. It describes what each screen does and how to complete the common tasks.

Currency throughout is Kenya Shillings (KES). Dates display as `DD Mon YYYY`.

---

## Table of contents

1. [What Ararat is](#1-what-ararat-is)
2. [Roles and access](#2-roles-and-access)
3. [Getting started](#3-getting-started)
4. [Finding your way around](#4-finding-your-way-around)
5. [Super Admin](#5-super-admin)
6. [Company Admin](#6-company-admin)
7. [Back-office staff](#7-back-office-staff)
8. [Sales Agent Portal](#8-sales-agent-portal)
9. [Client Portal](#9-client-portal)
10. [Sacco / Chama Admin](#10-sacco--chama-admin)
11. [Sacco Member Portal](#11-sacco-member-portal)
12. [Shared modules](#12-shared-modules)
13. [Integrations](#13-integrations)
14. [Subscriptions and billing](#14-subscriptions-and-billing)
15. [Reference tables](#15-reference-tables)
16. [Troubleshooting](#16-troubleshooting)
17. [Glossary](#17-glossary)

---

## 1. What Ararat is

Ararat runs two related products from one login page:

**The company product** — for businesses that sell or finance assets (vehicles, property,
equipment, stock, anything). It covers the whole life of a sale: a sales agent finds a
lead, the client is registered and KYC-verified, an asset is sold at the POS on cash or
instalment terms, a contract is generated and e-signed, payments are collected and
allocated, and everything lands in the Finance Hub and the reports.

**The sacco / chama product** — for savings-and-credit societies and investment groups.
It covers members, contributions, loans with amortisation schedules, share capital and a
share marketplace, motions and elections, governance documents, and a fund-accounting
ledger with P&L, balance sheet and cash-flow statements.

Both products share the same back-office modules: E-Signature, HR, Finance Hub, Reports,
System Administration and the Sales Agent Portal.

Each company or sacco is a separate tenant. You only ever see your own organisation's
data. The Super Admin is the only role that sees across tenants.

---

## 2. Roles and access

| Role | Lands on after login | What it is |
|---|---|---|
| `super_admin` | `/choose-portal` | Platform owner. Sees every company and sacco. |
| `admin` | `/admin-dashboard` | Company administrator (the tenant owner). |
| `director` | `/role-based-dashboard` | Executive view of the company. |
| `manager` | `/role-based-dashboard` | Operational management. |
| `accountant` | `/role-based-dashboard` | Finance and ledger work. |
| `finance` | `/role-based-dashboard` | Finance staff. |
| `collections_officer` | `/role-based-dashboard` | Payments and arrears chasing. |
| `operations` | `/role-based-dashboard` | Day-to-day operations. |
| `hr` | `/hr-management` | Human resources only — no other module. |
| `sales_agent` / `sales` | `/sales-agent-portal` | Field/sales agent. |
| `client` | `/client-portal` | End customer with a portal login. |
| `sacco_admin` | `/sacco-dashboard` | Sacco or chama administrator. |
| `sacco_member` | `/sacco-member-portal` | Sacco member. |

### Who can open what

| Module | Roles |
|---|---|
| Super Admin Dashboard, Sacco Oversight, Subscription Billing, Choose Portal | `super_admin` |
| Admin Dashboard | `admin` |
| Sacco Dashboard | `sacco_admin`, `super_admin` |
| Sacco Member Portal | `sacco_member` |
| Sales Agent Portal | `sales_agent`, `sales` |
| Client Portal | `client` |
| Assets & Clients, Payments, KYC Management, Payment Confirmation | all internal staff roles |
| KYC Renewals | internal staff **except** `admin` |
| Reports & Analytics | all admin/staff roles |
| System Administration | `super_admin`, `admin`, `sacco_admin` |
| POS / New Sale | `super_admin`, `admin`, `manager`, `director`, `operations`, sales agents |
| E-Signature | every internal role (including `sacco_admin` and sales agents) |
| Finance Hub | `super_admin`, `admin`, `accountant`, `finance`, `director`, `manager`, `sacco_admin` |
| HR Management | `hr`, `admin`, `super_admin`, `sacco_admin` |
| My Profile | any signed-in user |

If you open a URL your role is not allowed to use, Ararat redirects you to your own
dashboard rather than showing an error.

---

## 3. Getting started

### 3.1 Registering an organisation

Go to **`/admin-registration`**. Step 1 asks whether you are registering a **Company** or a
**Sacco / Chama** — this choice changes the rest of the wizard.

The wizard runs in five steps:

1. **Your account** — full name, email, phone, gender, password (and confirmation).
2. **Organisation details**
   - *Company:* company name, business registration number, business type, location, county.
   - *Sacco:* sacco name, whether it is registered, registration/certificate number and
     SASRA licence number if it is, county and location.
3. **Plan** — enter how many **users** (company) or **members** (sacco) you have. The tier
   is selected automatically from that number and the price is calculated for you. All
   tiers are shown for reference with the active one highlighted.
4. **Payment** — review the line items: monthly subscription (or sacco base fee + per-member
   fee) plus the one-time installation fee of KES 3,000.
5. **Confirm** — your admin account and organisation record are created.

See [§14 Subscriptions and billing](#14-subscriptions-and-billing) for the price tables.

### 3.2 Signing in

Go to **`/login`**, enter your email and password. Ararat sends you to the dashboard for
your role automatically.

- **Failed attempts are rate-limited.** After 5 failed attempts you must wait 15 minutes.
- **Sessions time out after 30 minutes of inactivity.** You will be signed out and must log
  in again.
- **First login on an account created for you** (staff, client, sacco member): you are
  forced to change the temporary password before you can use the system.

### 3.3 Forgotten password

On the login screen click **Forgot password**, enter your email and submit. A reset link
is emailed to you; it opens `/reset-password` where you set a new one.

### 3.4 Password rules

Every password — at registration, at reset, and at forced change — must have:

- at least 8 characters
- an uppercase letter
- a lowercase letter
- a number
- a symbol

The strength meter on the form shows which rules you have already met.

---

## 4. Finding your way around

**The left sidebar** is your main navigation and its contents depend on your role. Click
the chevron at the bottom to collapse it to icons; on a phone it slides in from the left
and closes when you pick an item. A red badge on a sidebar item means there are items
waiting for you (for example pending approvals on *Administration*).

**The bottom of the sidebar** shows your name and role, and holds **Sign Out**.

**Tabs** sit across the top of most module pages. On several pages the tab is stored in the
URL (`?tab=…`), so you can bookmark or share a link to a specific tab.

**The live dot** — many screens show a small pulsing dot labelled *Live*, *Connecting* or
*Offline*. Live means the page is receiving realtime updates from the database and will
refresh itself when someone else changes the data. If it reads Offline, use the **Refresh**
button next to it.

**Close buttons** — module pages have a *Close* button at the top right that returns you to
your role's home dashboard.

---

## 5. Super Admin

### 5.1 Choosing a portal

After login the Super Admin lands on **`/choose-portal`** and picks:

- **Company Portal** → `/super-admin-dashboard`
- **Saccos Portal** → `/sacco-oversight`

You can switch between them at any time from **My Profile**.

### 5.2 Super Admin Dashboard (`/super-admin-dashboard`)

| Tab | What you do there |
|---|---|
| **Overview** | Platform-wide KPIs, asset breakdown, sales targets. |
| **Sales Agents** | Create agents, set their plan (bronze/gold) and targets, review their performance. |
| **Contracts** | Every contract across the platform. |
| **KYC Review** | Approve or reject client KYC submissions. Badge shows how many are pending. |
| **Sales Reports** | Sales performance by agent, period and product. |
| **Settlements** | Early-settlement quotes and settlement letters. |
| **Reminders** | Payment reminder runs and their logs. |
| **Companies** | Every registered company with its analytics; export to CSV. |
| **M-Pesa** | Platform M-Pesa status and a live test payment (see §13.1). |
| **Audit Trail** | Every recorded action; the badge counts deletions. |

**Creating a staff user or an agent:** use the *Create Staff User* / *Create Agent* buttons
on the relevant tab. The account is created with a temporary password which the person
must change at first login.

### 5.3 Sacco Oversight (`/sacco-oversight`)

Two tabs:

- **Overview** — every registered sacco, their registration status and activity.
- **Sales Agents** — agents whose job is to register saccos. Agents created here register
  saccos rather than companies or clients.

### 5.4 Subscription Billing (`/subscription-billing`)

Pricing overview, the tier cards, a subscription calculator, and the list of company
subscriptions. Open a subscription to edit its seat count or status.

---

## 6. Company Admin

### 6.1 Admin Dashboard (`/admin-dashboard`)

| Tab | What you do there |
|---|---|
| **Overview** | Company KPIs at a glance. |
| **Clients** | Your client list; badge shows clients with pending KYC. |
| **Sales Agents** | Agents working for you. Agents created by a company admin register **clients**. |
| **Staff** | Your staff accounts. A `!` badge means you have used every seat on your plan — upgrade before adding more. |
| **Contracts** | Contracts generated from sales, and uploaded contracts. |
| **KYC Review** | Approve or reject your clients' KYC documents. |
| **Sales Reports** | Your sales performance. |
| **Settlements** | Settlement quotes and settlement letters for clients paying off early. |
| **Reminders** | Payment reminders sent to clients. |

### 6.2 The admin's sidebar

Dashboard · Assets & Clients · POS / New Sale · E-Signature · Payments · KYC Management ·
Reports · HR Management · Staff & System.

Note that **KYC Renewals** is deliberately not available to the company admin — renewals are
handled by internal staff roles.

---

## 7. Back-office staff

Staff roles (`director`, `manager`, `accountant`, `finance`, `collections_officer`,
`operations`) land on **`/role-based-dashboard`**, which renders a different dashboard for
each role — Director, Accountant, Collections, Staff or a general default — showing the
figures that role cares about.

Their sidebar is: Dashboard · Assets & Clients · Payments · KYC Management · Reports.

Finance-capable roles additionally reach the **Finance Hub** by URL, and every internal role
can reach **E-Signature**.

---

## 8. Sales Agent Portal

**`/sales-agent-portal`** — the agent's whole working day.

### 8.1 What an agent registers depends on who created them

| Created by | The agent registers |
|---|---|
| A company admin | **Clients** (with a portal login) |
| The Super Admin | **Companies** (with an admin portal account) |
| Sacco Oversight | **Saccos** (with a sacco admin account) |

The portal's buttons and wording change to match — *Create Client*, *Register Company* or
*Register Sacco*.

### 8.2 The lead pipeline

Register a lead with **Register Lead**: name, phone, email, asset interest, budget range,
source, priority and notes. Leads then move through pipeline stages — drag a lead card to a
new stage, or open it and use **Update Stage**.

Open a lead to:

- **Schedule a follow-up** — pick a date; you get an email reminder when it falls due.
- **Convert** — when the lead says yes, click *Convert to Client* / *Register as Company* /
  *Register as Sacco*. Their details are pre-filled. The lead is stamped as converted, moves
  to **My Clients**, and cannot be registered twice.

### 8.3 Follow-ups

The **Follow-ups** panel groups appointments into buckets (overdue, today, upcoming). For
each one you can **mark it done** with an outcome, **snooze** it to a new date, or **remove**
it. Completed follow-ups stay on the record.

### 8.4 Commission and wallet

- **Commission Dashboard** — what you have earned and against which targets.
- **Commission Wallet** — your balance and transactions; use **Request Withdrawal** to ask
  for a payout.
- **Sales Cost Tracker** — log expenses (fuel, airtime, meetings) against your activity.

### 8.5 Assist requests (bronze ↔ gold)

Bronze agents working in company mode can ask a **gold agent** to help onboard an admin:

1. Bronze agent opens **Assist**, picks a gold agent, names the admin and adds a note.
2. The gold agent sees the request in their **inbox** and accepts or declines with a reason.
3. When the gold agent finishes the onboarding they mark it complete and the assist fee is
   credited to their wallet.

Either side can cancel a request that has not been completed.

### 8.6 Exports

The **Export** button produces CSV for **leads**, **converted clients**, **expenses** or
**commissions**, for today / this week / this month / this year / a custom date range. The
file is named with your agent code and the period.

### 8.7 Activity trail

**Agent Activity Trail** and the **Activity Feed** record what you did and when — useful when
your manager reviews performance.

---

## 9. Client Portal

**`/client-portal`** — what your customers see. Every item in their sidebar is a tab on the
same page (`/client-portal?tab=…`).

| Tab | What the client does |
|---|---|
| **Overview** | Account summary — balances, next payment, KYC state. |
| **My Assets** | Assets they own or are financing. |
| **Browse Assets** | Browse what the company has on the market and send an enquiry. |
| **Payments** | Payment history and making a payment. |
| **KYC Documents** | Upload identity documents (see §12.3). |
| **Document Centre** | Contracts and issued documents, opened through secure signed links. |
| **Payment Schedule** | The instalment schedule with due dates and amounts. |
| **Settlement Quote** | Ask for a figure to settle the balance early. |
| **My Statement** | Download a statement of the account. |
| **Item Enquiry** | Ask about a specific item and track the response. |

A banner appears at the top until KYC is verified, linking straight to the KYC tab.

There is also an older summary screen at `/client-portal-dashboard` (My Assets, Instalment
Schedule, Payment History, Statements) with a KYC-renewal alert banner.

---

## 10. Sacco / Chama Admin

**`/sacco-dashboard`** — nine tabs, all of them stored in the URL as `?tab=…`.

| Tab | What you do there |
|---|---|
| **Overview** | Membership, savings, loan book and governance at a glance. |
| **Members** | Register and maintain members; each gets a member portal login. |
| **Contributions** | Record contributions by type and period; view each member's position. |
| **Loans** | Applications, approvals, disbursement and repayment. Schedules are produced by the amortisation engine, and a loan agreement PDF can be generated. |
| **Shares** | Share capital, transfers, the member marketplace and the share treasury (see §10.1). |
| **Voting** | Raise motions and record member votes. The badge counts open motions. |
| **Elections** | Run officials' elections end to end (see §10.2). The badge counts active elections plus candidates awaiting approval. |
| **Governance** | The document library — constitution, bylaws, policies, minutes, resolutions — with type, version and effective date. |
| **Contracts** | Sacco contracts, including loan agreements, at parity with the company contracts module. |

The sacco admin's sidebar also carries **E-Signature**, **Finance Hub**, **HR Management** and
**Staff & System** — the same back-office modules a company admin gets, with the sacco's own
data.

**Billing** for a sacco lives on **My Profile**, not on the dashboard.

### 10.1 Shares and the marketplace

The admin publishes a **daily market value**. Members then see the market value of their
holding and their ownership percentage, and can set their own asking price when listing
shares for sale. The **treasury** lets the sacco itself sell shares from, or buy shares back
into, its own pool on the same marketplace; share capital movements are posted to the
ledger. A trading report is available to the admin.

### 10.2 Elections

Elections run as a "polling station":

- The member register is **frozen** when the election opens.
- Candidates are nominated and approved.
- Final ballots are **anonymous**.
- Each voter gets a **receipt** they can verify afterwards.
- The election lifecycle is driven by the database, so stages cannot be skipped from the UI.

### 10.3 Sacco Finance Hub

Sacco admins opening **Finance Hub** get the fund-accounting ledger rather than the company
hub:

| Tab | Purpose |
|---|---|
| **Financial Statements** | Income & expenditure, balance sheet, cash flow. |
| **Trial Balance & Members** | Trial balance and per-member ledger positions. |
| **Journal** | Manual journal entries. |
| **Chart of Accounts** | The sacco's account structure. |
| **Period Close** | Close an accounting period. |
| **Chama Registers** | Merry-go-round cycles and the welfare claims register — only shown when those modules are switched on under Setup. |
| **Setup** | Turn modules (merry-go-round, welfare fund) on or off and configure the ledger. |

---

## 11. Sacco Member Portal

**`/sacco-member-portal`** — self-service for members.

| Tab | What the member sees |
|---|---|
| **Overview** | Savings, loans and share position at a glance. |
| **Contributions** | Their contribution history. |
| **Loans** | Their loans, schedules and balances; apply for a new one. |
| **Shares** | Holding, market value, ownership percentage; list shares for sale at their own price. |
| **Voting** | Open motions to vote on. Badge counts open motions. |
| **Elections** | Stand as a candidate and vote. Badge counts open elections. |
| **Contracts** | Their loan agreements and other contracts. |
| **Documents** | The sacco's governance documents. |
| **Statement** | Download a member statement. |
| **Profile** | Their own details. |

---

## 12. Shared modules

### 12.1 POS / New Sale (`/pos`)

A five-step wizard: **Client → Asset → Pricing → Payment → Review**.

**Step 1 — Client.** Search by name or account number. The client's KYC status is checked
here.

**Step 2 — Asset.** Pick the asset being sold.

**Step 3 — Pricing.** Choose the model:

| Model | Use it when |
|---|---|
| **Cash Sale (Full Payment)** | The client pays the whole amount now. |
| **Deposit + Monthly Instalments** | The common hire-purchase case. |
| **Deposit + Balloon Payment** | Small or zero monthly payments, one large final payment. |
| **Zero-Deposit Instalment** | Pre-approved clients only; the full value is financed. |
| **Lease-to-Own** | Periodic payments with ownership transferring at the end of the term. |

Set the selling price, any discount, the deposit, and the tenure (3, 6, 12, 18, 24, 36, 48
or 60 months). VAT is 16% where it applies. The instalment schedule is calculated and
previewed for you.

**Step 4 — Payment.** Method: M-Pesa, Cash, Bank Transfer, Card or Cheque. Capture the
M-Pesa or bank reference where relevant.

**Step 5 — Review**, then confirm. Ararat then:

- generates an **invoice number** and a **receipt number**;
- records the payment and the sale;
- creates the instalment plan and schedule for non-cash sales;
- writes the sale to the audit trail;
- shows a receipt you can **print** or **download as PDF**;
- queues a contract for e-signature.

**Approvals raised automatically from the POS:**

| Condition | Effect |
|---|---|
| Total above **KES 50,000** and you are not a manager-level role | A *large transaction* item goes to the approval queue with a reference number. |
| Discount above **10%** | A *commission/discount override* item goes to the approval queue. |

### 12.2 Assets & Clients (`/asset-client-management`)

Two halves of one screen.

**Assets** — register an asset with its type (property, vehicle, equipment, or the types
your organisation has configured), description, price, location, images and attributes.
Filter by type and by status (available, reserved, sold, active, inactive). Open an asset
card for full details and its cover-image carousel.

**Clients** — register a client, view their card and details, and **provision a portal
login**: Ararat shows the client's name, login email, temporary password and account number
so you can hand them over. The client must change the password at first login.

**Link Asset ↔ Client** — attach an asset to the client who bought or is financing it.

**Website Sync** — connect an external website or upload a CSV so listings flow into the
Assets tab automatically. See §13.2.

### 12.3 KYC Management (`/kyc-management-screen`)

The queue lists every client with a progress bar showing how many of the required documents
they have uploaded.

**Required documents:**

1. National ID — Front
2. National ID — Back
3. Passport Photo
4. KRA PIN Certificate
5. Proof of Residence

(*Business Registration* is available for corporate clients.)

**KYC statuses:** `incomplete` → `pending` → `under_review` → `verified`, or `rejected`.

Click **Review** on a client to open the document panel: view each document, approve it, or
reject it with a reason. Approving the last required document moves the client to
*verified*. Every decision is written to the audit log.

Supporting panels: the **Compliance Dashboard**, a **KRA PIN** panel, a **photo capture**
panel for taking the passport photo directly, and the **verification workflow** view.

> **KYC gates payments.** A client who is not `verified` shows a red *Payment Blocked* banner
> in the Payments hub and payments cannot be processed for them.

### 12.4 KYC Renewals (`/kyc-renewal-management-screen`)

For internal staff (not the company admin). Tabs:

| Tab | Purpose |
|---|---|
| **Re-Upload** | Renewal queue — clients whose documents have expired or are expiring. |
| **Messages** | Message the client about their renewal. |
| **Approval Queue** | Approve renewals, with a Summary view, **Auto-Rules** for automatic approval, and a **Flagged** queue. |
| **Notifications** | Notifications raised by the renewal process. |
| **Reminders** | Reminder send logs. |
| **AI Scoring** | Automated document-quality scoring to prioritise review. |

### 12.5 Payments & Collections (`/payment-collections-hub`)

| Tab | Purpose |
|---|---|
| **Payment Entry** | Record a payment. Select the method — M-Pesa (with STK push), card via Stripe, or manual entry for cash/bank/cheque. |
| **Allocation** | See how a payment was split across the account. |
| **Overdue** | Accounts in arrears; the tab label shows the count. |
| **History** | Every transaction; the tab label shows the count. |
| **Penalties** | Penalty calculation on late instalments. |
| **Recurring** | Recurring billing arrangements. |
| **Alerts** | Payment alerts raised by the system. |

**How a payment is allocated.** Money is applied in this order:

> **Penalty → Interest → Principal**

- **Exact payment** — the instalment is marked *paid*.
- **Overpayment** — the excess is credited to the client's **wallet**.
- **Underpayment** — the instalment is marked *partial*; penalties start after the grace
  period.
- **Early payment** — posted to the wallet and allocated when the instalment falls due.
- **Duplicate** — flagged for manual review rather than posted twice.

**Payment Confirmation (`/payment-confirmation-screen`)** shows the confirmation for a
completed payment: transaction details, the client and asset it relates to, the allocation
breakdown, and receipt actions (print/download).

### 12.6 E-Signature (`/e-signature`)

Open to every internal role. The left rail has seven sections.

| Section | Purpose |
|---|---|
| **Dashboard** | Totals: all documents, completed (with completion rate), awaiting signature, drafts. |
| **All Documents** | Every document and its state. |
| **Sign a Document** | Sign a document yourself, or run an in-person session. |
| **New Document** | Upload and send a document for signature. |
| **Templates** | Reusable documents you send repeatedly. |
| **Audit Trail** | Who did what, when, from which IP and device. |
| **API & Embed** | API keys, webhooks and the embedded-signing snippet. |

**Sending a document for signature**

1. **Upload** the file and add your signatories. Each needs a unique email; a phone number
   lets Ararat also send the link by SMS. Duplicate emails are rejected.
2. Choose the signing order:
   - **Sequential (A→B→C)** — only the first signer is invited; each following signer is
     invited automatically when the previous one finishes.
   - **Parallel** — everyone is invited at once.
3. **Place the fields** on the page for each signatory (signature, initials, date, text).
   Each signatory has their own colour.
4. **Send.** Signing links go out by email, and by SMS where a phone number exists. You are
   notified as each party signs.

**Signing**

External signers open a one-time tokenised link at `/sign/:token` — no login required. They
consent, fill their fields, and sign. Ararat magnifies the real page pixels so the signature
is drawn directly onto the document, and a saved signature can be reused with one tap.
Guided auto-scroll walks the signer to each field in turn.

Optional controls under **Settings**:

- Require a **PIN** before signing.
- Require **OTP confirmation** after signing (a 6-digit code).
- **Signature alert** — notify when a signature is used.

Signers may also **decline to sign**, with a reason.

**In-person (walk-in) signing** lets several signatories sign on the same device in one
session.

**When everything is signed** the document is sealed: a per-page signing footer and a
certificate appendix are added, and a SHA-256 hash of the sealed PDF is stored. Sealed files
cannot be deleted from storage.

**Reminders** go out automatically to signatories who have not yet signed.

**Embedding** — `/embed/sign/:token` is the chrome-less version for putting the signing
experience inside your own web app in an iframe; it emits lifecycle events to the parent
page.

### 12.7 Finance Hub (`/finance-hub`)

Company view — six tabs. (Sacco admins get the sacco ledger instead; see §10.3.)

| Tab | Purpose |
|---|---|
| **Invoices** | Company invoices; the badge counts pending ones. |
| **Auto Journal Feed** | Entries the system posted automatically from sales, payments and payroll, each tagged with the event that triggered it. |
| **Journal Entries** | Manual journal entries. Multi-line entries are supported, and any entry can be reversed. Only **posted** entries count towards the statements. |
| **Chart of Accounts** | Your account structure. |
| **Payroll** | Run payroll, the PAYE calculator, and payroll history. The badge counts pending runs. |
| **Financial Statements** | P&L, Balance Sheet, Cash Flow, Trial Balance and the VAT report. |

**Payroll** — *Run Payroll* previews basic salary, housing and transport allowances against
statutory deductions: **PAYE**, **NSSF (Tier I & II)**, **SHA at 2.75%** and **Housing Levy at
1.5%**. The **PAYE Calculator** does the same maths for a single gross figure without
committing a run. **Payroll History** holds past runs.

**Financial Statements** — the P&L shows revenue, expenses, net profit, gross margin and
interest and penalty income. The Balance Sheet view adds ratios: current ratio,
debt-to-equity, return on equity, asset turnover and net profit margin. Cash Flow splits
into operating, investing and financing. The VAT tab tracks filing deadlines (VAT due the
20th, PAYE the 9th, NSSF the 15th).

### 12.8 HR Management (`/hr-management`)

For `hr`, `admin`, `super_admin` and `sacco_admin`. Three tabs:

- **Employee Records** — add and maintain employees: role, department, employment type,
  gross package, leave balance (default 21 days), status, KRA PIN, NSSF number, national ID
  and date joined.
- **Documents** — employee documents.
- **Payroll** — payroll from the HR side.

The `hr` role sees only this module — nothing else appears in their sidebar.

### 12.9 Reports & Analytics (`/reports-analytics-center`)

Executive dashboards and exports over your assets, payments, agents, clients, employees and
payroll. Available reports:

| Report | Covers |
|---|---|
| VAT Report | VAT position |
| Cash Flow | Money in and out |
| Inventory Movement | Asset stock movement |
| Client Portfolio | Clients and their exposure |
| Commission Report | Agent commissions |
| Daily Collections | What was collected today |
| Instalment Adherence | Who is paying on schedule |
| Aging Analysis | Arrears by age bucket |
| Payroll Summary | Payroll totals |
| HR Report | Headcount and employee data |

Charts include collection performance, sales conversion, aging analysis and KYC metrics.
Use the **Filter** panel to narrow the period, **Export** to download, and **Schedule Report**
to have a report generated and sent on a recurring basis.

### 12.10 System Administration (`/system-administration`)

For `super_admin`, `admin` and `sacco_admin`.

| Tab | Purpose |
|---|---|
| **User Management** | Create, edit, deactivate and delete staff accounts. New users get a temporary password and must change it at first login. |
| **Roles & Permissions** | *Super Admin only.* What each role may do. |
| **Approval Queue** | Maker-checker. The count of pending items also appears as the sidebar badge. |
| **Audit Trail** | Every recorded action, filterable. |

**Maker-checker (the Approval Queue)** — actions above a threshold are queued for a second
person to approve rather than taking effect immediately.

Action types: payment split change · debt adjustment · commission override · role change ·
high-value transaction · KYC approval · user creation · asset deletion · payment refund ·
system config.

Sub-tabs: **Pending Queue**, **Approval History**, **Thresholds** (set the value at which each
action type needs approval).

Filter the queue by action type and priority (critical / high / medium / low), search it,
and act on items one at a time or in bulk — bulk actions require a comment. Items resolve to
*approved*, *rejected*, *escalated* or *expired*. The queue updates live as colleagues act
on it.

### 12.11 My Profile (`/profile`)

Any signed-in user. Shows your details and lets you change your password (against the same
rules as §3.4).

For an **admin** it also shows the subscription: user seats, monthly cost, status and days
until renewal, with plan management, invoices and payment. For a **sacco admin** the sacco
billing section appears here. For the **Super Admin** it holds the portal switcher between
the Company Portal and the Saccos Portal.

---

## 13. Integrations

### 13.1 M-Pesa

Three separate flows:

1. **Platform subscription** — companies and saccos paying Ararat.
2. **Per-tenant collection** — your clients paying you.
3. **Agent payout (B2C)** — commission withdrawals to agents.

**Collecting by M-Pesa:** in the Payments hub choose M-Pesa, enter the client's phone number
and the amount, and send. The client receives an STK push prompt on their handset and enters
their PIN. Ararat polls for the result (up to about 3 minutes) and confirms or fails the
payment.

**Super Admin → M-Pesa tab** reports whether each credential is present and whether
Safaricom accepts them, and runs a live test payment. Credentials are **not editable in the
browser** — the consumer key, secret, shortcode and passkey are held as server-side secrets
and never reach the database or the browser.

> The M-Pesa integration runs against the Safaricom **sandbox** until Go-Live is completed
> with Safaricom.

### 13.2 Website / CSV asset ingest

Open **Assets & Clients → Website Sync**. You get an endpoint and a per-organisation API key.
Your website (or any system) posts asset records to it, or you upload a CSV.

Each record carries an `external_ref` (your SKU), a name, type, price, location, image URLs,
a link back to the listing, and a free-form `attributes` object — so a car can send mileage
and fuel while a house sends bedrooms and size. Records are matched on `external_ref` so
re-sending an item updates it rather than duplicating it.

Assets arrive in the Assets tab ready to sell.

### 13.3 E-Signature API and embedding

The **API & Embed** tab in E-Signature issues API keys, configures webhooks, and gives you
the iframe snippet for embedded signing. Documents can be created and sent programmatically,
and your application is notified by webhook as signers act.

### 13.4 Email and SMS

Ararat sends transactional email (signing invitations, credentials, reminders, follow-up
alerts, KYC notices) and SMS where a phone number is on file. Signing invitations go out by
both channels, with email as the fallback.

---

## 14. Subscriptions and billing

A one-time **installation fee of KES 3,000** applies at first registration only. It is never
charged again on renewal or upgrade.

### 14.1 Company plans (per user, per month)

| Plan | Users | Price / user / month | Free storage |
|---|---|---|---|
| **Silver** | 1–5 | KES 305 | 5 GB |
| **Bronze** *(most popular)* | 6–16 | KES 360 | 10 GB |
| **Gold** | 17+ | KES 267 | 15 GB |

Your monthly cost is `users × price per user`. The plan is chosen automatically from the
number of users you enter — you do not pick it manually.

Silver includes asset management, the client portal and basic reporting. Bronze adds the
sales agent portal, KYC management and advanced reporting. Gold adds full reporting,
priority support and custom contracts.

### 14.2 Sacco / chama tiers (base fee + per member, per month)

| Tier | Members | Base fee / month | Per active member / month | Free storage |
|---|---|---|---|---|
| **Bronze** | 5–50 | KES 500 | KES 44 | 5 GB |
| **Silver** *(most popular)* | 51–110 | KES 700 | KES 36 | 10 GB |
| **Gold** | 111+ | KES 900 | KES 27 | 15 GB |

Monthly cost is `base fee + (members × per-member fee)`. Storage above the free quota is
billed at **KES 10 per additional GB per month**.

### 14.3 Managing your subscription

- **Admins** — *My Profile* shows seats, monthly cost, status and days to renewal, with plan
  changes, invoices and payment.
- **Sacco admins** — the billing section on *My Profile*.
- **Super Admin** — `/subscription-billing` for every company, with the calculator and the
  ability to edit a subscription.

Running out of seats shows a `!` badge on the **Staff** tab; upgrade the plan before adding
more staff.

---

## 15. Reference tables

### 15.1 Statuses

**Asset:** available · reserved · sold · active · inactive

**KYC (client):** incomplete · pending · under_review · verified · rejected

**KYC document:** pending · approved · active · rejected

**Approval queue item:** pending · approved · rejected · escalated · expired

**Approval priority:** critical · high · medium · low

**Instalment:** paid · partial · pending · overdue

**Lead stage:** moves through the pipeline to `closed`; a closed lead that has been converted
is stamped with the account type created and the date.

### 15.2 Payment methods

M-Pesa · Cash · Bank Transfer · Card · Cheque

### 15.3 Thresholds that trigger an approval

| Trigger | Threshold |
|---|---|
| Large transaction at POS (non-manager roles) | above KES 50,000 |
| Discount at POS | above 10% |
| Everything else | configured under System Administration → Approval Queue → Thresholds |

### 15.4 Statutory payroll rates

PAYE (banded) · NSSF Tier I & II · SHA 2.75% · Housing Levy 1.5% · VAT 16%

### 15.5 Filing deadlines shown in the VAT tab

VAT return — 20th · PAYE return — 9th · NSSF contribution — 15th

---

## 16. Troubleshooting

**I was redirected away from a page.**
Your role is not permitted to open it. Ararat sends you to your own dashboard instead of
showing an error. Ask an administrator if you need the access.

**"Too many login attempts."**
Five failures in fifteen minutes locks you out for the remainder of the window. Wait it out,
or use *Forgot password*.

**I was signed out while working.**
Sessions end after 30 minutes without activity. Sign in again.

**I cannot record a payment — a red banner says *Payment Blocked*.**
The client's KYC is not verified. Complete or approve it in KYC Management first.

**The Staff tab shows a `!` badge and I cannot add a user.**
Every seat on your plan is in use. Upgrade the plan under *My Profile* (or ask the Super
Admin), then add the user.

**A live indicator shows *Offline* and figures look stale.**
The realtime connection dropped. Use the **Refresh** button next to the indicator.

**A signer says they never received their link.**
Check the signatory's email address on the document, then use the audit trail to confirm the
invitation was sent. Reminders also go out automatically. In sequential order, a signer is
only invited once the previous signer has finished — check whether it is actually their turn.

**An M-Pesa payment does not confirm.**
The client has about three minutes to enter their PIN. If it times out, the payment fails and
can be retried. Confirm the phone number is correct and in a valid Kenyan format.

**My sacco dashboard says "No sacco record found yet."**
The sacco profile has not been created yet or the schema migration has not been applied.
Contact your administrator.

**A journal entry does not appear in the financial statements.**
Only entries with status **posted** count. Draft entries are excluded everywhere.

**A lead I converted still shows "Register client".**
It only shows the register button while `converted_at` is empty. Once the account exists the
card shows the conversion date instead, so the same lead cannot be registered twice.

---

## 17. Glossary

**Admin ID** — the tenant key. Every record belongs to one organisation through it, which is
what keeps your data separate from every other company's.

**Assist request** — a bronze agent asking a gold agent to onboard an admin on their behalf,
for a fee credited on completion.

**Balloon payment** — a large final payment at the end of a financing term, with small or
zero monthly payments before it.

**Chama** — an informal savings and investment group; supported alongside formal saccos.

**Client wallet** — a credit balance held for a client from overpayments and early payments,
applied to instalments as they fall due.

**Gold / bronze agent** — the agent's plan level. Gold agents receive assist requests and
onboard admins.

**KYC** — Know Your Customer; the identity documents a client must supply before they can
transact.

**Maker-checker** — the control where the person who initiates an action (the maker) is not
the person who approves it (the checker).

**Merry-go-round** — a rotating-savings cycle where members contribute each round and one
member receives the pot; produces a cycle register instead of an income statement.

**POS** — the point-of-sale wizard used to complete a sale.

**SASRA** — the Sacco Societies Regulatory Authority; its licence number is captured for
registered saccos.

**Sealed document** — a completed e-signed PDF with the signing footer, certificate appendix
and a stored SHA-256 hash. It cannot be deleted.

**Sequential / parallel signing** — whether signatories are invited one after another or all
at once.

**Share treasury** — the sacco's own pool of shares, which it can sell from or buy back into
on the member marketplace.

**STK push** — the prompt that appears on a customer's phone asking them to enter their
M-Pesa PIN to authorise a payment.

**Tenant** — one company or one sacco, with its own isolated data.

**Welfare fund** — a sacco fund that pays bereavement, medical or education claims, with its
own claims register.
