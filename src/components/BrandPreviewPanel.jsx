import React, { useState, useEffect } from 'react';
import Icon from './AppIcon';

/**
 * The dark product-preview panel that sits beside the sign-in and registration
 * forms: headline, capability chips, a rotating device mock-up, and a list of
 * steps along the bottom.
 *
 * The steps area works two ways:
 *   - `steps` alone            → a static numbered list (01/02/03), as on login.
 *   - `steps` + `currentStep`  → a live progress tracker, as on registration,
 *                                where finished stages get a green check and
 *                                the stage you are on is highlighted.
 */

// System colors.
const C = {
  primary:     '#34c1dd',
  primaryDark: '#1da8c5',
  navy:        '#0c2037',
  navyMid:     '#1a3a5c',
  bg2:         '#eaf1f6',
  card:        '#ffffff',
  border:      '#d0dce6',
  text:        '#0c2037',
  textMuted:   '#5a7185',
  done:        '#10b981',
  onNavy:      '#ffffff',
  onNavyMuted: '#7a9cb8',
  onNavyFaint: 'rgba(255,255,255,0.38)',
  copyright:   '#3a5a7a',
  lineOnNavy:  'rgba(52,193,221,0.16)',
};

// Georgia = display, body face = labels, Courier = figures only.
const SERIF = { fontFamily: "Georgia, 'Times New Roman', serif" };
const MONO = { fontFamily: "'Courier New', Courier, monospace", fontVariantNumeric: 'tabular-nums' };
const LABEL = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
};

const SLIDE_COUNT = 6;
const SLIDE_INTERVAL = 5000;

const CHIPS = [
  { icon: 'Users',      label: 'Client portal'    },
  { icon: 'Landmark',   label: 'Member portal'    },
  { icon: 'PenLine',    label: 'Visual e-signing' },
  { icon: 'Calculator', label: 'Loan calculator'  },
];

const SLIDE_LABELS = [
  'Dashboard',
  'Hire purchase portal',
  'Loan application and approval',
  'Member voting',
  'Visual e-signing',
  'Loan calculator',
];

const Slide = function(props) {
  return (
    <div
      className="absolute inset-0 px-5 py-4"
      style={{
        opacity: props.active ? 1 : 0,
        transform: props.active ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity .5s ease, transform .5s ease',
        pointerEvents: props.active ? 'auto' : 'none',
      }}
      aria-hidden={!props.active}
    >
      <div style={{ ...LABEL, fontSize: '10px', color: C.textMuted }}>
        {props.label}
      </div>
      <div style={{ ...SERIF, fontSize: '16px', fontWeight: 700, color: C.navy, marginTop: '3px' }}>
        {props.heading}
      </div>
      {props.children}
    </div>
  );
};

const BrandPreviewPanel = function(props) {
  const steps = props.steps || [];
  const currentStep = props.currentStep;
  const isProgress = typeof currentStep === 'number';
  const [slide, setSlide] = useState(0);

  useEffect(function() {
    // Honour the OS "reduce motion" setting — no auto-rotation, dots still work.
    var reduced = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return undefined;

    // Keyed on `slide` so picking a dot restarts the countdown instead of
    // letting a mid-flight tick yank the user off the slide they just chose.
    var id = setTimeout(function() {
      setSlide(function(n) { return (n + 1) % SLIDE_COUNT; });
    }, SLIDE_INTERVAL);
    return function() { clearTimeout(id); };
  }, [slide]);

  return (
    <div
      className={'hidden lg:flex flex-col relative overflow-hidden ' + (props.className || '')}
      style={{ background: C.navy, color: C.onNavy }}
    >
      {/* The signature stroke and its stamp need real keyframes. */}
      <style>{`
        .bp-sign path {
          fill: none;
          stroke-width: 2.4;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 220;
          stroke-dashoffset: 220;
          animation: bp-draw 1.4s ease forwards .3s;
        }
        @keyframes bp-draw { to { stroke-dashoffset: 0; } }
        .bp-stamp { opacity: 0; animation: bp-fade .4s ease forwards 1.6s; }
        @keyframes bp-fade { to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .bp-sign path { animation: none; stroke-dashoffset: 0; }
          .bp-stamp { animation: none; opacity: 1; }
        }
      `}</style>

      {/* Ambient wash — system cyan instead of the mock-up's warm tones */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(680px 320px at 90% -10%, rgba(52,193,221,0.16), transparent 60%),' +
            'radial-gradient(600px 300px at 0% 110%, rgba(52,193,221,0.10), transparent 60%)',
        }}
      />

      {/* Scrolls rather than clipping the footer on short viewports. */}
      <div className="relative z-10 flex flex-col flex-1 min-h-0 overflow-y-auto px-12 pt-11 pb-9">

        {/* Heading */}
        <div>
          <span style={{ ...LABEL, fontSize: '11.5px', color: C.primary }}>
            A quick look inside
          </span>
          <div
            style={{
              ...SERIF,
              fontSize: 'clamp(22px, 2.4vw, 29px)',
              lineHeight: 1.22,
              fontWeight: 600,
              marginTop: '12px',
              maxWidth: '24ch',
              color: C.onNavy,
            }}
          >
            Every portal, payment and{' '}
            <em style={{ color: C.primary, fontStyle: 'italic' }}>signature</em>, in one system.
          </div>
        </div>

        {/* Capability chips */}
        <div className="flex flex-wrap gap-2 mt-4">
          {CHIPS.map(function(chip) {
            return (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
                style={{ fontSize: '11.5px', color: C.onNavyMuted, border: '1px solid ' + C.lineOnNavy }}
              >
                <Icon name={chip.icon} size={12} color={C.primary} />
                {chip.label}
              </span>
            );
          })}
        </div>

        {/* Device mock-up */}
        <div
          className="mt-5 rounded-xl px-3 pt-3 flex-shrink-0"
          style={{
            background: C.navyMid,
            border: '1px solid ' + C.lineOnNavy,
            boxShadow: '0 40px 80px -30px rgba(0,0,0,0.5)',
          }}
        >
          <div className="flex items-center gap-1.5 pb-2.5">
            <span className="w-2 h-2 rounded-full" style={{ background: C.lineOnNavy }} />
            <span className="w-2 h-2 rounded-full" style={{ background: C.lineOnNavy }} />
            <span className="w-2 h-2 rounded-full" style={{ background: C.lineOnNavy }} />
          </div>

          <div
            className="relative overflow-hidden"
            style={{ background: C.card, borderRadius: '8px 8px 0 0', height: '250px' }}
          >
            {/* 0 — Dashboard */}
            <Slide active={slide === 0} label="Dashboard" heading="This month at a glance">
              <div className="flex gap-2.5 mt-3.5">
                {[{ k: 'Revenue', v: 'KES 842K' }, { k: 'Contributions', v: 'KES 310K' }].map(function(s) {
                  return (
                    <div
                      key={s.k}
                      className="flex-1 rounded px-3 py-2"
                      style={{ background: C.bg2, border: '1px solid ' + C.border }}
                    >
                      <div style={{ ...LABEL, fontSize: '9.5px', color: C.textMuted }}>{s.k}</div>
                      <div style={{ ...MONO, fontSize: '15px', fontWeight: 700, color: C.primaryDark, marginTop: '3px' }}>{s.v}</div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-end gap-1.5 mt-3" style={{ height: '44px' }}>
                {[35, 55, 40, 70, 50, 85, 60].map(function(h, i) {
                  return (
                    <i
                      key={i}
                      className="flex-1 block"
                      style={{ height: h + '%', background: C.primary, borderRadius: '2px 2px 0 0' }}
                    />
                  );
                })}
              </div>
            </Slide>

            {/* 1 — Hire purchase */}
            <Slide active={slide === 1} label="Client Portal · Hire Purchase" heading="Maize sheller — Installment 4 of 8">
              <div className="mt-3.5">
                <div
                  className="overflow-hidden"
                  style={{ height: '8px', background: C.bg2, border: '1px solid ' + C.border, borderRadius: '5px' }}
                >
                  <i className="block h-full" style={{ width: '50%', background: C.navyMid }} />
                </div>
                <div
                  className="flex justify-between mt-1.5"
                  style={{ ...MONO, fontSize: '10.5px', color: C.textMuted }}
                >
                  <span>KES 45,000 paid</span><span>50%</span>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                {[
                  ['Item price', 'KES 90,000'],
                  ['Next installment due', '12 Aug'],
                  ['Balance remaining', 'KES 45,000'],
                ].map(function(r) {
                  return (
                    <div key={r[0]} className="flex justify-between" style={{ fontSize: '12px', color: C.text }}>
                      <span>{r[0]}</span>
                      <span style={{ ...MONO, color: C.primaryDark, fontWeight: 700 }}>{r[1]}</span>
                    </div>
                  );
                })}
              </div>
            </Slide>

            {/* 2 — Loan application */}
            <Slide active={slide === 2} label="Member Portal · Loan Application" heading="Loan request #LN-2291">
              <div className="flex items-center mt-4">
                {['Submitted', 'Reviewed', 'Approved'].map(function(step, i, arr) {
                  return (
                    <div key={step} className="relative flex flex-col items-center flex-1">
                      {i < arr.length - 1 && (
                        <span
                          className="absolute"
                          style={{ top: '10px', left: '50%', width: '100%', height: '2px', background: C.primary, zIndex: 0 }}
                        />
                      )}
                      <div
                        className="flex items-center justify-center rounded-full relative"
                        style={{ width: '20px', height: '20px', background: C.primary, color: C.navy, fontSize: '11px', zIndex: 1 }}
                      >
                        <Icon name="Check" size={12} color={C.navy} />
                      </div>
                      <span style={{ fontSize: '9.5px', color: C.textMuted, marginTop: '5px' }}>{step}</span>
                    </div>
                  );
                })}
              </div>
              <div
                className="flex items-center gap-2 mt-3.5"
                style={{ fontSize: '12.5px', fontWeight: 700, color: C.primaryDark }}
              >
                <Icon name="CheckCircle2" size={15} color={C.primaryDark} />
                Approved by committee vote — KES 60,000
              </div>
            </Slide>

            {/* 3 — Voting */}
            <Slide active={slide === 3} label="Member Portal · Voting" heading="AGM: New loan policy">
              <div className="mt-3.5 flex flex-col gap-1.5">
                {[['Approve', 78], ['Reject', 14], ['Abstain', 8]].map(function(o) {
                  return (
                    <div
                      key={o[0]}
                      className="flex items-center justify-between rounded px-3 py-2"
                      style={{ background: C.bg2, border: '1px solid ' + C.border, fontSize: '12px', color: C.text }}
                    >
                      <span>{o[0]}</span>
                      <div className="overflow-hidden" style={{ width: '58px', height: '6px', background: C.border, borderRadius: '3px' }}>
                        <i className="block h-full" style={{ width: o[1] + '%', background: C.navyMid }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Slide>

            {/* 4 — e-Signing */}
            <Slide active={slide === 4} label="Visual e-Signing" heading="Loan agreement — ready to sign">
              <div className="mt-3 flex flex-col gap-1.5">
                {[100, 92, 96, 70].map(function(w, i) {
                  return <i key={i} className="block" style={{ width: w + '%', height: '6px', background: C.border, borderRadius: '2px' }} />;
                })}
              </div>
              <div
                className="mt-3.5 pt-2.5 flex items-center justify-between"
                style={{ borderTop: '1px dashed ' + C.border }}
              >
                {/* key forces the stroke animation to replay each time the slide returns */}
                <svg key={'sig-' + slide} className="bp-sign" viewBox="0 0 120 34" style={{ width: '120px', height: '34px' }}>
                  <path d="M4 24 C 14 6, 22 30, 32 16 S 48 4, 56 20 S 70 30, 80 12 S 96 6, 108 22" stroke={C.primaryDark} />
                </svg>
                <span
                  key={'stamp-' + slide}
                  className="bp-stamp flex items-center gap-1"
                  style={{ ...LABEL, fontSize: '10px', color: C.primaryDark, fontWeight: 700 }}
                >
                  <Icon name="Check" size={13} color={C.primaryDark} />
                  Signed
                </span>
              </div>
            </Slide>

            {/* 5 — Loan calculator */}
            <Slide active={slide === 5} label="Loan Calculator" heading="See your repayment before you apply">
              <div className="flex items-center gap-4 mt-3">
                <div
                  className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{
                    width: '76px',
                    height: '76px',
                    background: 'conic-gradient(' + C.primaryDark + ' 0% 62%, ' + C.border + ' 62% 100%)',
                  }}
                >
                  <div
                    className="flex flex-col items-center justify-center rounded-full"
                    style={{ width: '52px', height: '52px', background: C.card }}
                  >
                    <b style={{ ...MONO, fontSize: '13px', color: C.primaryDark }}>62%</b>
                    <span style={{ ...LABEL, fontSize: '7.5px', color: C.textMuted }}>Paid off</span>
                  </div>
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  {[
                    ['Principal', 'KES 60,000'],
                    ['Monthly installment', 'KES 5,800'],
                    ['Balance', 'KES 22,800'],
                  ].map(function(r) {
                    return (
                      <div key={r[0]} className="flex justify-between" style={{ fontSize: '11.5px', color: C.text }}>
                        <span>{r[0]}</span>
                        <span style={{ ...MONO, fontWeight: 700, color: C.text }}>{r[1]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Slide>
          </div>
        </div>

        {/* Slide selector */}
        <div className="flex flex-wrap justify-center gap-2 mt-3.5">
          {SLIDE_LABELS.map(function(label, i) {
            return (
              <button
                key={label}
                type="button"
                onClick={function() { setSlide(i); }}
                aria-label={label}
                aria-current={slide === i}
                style={{
                  width: '20px',
                  height: '4px',
                  borderRadius: '2px',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  background: slide === i ? C.primary : C.lineOnNavy,
                  transition: 'background .2s ease',
                }}
              />
            );
          })}
        </div>

        {/* Steps — static list, or a live tracker when `currentStep` is given */}
        <div className="mt-6 flex flex-col" style={{ borderTop: '1px solid ' + C.lineOnNavy }}>
          {steps.map(function(step, i) {
            if (!isProgress) {
              return (
                <div
                  key={i}
                  className="flex items-baseline gap-3.5 py-2.5"
                  style={{ borderBottom: '1px solid ' + C.lineOnNavy }}
                >
                  <span style={{ ...MONO, fontSize: '12px', color: C.primary, flexShrink: 0 }}>
                    {'0' + (i + 1)}
                  </span>
                  <span style={{ fontSize: '13.5px', color: C.onNavyMuted }}>
                    {Array.isArray(step)
                      ? [step[0], <b key="b" style={{ color: C.onNavy, fontWeight: 700 }}>{step[1]}</b>, step[2]]
                      : step}
                  </span>
                </div>
              );
            }

            var isDone = i < currentStep;
            var isActive = i === currentStep;
            return (
              <div
                key={step}
                className="flex items-center gap-3.5 py-2.5"
                style={{ borderBottom: '1px solid ' + C.lineOnNavy }}
                aria-current={isActive ? 'step' : undefined}
              >
                <span
                  className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{
                    ...MONO,
                    width: '24px',
                    height: '24px',
                    fontSize: '11px',
                    fontWeight: 700,
                    background: isDone ? C.done : isActive ? C.primary : 'rgba(52,193,221,0.14)',
                    color: isDone || isActive ? C.navy : C.onNavyMuted,
                    boxShadow: isActive ? '0 0 0 3px rgba(52,193,221,0.22)' : 'none',
                  }}
                >
                  {isDone ? <Icon name="Check" size={13} color={C.navy} /> : i + 1}
                </span>
                <span
                  style={{
                    fontSize: '13.5px',
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? C.onNavy : isDone ? C.onNavyMuted : C.onNavyFaint,
                  }}
                >
                  {step}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-auto pt-5">
          <p style={{ fontSize: '12px', color: C.onNavyMuted }}>
            No setup calls required. No manuals to read first.
          </p>
          <p className="mt-1.5" style={{ fontSize: '11.5px', color: C.copyright }}>
            &copy; {new Date().getFullYear()} Ararat. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BrandPreviewPanel;
