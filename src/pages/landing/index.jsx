import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';

const B = {
  dark:    '#0c2037',
  darkMid: '#112844',
  accent:  '#34c1dd',
  accentDark: '#20a8c5',
  white:   '#ffffff',
  offWhite:'#f5f8fa',
  muted:   '#7a9cb8',
  border:  '#d0dce6',
};

const Btn = ({ children, variant = 'accent', onClick, icon }) => {
  const styles = {
    accent: { background: B.accent, color: B.dark, border: 'none' },
    dark:   { background: B.dark,   color: B.white, border: 'none' },
    outline:{ background: 'transparent', color: B.dark, border: `2px solid ${B.dark}` },
    outlineLight: { background: 'transparent', color: B.white, border: `2px solid rgba(255,255,255,0.5)` },
  };
  return (
    <button
      onClick={onClick}
      style={{
        ...styles[variant],
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '13px 28px', borderRadius: '8px',
        fontFamily: 'Open Sans, Arial, sans-serif',
        fontWeight: 700, fontSize: '14px', cursor: 'pointer',
        transition: 'all 180ms ease', letterSpacing: '0.01em',
      }}
      onMouseEnter={e => {
        if (variant === 'accent') e.currentTarget.style.background = B.accentDark;
        if (variant === 'dark')   e.currentTarget.style.background = '#152d4a';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        if (variant === 'accent') e.currentTarget.style.background = B.accent;
        if (variant === 'dark')   e.currentTarget.style.background = B.dark;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {children}
      {icon && <Icon name={icon} size={16} color="currentColor" />}
    </button>
  );
};

const FeatureCard = ({ icon, title, desc }) => (
  <div style={{
    background: B.white, border: `1px solid ${B.border}`,
    borderRadius: '12px', padding: '28px 24px',
    boxShadow: '0 2px 8px rgba(12,32,55,0.07)',
    transition: 'box-shadow 200ms ease, transform 200ms ease',
  }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(12,32,55,0.14)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(12,32,55,0.07)'; e.currentTarget.style.transform = 'translateY(0)'; }}
  >
    <div style={{ width: '48px', height: '48px', borderRadius: '10px', background: `rgba(52,193,221,0.12)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
      <Icon name={icon} size={22} color={B.accent} />
    </div>
    <h3 style={{ fontFamily: 'Georgia, serif', fontSize: '17px', fontWeight: 700, color: B.dark, marginBottom: '8px' }}>{title}</h3>
    <p style={{ fontFamily: 'Open Sans, sans-serif', fontSize: '13.5px', color: '#5a7185', lineHeight: 1.65 }}>{desc}</p>
  </div>
);

const StatCard = ({ value, label }) => (
  <div style={{ textAlign: 'center' }}>
    <p style={{ fontFamily: 'Georgia, serif', fontSize: '2rem', fontWeight: 700, color: B.accent, lineHeight: 1 }}>{value}</p>
    <p style={{ fontFamily: 'Open Sans, sans-serif', fontSize: '12px', color: 'rgba(255,255,255,0.65)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
  </div>
);

const features = [
  { icon: 'Briefcase',   title: 'Asset Management',     desc: 'Register vehicles, property, electronics, furniture, construction equipment and more — with type-specific fields for every category.' },
  { icon: 'Users',       title: 'Client Management',    desc: 'Full client lifecycle from onboarding to KYC verification. Link clients to assets and track every interaction.' },
  { icon: 'CreditCard',  title: 'Payment Collections',  desc: 'Record Mpesa, bank transfer, and cash payments. Automated reminders, penalty calculation, and installment schedules.' },
  { icon: 'ShieldCheck', title: 'KYC Compliance',       desc: 'Document upload, photo capture, KRA PIN verification, expiry tracking, and renewal workflow — all in one place.' },
  { icon: 'BarChart3',   title: 'Reports & Analytics',  desc: 'Executive dashboards, sales conversion charts, aging analysis, and scheduled report delivery via email.' },
  { icon: 'UserCog',     title: 'Multi-Role Access',    desc: 'Super Admin, Admin, Director, Accountant, Collections Officer, Sales Agent, and Client — each with the right access level.' },
];

const steps = [
  { n: '01', title: 'Register Your Company', desc: 'Sign up, choose your subscription plan, and configure your asset categories and team roles.' },
  { n: '02', title: 'Onboard Clients & Assets', desc: 'Invite clients, complete KYC, register assets, and link them together for payment tracking.' },
  { n: '03', title: 'Collect & Report',      desc: 'Record payments, generate invoices, run reports, and grow your business with data-driven insights.' },
];

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div style={{ fontFamily: 'Open Sans, Arial, sans-serif', background: B.offWhite, minHeight: '100vh' }}>

      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <nav style={{
        background: B.white, borderBottom: `1px solid ${B.border}`,
        padding: '0 32px', height: '64px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
        boxShadow: '0 1px 4px rgba(12,32,55,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: B.dark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="Building2" size={18} color={B.accent} />
          </div>
          <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '18px', color: B.dark }}>AssetFlow</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => navigate('/admin-registration')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#5a7185', fontFamily: 'Open Sans, sans-serif', padding: '8px 12px' }}>
            Register Company
          </button>
          <Btn variant="dark" onClick={() => navigate('/login')}>Log In</Btn>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section style={{
        background: `linear-gradient(135deg, ${B.dark} 0%, #112844 60%, #1a3a5c 100%)`,
        padding: '80px 32px 72px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Decorative circle */}
        <div style={{ position: 'absolute', top: '-80px', right: '-80px', width: '400px', height: '400px', borderRadius: '50%', background: 'rgba(52,193,221,0.06)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: '760px', margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(52,193,221,0.15)', color: B.accent,
            fontSize: '11px', fontWeight: 700, padding: '5px 14px',
            borderRadius: '999px', marginBottom: '20px',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            border: '1px solid rgba(52,193,221,0.3)',
          }}>
            <Icon name="Zap" size={11} color="currentColor" />
            Financial Asset Management Platform
          </span>

          <h1 style={{
            fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 'clamp(2rem, 5vw, 3rem)',
            color: B.white, lineHeight: 1.15, marginBottom: '20px', letterSpacing: '-0.02em',
          }}>
            Manage Assets, Clients &{' '}
            <span style={{ color: B.accent }}>Collections</span>{' '}
            in One Platform
          </h1>

          <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.72)', lineHeight: 1.7, marginBottom: '36px', maxWidth: '580px', margin: '0 auto 36px' }}>
            A complete financial management system for asset dealers — vehicles, property, electronics, furniture, construction equipment, and more. Built for Kenya's growing businesses.
          </p>

          <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Btn variant="accent" onClick={() => navigate('/admin-registration')} icon="ArrowRight">
              Get Started Free
            </Btn>
            <Btn variant="outlineLight" onClick={() => navigate('/login')}>
              Sign In
            </Btn>
          </div>
        </div>
      </section>

      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      <section style={{ background: B.dark, padding: '32px 32px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '32px', textAlign: 'center' }}>
          {[
            { value: '500+',  label: 'Companies using AssetFlow' },
            { value: '50K+',  label: 'Assets managed' },
            { value: 'KES 2B+', label: 'Payments tracked' },
            { value: '6',     label: 'Asset categories' },
          ].map((s, i) => <StatCard key={i} {...s} />)}
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────── */}
      <section style={{ padding: '72px 32px', background: B.offWhite }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 'clamp(1.5rem, 3vw, 2.1rem)', color: B.dark, marginBottom: '12px' }}>
              Everything you need to manage your business
            </h2>
            <div style={{ width: '48px', height: '3px', background: B.accent, borderRadius: '2px', margin: '0 auto 16px' }} />
            <p style={{ fontSize: '15px', color: '#5a7185', maxWidth: '540px', margin: '0 auto', lineHeight: 1.65 }}>
              From onboarding clients to collecting payments and generating reports — AssetFlow handles it all.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            {features.map((f, i) => <FeatureCard key={i} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section style={{ padding: '72px 32px', background: B.white }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 'clamp(1.5rem, 3vw, 2rem)', color: B.dark, marginBottom: '12px' }}>
              Get started in three steps
            </h2>
            <div style={{ width: '48px', height: '3px', background: B.accent, borderRadius: '2px', margin: '0 auto' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '28px' }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontFamily: 'Georgia, serif', fontSize: '2rem', fontWeight: 700, color: B.accent, lineHeight: 1 }}>{s.n}</span>
                  <div style={{ height: '2px', flex: 1, background: B.border }} />
                </div>
                <h3 style={{ fontFamily: 'Georgia, serif', fontSize: '16px', fontWeight: 700, color: B.dark }}>{s.title}</h3>
                <p style={{ fontSize: '13.5px', color: '#5a7185', lineHeight: 1.65 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Asset categories ───────────────────────────────────────────── */}
      <section style={{ padding: '64px 32px', background: `linear-gradient(135deg, ${B.dark}, #1a3a5c)` }}>
        <div style={{ maxWidth: '860px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 'clamp(1.4rem, 3vw, 2rem)', color: B.white, marginBottom: '12px' }}>
            Built for all asset types
          </h2>
          <div style={{ width: '40px', height: '3px', background: B.accent, borderRadius: '2px', margin: '0 auto 32px' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
            {[
              { icon: 'Car',        label: 'Car Dealers' },
              { icon: 'Home',       label: 'Property / Land' },
              { icon: 'Tv2',        label: 'Electronics' },
              { icon: 'Armchair',   label: 'Furniture' },
              { icon: 'HardHat',    label: 'Construction' },
              { icon: 'Truck',      label: 'Heavy Equipment' },
            ].map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'rgba(52,193,221,0.1)', border: '1px solid rgba(52,193,221,0.25)',
                borderRadius: '8px', padding: '10px 18px',
                color: B.white, fontSize: '13px', fontWeight: 600,
              }}>
                <Icon name={a.icon} size={16} color={B.accent} />
                {a.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <section style={{ padding: '72px 32px', background: B.offWhite, textAlign: 'center' }}>
        <div style={{ maxWidth: '560px', margin: '0 auto' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 'clamp(1.5rem, 3vw, 2rem)', color: B.dark, marginBottom: '12px' }}>
            Ready to take control of your assets?
          </h2>
          <div style={{ width: '40px', height: '3px', background: B.accent, borderRadius: '2px', margin: '0 auto 16px' }} />
          <p style={{ fontSize: '15px', color: '#5a7185', marginBottom: '32px', lineHeight: 1.65 }}>
            Join hundreds of Kenyan businesses already using AssetFlow to grow and manage their portfolios.
          </p>
          <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Btn variant="dark" onClick={() => navigate('/admin-registration')} icon="ArrowRight">
              Register Your Company
            </Btn>
            <Btn variant="outline" onClick={() => navigate('/login')}>
              Sign In
            </Btn>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer style={{ background: B.dark, padding: '32px', borderTop: `3px solid ${B.accent}` }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '6px', background: B.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="Building2" size={15} color={B.dark} />
            </div>
            <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '15px', color: B.white }}>AssetFlow</span>
          </div>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontFamily: 'Open Sans, sans-serif' }}>
            © {new Date().getFullYear()} AssetFlow Management Platform. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
