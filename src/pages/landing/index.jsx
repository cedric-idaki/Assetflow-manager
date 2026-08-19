import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';

// ── Landing page ────────────────────────────────────────────────────────
// Layout/structure follows the marketing design brief (ledger + receipt
// motif). Colors are the system brand palette from tailwind.css so the page
// matches the rest of the product:
//   ink #0c2037 (brand-dark) · accent #34c1dd (brand-accent) · paper #f5f8fa
// --accent-deep is a darkened brand cyan used only where the accent has to
// carry small text on a light background (the brand cyan itself fails
// contrast at body sizes). --mark is the system error red (#b91c1c), used
// only for the "crossed out / stamped" marks.
//
// Styles live in a scoped stylesheet rather than inline styles because the
// design needs pseudo-elements, media queries and hover states.

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,500;9..144,600;9..144,700&family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.arr{
  --ink:#0c2037;
  --ink-2:#112844;
  --ink-3:#1a3a5c;
  --paper:#f5f8fa;
  --paper-2:#eaf1f5;
  --paper-3:#dbe6ee;
  --card:#ffffff;
  --accent:#34c1dd;
  --accent-dark:#20a8c5;
  --accent-deep:#12758c;
  --mark:#b91c1c;
  --success:#0b7a4e;
  --text:#0c2037;
  --text-muted:#5a7185;
  --text-on-ink:#ffffff;
  --text-on-ink-muted:rgba(255,255,255,0.66);
  --line:#d0dce6;
  --line-on-ink:rgba(255,255,255,0.16);

  background:var(--paper);
  color:var(--text);
  font-family:'Space Grotesk',sans-serif;
  line-height:1.5;
  -webkit-font-smoothing:antialiased;
  min-height:100vh;
}
.arr *{margin:0;padding:0;box-sizing:border-box;}
.arr img,.arr svg{display:block;max-width:100%;}
.arr a{color:inherit;text-decoration:none;}
.arr .mono{font-family:'IBM Plex Mono',monospace;}
.arr ::selection{background:var(--accent);color:var(--ink);}
.arr section[id]{scroll-margin-top:80px;}

@media (prefers-reduced-motion: reduce){
  .arr *{animation-duration:0.001ms !important;animation-iteration-count:1 !important;transition-duration:0.001ms !important;}
}

.arr .wrap{max-width:1180px;margin:0 auto;padding:0 32px;}
@media (max-width:640px){.arr .wrap{padding:0 20px;}}

/* ---------- NAV ---------- */
.arr .site-nav{
  position:sticky;top:0;z-index:50;
  background:rgba(245,248,250,0.9);
  backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line);
}
.arr .nav-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 32px;max-width:1180px;margin:0 auto;}
@media (max-width:640px){.arr .nav-inner{padding:14px 20px;}}
.arr .brand{display:flex;align-items:center;gap:10px;font-family:'Fraunces',serif;font-weight:600;font-size:22px;letter-spacing:-0.01em;color:var(--accent-deep);}
.arr .brand-mark{width:32px;height:32px;flex-shrink:0;border-radius:8px;background:var(--ink);display:flex;align-items:center;justify-content:center;}
.arr .nav-actions{display:flex;align-items:center;gap:8px;}
.arr .nav-link-btn{background:none;border:none;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:14px;color:var(--text-muted);padding:8px 12px;transition:color 0.2s ease;}
.arr .nav-link-btn:hover{color:var(--accent-deep);}
.arr .nav-cta{
  background:var(--ink);color:var(--paper);
  padding:11px 22px;border-radius:3px;
  font-family:'Space Grotesk',sans-serif;
  font-size:14px;font-weight:600;letter-spacing:0.01em;
  border:1px solid var(--ink);cursor:pointer;
  transition:background 0.2s ease,border-color 0.2s ease;
}
.arr .nav-cta:hover{background:var(--ink-3);border-color:var(--ink-3);}
@media (max-width:900px){.arr .nav-link-btn{padding:8px 6px;font-size:13px;}}
@media (max-width:720px){.arr .nav-link-btn{display:none;}}

/* ---------- HERO ---------- */
.arr .hero{
  position:relative;padding:80px 0 96px;overflow:hidden;
  background:radial-gradient(1100px 480px at 82% -10%, rgba(52,193,221,0.14), transparent 60%),var(--paper);
}
.arr .hero-grid{display:grid;grid-template-columns:1.05fr 0.75fr;gap:56px;align-items:start;}
@media (max-width:920px){.arr .hero-grid{grid-template-columns:1fr;gap:64px;}}

.arr .ledger-tab{
  display:inline-flex;align-items:center;gap:8px;
  font-family:'IBM Plex Mono',monospace;font-size:12.5px;letter-spacing:0.06em;text-transform:uppercase;
  color:var(--accent-deep);background:var(--paper-2);
  border:1px solid var(--line);padding:7px 12px 7px 10px;border-radius:2px;margin-bottom:26px;
}
.arr .ledger-tab .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);}

.arr .hero-headline{
  font-family:'Fraunces',serif;font-weight:600;
  font-size:clamp(36px,5.4vw,66px);line-height:1.05;letter-spacing:-0.015em;
  color:var(--ink);max-width:15ch;
}
.arr .hero-headline .accent{color:var(--accent-deep);font-style:italic;font-weight:500;}
.arr .hero-headline .strike-wrap{position:relative;white-space:nowrap;display:inline-block;}
.arr .hero-headline .strike-wrap svg{position:absolute;left:-2%;top:38%;width:104%;height:auto;overflow:visible;}

.arr .hero-sub{margin-top:24px;font-size:17px;color:var(--text-muted);max-width:46ch;line-height:1.65;}

.arr .ledger-lines{margin-top:28px;display:flex;flex-direction:column;border-top:1px solid var(--line);max-width:44ch;}
.arr .ledger-lines .row{display:flex;align-items:baseline;gap:14px;padding:13px 0;border-bottom:1px solid var(--line);}
.arr .ledger-lines .row .check{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--accent-deep);flex-shrink:0;}
.arr .ledger-lines .row .txt{font-size:15.5px;color:var(--text);}
.arr .ledger-lines .row .txt b{font-weight:600;}

.arr .ctas{display:flex;gap:14px;margin-top:34px;flex-wrap:wrap;}
.arr .btn{
  display:inline-flex;align-items:center;gap:8px;
  padding:14px 26px;border-radius:3px;
  font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;
  border:1px solid transparent;cursor:pointer;
  transition:transform 0.15s ease,background 0.15s ease,color 0.15s ease,border-color 0.15s ease;
}
.arr .btn-primary{background:var(--accent);color:var(--ink);}
.arr .btn-primary:hover{background:var(--ink);color:var(--paper);transform:translateY(-1px);}
.arr .hero-link{
  display:inline-flex;align-items:center;gap:7px;margin-top:22px;
  font-family:'Space Grotesk',sans-serif;font-size:14.5px;font-weight:600;
  color:var(--accent-deep);text-decoration:none;
  border-bottom:1px solid rgba(18,117,140,0.35);padding-bottom:2px;
  transition:color 0.2s ease,border-color 0.2s ease;
}
.arr .hero-link:hover{color:var(--ink);border-color:var(--ink);}
.arr .btn-ghost{background:transparent;color:var(--ink);border-color:var(--ink);}
.arr .btn-ghost:hover{background:var(--ink);color:var(--paper);}

/* Receipt + stamp */
.arr .hero-visual{position:relative;padding-top:6px;}
.arr .receipt{
  background:var(--card);border:1px solid var(--line);border-radius:4px;
  padding:26px 26px 22px;
  box-shadow:0 30px 60px -30px rgba(12,32,55,0.45);
  position:relative;transform:rotate(1.4deg);
}
.arr .receipt::before{
  content:"";position:absolute;inset:0;
  background-image:repeating-linear-gradient(to bottom,transparent 0 27px,var(--line) 27px 28px);
  opacity:0.45;pointer-events:none;margin:70px 24px 20px;
}
.arr .receipt-head{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:1px dashed var(--line);position:relative;z-index:1;}
.arr .receipt-head .rtitle{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);}
.arr .receipt-head .rid{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text-muted);margin-top:4px;}
.arr .receipt-row{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:11px 0;position:relative;z-index:1;font-size:14.5px;}
.arr .receipt-row .val{font-family:'IBM Plex Mono',monospace;color:var(--accent-deep);font-weight:500;white-space:nowrap;}
.arr .receipt-total{display:flex;justify-content:space-between;margin-top:8px;padding-top:14px;border-top:1px solid var(--ink);position:relative;z-index:1;}
.arr .receipt-total .label{font-weight:600;}
.arr .receipt-total .val{font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:17px;color:var(--ink);}

.arr .stamp{position:absolute;top:-22px;right:-26px;width:128px;height:128px;transform:rotate(-11deg);z-index:3;}
.arr .stamp svg{width:100%;height:100%;}
@media (max-width:920px){.arr .stamp{right:6px;top:-18px;width:104px;height:104px;}}
@media (max-width:640px){.arr .receipt{transform:rotate(0.6deg);}}

/* ---------- THE OLD WAY ---------- */
.arr .transition{background:var(--ink);color:var(--text-on-ink);padding:92px 0;position:relative;overflow:hidden;}
.arr .transition::after{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(700px 320px at 12% 110%, rgba(52,193,221,0.14), transparent 60%);
}
.arr .transition > .wrap{position:relative;z-index:1;}
.arr .t-head{max-width:640px;}
.arr .t-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:12.5px;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);}
.arr .t-title{font-family:'Fraunces',serif;font-weight:500;font-size:clamp(26px,3.2vw,38px);line-height:1.22;margin-top:16px;color:var(--text-on-ink);}
.arr .t-title em{font-style:italic;color:var(--accent);}

.arr .rejected-strip{margin-top:48px;display:flex;flex-wrap:wrap;gap:14px;}
.arr .rejected-chip{
  position:relative;font-family:'IBM Plex Mono',monospace;font-size:14px;
  color:var(--text-on-ink-muted);border:1px solid var(--line-on-ink);
  padding:12px 18px;border-radius:2px;overflow:hidden;
}
.arr .rejected-chip::after{
  content:"";position:absolute;left:6%;right:6%;top:50%;height:1px;
  background:var(--mark);transform:translateY(-50%) rotate(-3deg);
}
.arr .arrow-down{
  display:flex;align-items:center;gap:12px;margin-top:42px;
  font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:var(--accent);
}
.arr .t-result{
  margin-top:20px;font-family:'Fraunces',serif;font-style:italic;font-weight:500;
  font-size:clamp(22px,2.6vw,30px);color:var(--text-on-ink);max-width:700px;line-height:1.3;
}

/* ---------- MODULES ---------- */
.arr .features{padding:100px 0 92px;}
.arr .section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;margin-bottom:52px;}
.arr .section-head .stitle{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(28px,3.6vw,42px);letter-spacing:-0.01em;color:var(--ink);max-width:16ch;line-height:1.12;}
.arr .section-head .sdesc{font-size:15.5px;color:var(--text-muted);max-width:38ch;line-height:1.65;}
.arr .eyebrow{font-family:'IBM Plex Mono',monospace;font-size:12.5px;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent-deep);display:block;margin-bottom:14px;}

.arr .ledger-table{border-top:1px solid var(--line);}
.arr .ledger-item{
  display:grid;grid-template-columns:64px 1fr 40px;align-items:center;gap:20px;
  padding:24px 4px;border-bottom:1px solid var(--line);transition:background 0.2s ease;
}
.arr .ledger-item:hover{background:var(--paper-2);}
.arr .ledger-item .no{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--text-muted);}
.arr .ledger-item .body{display:flex;align-items:center;gap:18px;}
.arr .ledger-item .icon{
  width:44px;height:44px;flex-shrink:0;border-radius:3px;
  background:rgba(52,193,221,0.12);
  display:flex;align-items:center;justify-content:center;
}
.arr .ledger-item .name{font-weight:600;font-size:16.5px;color:var(--ink);}
.arr .ledger-item .desc{font-size:14px;color:var(--text-muted);margin-top:3px;}
.arr .ledger-item .stampcheck{justify-self:end;color:var(--accent-deep);opacity:0.85;}
@media (max-width:640px){
  .arr .ledger-item{grid-template-columns:30px 1fr 26px;gap:12px;padding:20px 2px;}
  .arr .ledger-item .body{gap:12px;}
  .arr .ledger-item .icon{width:38px;height:38px;}
}

/* ---------- AUDIENCE ---------- */
.arr .audience{background:var(--paper-2);padding:92px 0;}
.arr .aud-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:44px;}
@media (max-width:920px){.arr .aud-grid{grid-template-columns:repeat(2,1fr);}}
@media (max-width:520px){.arr .aud-grid{grid-template-columns:1fr;}}
.arr .aud-card{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:26px 20px;}
.arr .aud-card .tag{font-family:'IBM Plex Mono',monospace;font-size:11.5px;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);}
.arr .aud-card .label{font-family:'Fraunces',serif;font-weight:600;font-size:20px;margin-top:10px;color:var(--ink);}

/* ---------- SUBSCRIBE ---------- */
.arr .subscribe{padding:92px 0;background:var(--paper);}
.arr .sub-card{
  background:var(--paper-2);border:1px solid var(--line);border-radius:6px;
  padding:56px;position:relative;overflow:hidden;
  display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center;
}
.arr .sub-card::before{
  content:"";position:absolute;top:0;left:0;right:0;height:6px;
  background:repeating-linear-gradient(90deg,var(--accent) 0 14px,transparent 14px 22px);
}
@media (max-width:820px){.arr .sub-card{grid-template-columns:1fr;padding:36px 24px;}}
.arr .sub-left .stitle{margin-bottom:12px;font-family:'Fraunces',serif;font-weight:600;color:var(--ink);font-size:clamp(24px,3vw,34px);line-height:1.15;}
.arr .sub-left .sdesc{font-size:15.5px;color:var(--text-muted);max-width:44ch;line-height:1.65;}

.arr .sub-toggle{display:flex;gap:8px;margin-bottom:12px;}
.arr .sub-toggle button{
  flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;
  background:var(--card);border:1px solid var(--line);border-radius:3px;
  padding:11px 10px;cursor:pointer;
  font-family:'Space Grotesk',sans-serif;font-size:13.5px;font-weight:600;
  color:var(--text-muted);transition:background 0.2s ease,color 0.2s ease,border-color 0.2s ease;
}
.arr .sub-toggle button:hover{border-color:var(--accent);color:var(--accent-deep);}
.arr .sub-toggle button.on{background:var(--ink);border-color:var(--ink);color:var(--paper);}
.arr .sub-field{display:flex;background:var(--card);border:1px solid var(--line);border-radius:3px;overflow:hidden;}
.arr .sub-field input{
  flex:1;border:none;background:transparent;padding:16px 18px;
  font-family:'Space Grotesk',sans-serif;font-size:15px;color:var(--text);outline:none;min-width:0;
}
.arr .sub-field input::placeholder{color:var(--text-muted);}
.arr .sub-field:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(52,193,221,0.2);}
.arr .sub-field button{
  border:none;cursor:pointer;background:var(--ink);color:var(--paper);
  font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:13px;
  letter-spacing:0.04em;text-transform:uppercase;padding:0 22px;white-space:nowrap;
  transition:background 0.2s ease,color 0.2s ease;
}
.arr .sub-field button:hover{background:var(--accent);color:var(--ink);}
@media (max-width:460px){
  .arr .sub-field{flex-direction:column;}
  .arr .sub-field button{padding:14px;}
}
.arr .sub-note{margin-top:12px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:8px;}
.arr .sub-error{margin-top:12px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:var(--mark);}

/* ---------- CLOSING ---------- */
.arr .closing{
  background:linear-gradient(135deg,var(--ink) 0%,var(--ink-2) 55%,var(--ink-3) 100%);
  color:var(--text-on-ink);padding:104px 0;text-align:center;position:relative;overflow:hidden;
}
.arr .closing::before{
  content:"";position:absolute;inset:0;
  background:radial-gradient(900px 400px at 50% 0%, rgba(52,193,221,0.16), transparent 60%);
}
.arr .closing-inner{position:relative;z-index:1;max-width:700px;margin:0 auto;}
.arr .closing .ctitle{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(30px,4.2vw,48px);line-height:1.12;letter-spacing:-0.01em;}
.arr .closing .csub{margin-top:18px;font-size:16.5px;color:var(--text-on-ink-muted);line-height:1.65;}
.arr .closing .ctas{justify-content:center;}
.arr .closing .btn-primary:hover{background:var(--paper);color:var(--ink);}
.arr .closing .btn-ghost{border-color:rgba(255,255,255,0.5);color:var(--paper);}
.arr .closing .btn-ghost:hover{background:var(--paper);color:var(--ink);}

/* ---------- FOOTER ---------- */
.arr footer{background:var(--ink);color:var(--text-on-ink-muted);padding:56px 0 40px;font-size:13.5px;border-top:3px solid var(--accent);}
.arr .foot-inner{display:grid;grid-template-columns:1.15fr 1fr;gap:56px;align-items:start;}
@media (max-width:760px){.arr .foot-inner{grid-template-columns:1fr;gap:40px;}}
.arr .foot-inner .fbrand{font-family:'Fraunces',serif;color:var(--accent-deep);font-weight:700;font-size:20px;letter-spacing:0.01em;}
.arr .foot-tagline{margin-top:12px;line-height:1.7;max-width:38ch;}

.arr .foot-heading{
  font-family:'Space Grotesk',sans-serif;font-weight:600;
  font-size:19px;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-on-ink);
}
.arr .foot-rule{position:relative;margin-top:14px;height:1px;background:var(--line-on-ink);}
.arr .foot-rule::before{content:"";position:absolute;left:0;top:-1px;width:48px;height:3px;background:var(--accent);}

.arr .foot-contacts{list-style:none;margin-top:26px;display:flex;flex-direction:column;gap:18px;}
.arr .foot-contacts li{display:flex;align-items:flex-start;gap:14px;font-size:14.5px;line-height:1.6;}
.arr .foot-contacts .ficon{flex-shrink:0;margin-top:3px;opacity:0.9;}
.arr .foot-contacts a{transition:color 0.2s ease;}
.arr .foot-contacts a:hover{color:var(--accent);}

/* ---------- REVEAL ---------- */
.arr .reveal{opacity:0;transform:translateY(16px);transition:opacity 0.7s ease,transform 0.7s ease;}
.arr .reveal.in{opacity:1;transform:translateY(0);}
@media (prefers-reduced-motion: reduce){
  .arr .reveal{opacity:1;transform:none;}
}
`;

const MODULES = [
  { icon: 'Calculator',     name: 'Point of Sale (POS)',                     desc: 'Sell at the counter and reconcile automatically.' },
  { icon: 'Package',        name: 'Inventory Management',                    desc: 'Track stock levels and movement in real time.' },
  { icon: 'CalendarClock',  name: 'Hire Purchase Management',                desc: 'Track installment plans from sale to final payment.' },
  { icon: 'Users',          name: 'Member & Client Management',              desc: 'One record per person — no duplicate WhatsApp threads.' },
  { icon: 'Vote',           name: 'Digital Voting',                          desc: 'Run AGM and committee votes members can trust.' },
  { icon: 'BadgeCheck',     name: 'Loan Approval / Disbursement',            desc: 'Move applications from request to release, with a clear trail.' },
  { icon: 'TrendingUp',     name: 'Loan Amortization Reports',               desc: 'See every repayment schedule, principal, and interest split.' },
  { icon: 'BookOpen',       name: 'Financial Accounting',                    desc: 'Books that stay balanced without a month-end scramble.' },
  { icon: 'Wallet',         name: 'Payroll Management',                      desc: 'Pay staff correctly and on time, every cycle.' },
  { icon: 'PiggyBank',      name: 'Contribution Tracking',                   desc: "Know exactly who has paid in, and who hasn't." },
  { icon: 'Smartphone',     name: 'M-Pesa Collections',                      desc: 'Payments land and reconcile without manual entry.' },
  { icon: 'FileSignature',  name: 'Digital Contract Signing',                desc: 'Send, sign, and store agreements without printing a page.' },
  { icon: 'ClipboardCheck', name: 'Auditing & Comprehensive Reporting',      desc: "Complete visibility, ready whenever it's asked for." },
];

const AUDIENCES = ['Businesses', 'SACCOs', 'Chamas', 'Cooperatives', 'Growing enterprises'];

const RECEIPT_ROWS = [
  ['POS sales collected',            'KES 148,200'],
  ['M-Pesa collections reconciled',  '62 txns'],
  ['Member contributions posted',    'KES 94,000'],
  ['Loans disbursed',                '4 approved'],
  ['Payroll status',                 'On schedule'],
];

const OLD_WAY = ['spreadsheets.xlsx', 'WhatsApp messages', 'paper receipt books', 'app #1', 'app #2', 'app #3'];

const LandingPage = () => {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  // Which kind of organization the subscribe form registers ('company' | 'sacco').
  const [orgType, setOrgType] = useState('company');

  // Fade sections in as they scroll into view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = root.querySelectorAll('.reveal');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach(el => el.classList.add('in'));
      return;
    }
    let delivered = false;
    const io = new IntersectionObserver((entries) => {
      delivered = true;
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    targets.forEach(el => io.observe(el));

    // Safety net: the observer delivers its first batch almost immediately in a
    // visible tab. If nothing arrives (hidden tab, or no observer support at
    // all) reveal everything rather than leave the page blank.
    const fallback = setTimeout(() => {
      if (delivered) return;
      io.disconnect();
      targets.forEach(el => el.classList.add('in'));
    }, 1500);

    return () => { clearTimeout(fallback); io.disconnect(); };
  }, []);

  const scrollTo = (id) => (e) => {
    e.preventDefault();
    rootRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Every registration CTA lands on the same form — `orgType` preselects the
  // "I'm registering a" choice on its first step (company vs sacco/chama).
  const goRegister = (type) => () => navigate('/admin-registration', { state: { orgType: type } });

  // "Subscribe" starts the real onboarding flow — the email is carried over
  // and prefilled on the company registration form.
  const handleSubscribe = (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError('Enter a valid email address to continue.');
      return;
    }
    setEmailError('');
    navigate('/admin-registration', { state: { email: value, orgType } });
  };

  return (
    <div className="arr" ref={rootRef}>
      <style>{CSS}</style>

      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <header className="site-nav">
        <div className="nav-inner">
          <div className="brand">
            <span className="brand-mark"><Icon name="Building2" size={17} color="#34c1dd" /></span>
            Ararat
          </div>
          <div className="nav-actions">
            <button className="nav-link-btn" onClick={goRegister('company')}>Register Your Company</button>
            <button className="nav-link-btn" onClick={goRegister('sacco')}>Register Your Chama / Sacco</button>
            <button className="nav-cta" onClick={() => navigate('/login')}>Log In</button>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="ledger-tab"><span className="dot" /> One dashboard, every operation</div>

            <h1 className="hero-headline">
              Run Your Business.<br />
              Let <span className="accent">Ararat</span> Handle the{' '}
              <span className="strike-wrap">
                Paperwork
                <svg viewBox="0 0 220 20" fill="none" aria-hidden="true">
                  <path d="M2 12C60 4 160 4 218 13" stroke="#b91c1c" strokeWidth="3.5" strokeLinecap="round" />
                </svg>
              </span>.
            </h1>

            <p className="hero-sub">
              Stop juggling spreadsheets, WhatsApp messages, paperwork, and multiple applications.
              Ararat brings all your essential business operations into one intelligent platform
              so you save time, work more efficiently, and grow with confidence.
            </p>

            <div className="ledger-lines">
              <div className="row"><span className="check mono">✓</span><span className="txt">Every <b>shilling</b> accounted for.</span></div>
              <div className="row"><span className="check mono">✓</span><span className="txt">Every <b>payment</b> tracked.</span></div>
              <div className="row"><span className="check mono">✓</span><span className="txt">Every <b>client and member</b> connected.</span></div>
            </div>

            <div className="ctas">
              <button className="btn btn-primary" onClick={goRegister('company')}>
                Register your company
                <Icon name="ArrowRight" size={16} color="currentColor" />
              </button>
              <button className="btn btn-ghost" onClick={goRegister('sacco')}>
                Register your chama / sacco
                <Icon name="ArrowRight" size={16} color="currentColor" />
              </button>
            </div>
            <a className="hero-link" href="#platform" onClick={scrollTo('platform')}>
              See what's inside
              <Icon name="ArrowDown" size={14} color="currentColor" />
            </a>
          </div>

          <div className="hero-visual">
            <div className="receipt">
              <div className="stamp" aria-hidden="true">
                <svg viewBox="0 0 140 140">
                  <defs>
                    <filter id="arr-rough">
                      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="noise" />
                      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" />
                    </filter>
                  </defs>
                  <g filter="url(#arr-rough)">
                    <circle cx="70" cy="70" r="58" fill="none" stroke="#b91c1c" strokeWidth="3" />
                    <circle cx="70" cy="70" r="47" fill="none" stroke="#b91c1c" strokeWidth="1.4" />
                    <text x="70" y="55" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" fill="#b91c1c" letterSpacing="1.5">FULLY</text>
                    <text x="70" y="78" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="14" fontWeight="700" fill="#b91c1c" letterSpacing="1">SORTED</text>
                    <text x="70" y="96" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9.5" fill="#b91c1c" letterSpacing="1.5">BY ARARAT</text>
                  </g>
                </svg>
              </div>

              <div className="receipt-head">
                <div>
                  <div className="rtitle">Daily operations summary</div>
                  <div className="rid">NO. 00184  TODAY</div>
                </div>
              </div>

              {RECEIPT_ROWS.map(([label, val]) => (
                <div className="receipt-row" key={label}>
                  <span className="label">{label}</span>
                  <span className="val">{val}</span>
                </div>
              ))}

              <div className="receipt-total">
                <span className="label">Books balanced</span>
                <span className="val">100%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The old way ──────────────────────────────────────────────── */}
      <section className="transition">
        <div className="wrap">
          <div className="t-head reveal">
            <span className="t-eyebrow">The old way</span>
            <h2 className="t-title">
              Four tools, four logins, and a business owner stitching it all together <em>by hand.</em>
            </h2>
          </div>

          <div className="rejected-strip reveal">
            {OLD_WAY.map(item => <div className="rejected-chip" key={item}>{item}</div>)}
          </div>

          <div className="arrow-down reveal">
            <Icon name="ArrowDown" size={22} color="#34c1dd" />
            Replaced by one platform
          </div>

          <p className="t-result reveal">
            Ararat brings every operation onto a single, intelligent dashboard built for how Kenyan
            businesses, SACCOs, and chamas actually run.
          </p>
        </div>
      </section>

      {/* ── Modules ──────────────────────────────────────────────────── */}
      <section className="features" id="platform">
        <div className="wrap">
          <div className="section-head reveal">
            <div>
              <span className="eyebrow">The full ledger</span>
              <div className="stitle">Manage everything from a single dashboard.</div>
            </div>
            <div className="sdesc">
              Thirteen modules, one login. Add what your business needs today, and switch more on as you grow.
            </div>
          </div>

          <div className="ledger-table">
            {MODULES.map((m, i) => (
              <div className="ledger-item reveal" key={m.name}>
                <div className="no mono">{String(i + 1).padStart(2, '0')}</div>
                <div className="body">
                  <div className="icon"><Icon name={m.icon} size={22} color="#34c1dd" strokeWidth={1.8} /></div>
                  <div>
                    <div className="name">{m.name}</div>
                    <div className="desc">{m.desc}</div>
                  </div>
                </div>
                <div className="stampcheck"><Icon name="Check" size={24} color="currentColor" /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Audience ─────────────────────────────────────────────────── */}
      <section className="audience" id="for-you">
        <div className="wrap">
          <div className="section-head reveal" style={{ marginBottom: 0 }}>
            <div>
              <span className="eyebrow">Built for how you're organized</span>
              <div className="stitle">Whoever you serve, Ararat fits your structure.</div>
            </div>
            <div className="sdesc">
              From a single shop to a member-owned cooperative the same platform scales with you.
            </div>
          </div>
          <div className="aud-grid">
            {AUDIENCES.map(a => (
              <div className="aud-card reveal" key={a}>
                <div className="tag">For</div>
                <div className="label">{a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Subscribe ────────────────────────────────────────────────── */}
      <section className="subscribe" id="subscribe">
        <div className="wrap">
          <div className="sub-card reveal">
            <div className="sub-left">
              <span className="eyebrow">Start your journey</span>
              <div className="stitle">Subscribe here to start your journey.</div>
              <p className="sdesc">
                Leave your email and we'll set up your Ararat dashboard POS, accounting,
                contributions, and reporting, ready in one place.
              </p>
            </div>
            <div>
              <form onSubmit={handleSubscribe} noValidate>
                {/* Carried into the registration form so the visitor lands on the
                    right set of questions (company details vs sacco details). */}
                <div className="sub-toggle" role="group" aria-label="What are you registering?">
                  {[
                    { id: 'company', label: 'Company', icon: 'Building2' },
                    { id: 'sacco', label: 'Chama / Sacco', icon: 'Users' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      className={orgType === opt.id ? 'on' : ''}
                      aria-pressed={orgType === opt.id}
                      onClick={() => setOrgType(opt.id)}
                    >
                      <Icon name={opt.icon} size={14} color="currentColor" />
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="sub-field">
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); if (emailError) setEmailError(''); }}
                    placeholder="you@yourbusiness.co.ke"
                    aria-label="Work email address"
                  />
                  <button type="submit">Subscribe</button>
                </div>
                {emailError
                  ? <div className="sub-error">{emailError}</div>
                  : (
                    <div className="sub-note">
                      <Icon name="Mail" size={14} color="#12758c" />
                      Takes you straight to registration no spam.
                    </div>
                  )}
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────── */}
      <section className="closing">
        <div className="wrap closing-inner">
          <div className="reveal">
            <div className="ctitle">
              Spend less time on administration.<br />More time growing your business.
            </div>
            <p className="csub">
              Ararat streamlines your operations, automates your paperwork, and gives you complete
              visibility into your finances and customers.
            </p>
            <div className="ctas">
              <button className="btn btn-primary" onClick={goRegister('company')}>
                Register your company
                <Icon name="ArrowRight" size={16} color="currentColor" />
              </button>
              <button className="btn btn-primary" onClick={goRegister('sacco')}>
                Register your chama / sacco
                <Icon name="ArrowRight" size={16} color="currentColor" />
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/login')}>Sign In</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer>
        <div className="wrap foot-inner">
          <div>
            <div className="fbrand">Ararat</div>
            <div className="foot-tagline">
              Every shilling accounted for. Every payment tracked. Every client and member connected.
            </div>
          </div>

          <div>
            <div className="foot-heading">Contacts</div>
            <div className="foot-rule" />
            <ul className="foot-contacts">
              <li>
                <span className="ficon"><Icon name="Building2" size={17} color="#34c1dd" /></span>
                <span>
                  Victor &amp; Otieno, Advocates Building<br />
                  Joseph Kang'ethe Road, Woodley.<br />
                  Nairobi, Kenya.
                </span>
              </li>
              <li>
                <span className="ficon"><Icon name="Phone" size={17} color="#34c1dd" /></span>
                <a href="tel:+254719225935">+254-719-225-935</a>
              </li>
              <li>
                <span className="ficon"><Icon name="Mail" size={17} color="#34c1dd" /></span>
                <a href="mailto:info@smebusinessclinic.com">info@smebusinessclinic.com</a>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
