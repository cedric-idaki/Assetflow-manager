/**
 * Every write on the KYC review screen must be able to say whether it changed
 * anything.
 *
 * THE DEFECT THIS GUARDS
 * ----------------------
 * PostgREST answers 204 to an UPDATE whether it matched a row or row-level
 * security filtered that row away. So this:
 *
 *     await supabase.from('clients')
 *       .update({ kyc_status: 'verified' })
 *       .eq('id', client._id);
 *     showToast('Client KYC fully verified! ');
 *     onStatusChange('verified');
 *
 * tells the reviewer the client is verified, and repaints the list beside them
 * to match, whether or not a single row moved. Six writes on this screen were
 * written that way. A reviewer without permission to verify clients would have
 * seen nothing but success.
 *
 * The fix is `.select('id')` and treating an empty array as failure. This test
 * reads the source rather than rendering, for the same reason
 * approvalEnqueue.sync.test.js does: the defect is not a rendering bug, it is a
 * call that forgot to ask for its own result, and that is visible in the text.
 *
 * See the postgrest-update-silent-denial note: this shape has appeared more than
 * once in this codebase.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SCREEN = resolve(process.cwd(), 'src/pages/kyc-management-screen/index.jsx');
const src = readFileSync(SCREEN, 'utf8');

/** Every `.update(` in the file, with the ~200 characters that follow it. */
const updateCalls = () => {
  const out = [];
  const re = /\.update\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Skip the two mentions inside the explanatory comment block.
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index));
    if (/^\s*(\*|\/\/)/.test(line)) continue;
    out.push({ index: m.index, tail: src.slice(m.index, m.index + 220) });
  }
  return out;
};

describe('KYC review screen writes confirm what they changed', () => {
  it('has at least one write to check', () => {
    expect(updateCalls().length).toBeGreaterThan(0);
  });

  it('asks every update for the row back', () => {
    updateCalls().forEach(({ tail }) => {
      expect(tail).toMatch(/\.select\(/);
    });
  });

  it('routes every write through the one confirming helper', () => {
    // One update call in the file, inside applyUpdate. Six call sites use it.
    expect(updateCalls()).toHaveLength(1);
    expect(src).toContain('const applyUpdate = async (table, patch, id) =>');
    expect(src).toMatch(/if \(!data \|\| data\.length === 0\)/);
  });

  it('treats a refused write as a failure, not a success', () => {
    // The helper must never report ok on an empty result.
    const helper = /const applyUpdate[\s\S]*?\n {2}};/.exec(src);
    expect(helper).not.toBeNull();
    expect(helper[0]).toMatch(/return \{ ok: false/);
    expect(helper[0].indexOf('ok: false')).toBeLessThan(helper[0].lastIndexOf('ok: true'));
  });

  it('only tells the parent the status changed after a confirmed write', () => {
    // Each onStatusChange must sit downstream of a checked result. Catching the
    // inverse is what matters: an onStatusChange that is not preceded, within
    // its own function, by a res.ok guard.
    const calls = [...src.matchAll(/onStatusChange\('(verified|rejected)'\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    calls.forEach((m) => {
      const before = src.slice(Math.max(0, m.index - 700), m.index);
      expect(before).toMatch(/res\.ok|await applyUpdate/);
    });
  });

  it('refuses to verify a client whose required documents are missing', () => {
    // Approve All used to drop absent documents and mark the client verified
    // regardless, so five required documents could be satisfied by three.
    expect(src).toContain('const missing = REQUIRED_DOCS.filter(t => !getDoc(t));');
    expect(src).toMatch(/if \(missing\.length\) \{[\s\S]*?return;/);
    const approveAll = /const handleApproveAll[\s\S]*?\n {2}};/.exec(src)[0];
    expect(approveAll.indexOf('missing.length'))
      .toBeLessThan(approveAll.indexOf("kyc_status: 'verified'"));
    expect(approveAll).not.toContain('.filter(Boolean)');
  });

  it('does not present a failed document read as an empty document list', () => {
    expect(src).toContain('setLoadError(error ? error.message : null)');
    expect(src).toMatch(/\{loadError && \(/);
  });
});
