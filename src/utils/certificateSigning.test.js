import { describe, it, expect } from 'vitest';
import {
  A4, SIG_BLOCK, signatureBlocks, fieldsForSigners,
  defaultPanelFor, cleanSigner, cleanPanel,
  signingVerdict, isTerminal, isIssued, releaseState, docKindLabel,
  DOC_KINDS, isSaccoOnlyKind, releaseWords, GUARANTOR_ROLE,
} from './certificateSigning';

// The layout is shared by the PDF generator and the SignNow field placement.
// If these numbers stop agreeing, signatures land next to the ruled line
// instead of on it — and nobody finds out until a member is holding the paper.
describe('signatureBlocks', () => {
  it('centres a row that fits, evenly spaced', () => {
    const blocks = signatureBlocks(3, A4.landscape);
    expect(blocks).toHaveLength(3);

    const gaps = [
      blocks[1].x - (blocks[0].x + blocks[0].width),
      blocks[2].x - (blocks[1].x + blocks[1].width),
    ];
    expect(gaps[0]).toBeCloseTo(SIG_BLOCK.gap, 5);
    expect(gaps[1]).toBeCloseTo(SIG_BLOCK.gap, 5);

    // Centred: the margin either side of the whole row is equal.
    const left = blocks[0].x;
    const right = A4.landscape.width - (blocks[2].x + blocks[2].width);
    expect(left).toBeCloseTo(right, 5);
  });

  it('keeps every block on the page even when the panel is large', () => {
    const { width } = A4.portrait;
    const blocks = signatureBlocks(6, A4.portrait);
    for (const b of blocks) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    }
  });

  it('puts the ruled line under the signing box, and the caption under that', () => {
    const [b] = signatureBlocks(1, A4.portrait);
    expect(b.lineY).toBeGreaterThan(b.y + b.height - 1);
    expect(b.captionY).toBeGreaterThan(b.lineY);
  });

  it('measures the row up from the foot of the page', () => {
    const tall = signatureBlocks(2, A4.portrait, 120)[0];
    const low = signatureBlocks(2, A4.portrait, 60)[0];
    // A smaller bottom offset means closer to the bottom, i.e. a LARGER y in
    // top-left space. Getting this backwards is how the blocks end up off-page.
    expect(low.y).toBeGreaterThan(tall.y);
  });

  it('never returns nothing, even for an empty panel', () => {
    expect(signatureBlocks(0, A4.portrait)).toHaveLength(1);
  });
});

describe('fieldsForSigners', () => {
  it('carries the role through, because that is what binds a field to a signer', () => {
    const signers = [
      { role: 'Chairperson', order: 1 },
      { role: 'Treasurer', order: 2 },
    ];
    const fields = fieldsForSigners(signers, 0, A4.landscape, 96);
    expect(fields.map((f) => f.role)).toEqual(['Chairperson', 'Treasurer']);
    expect(fields.every((f) => f.page === 0)).toBe(true);
    expect(fields.every((f) => f.withDate === true)).toBe(true);
  });

  it('places fields exactly where the generator drew the blocks', () => {
    const signers = [{ role: 'Valuer', order: 1 }, { role: 'Treasurer', order: 2 }];
    const blocks = signatureBlocks(2, A4.portrait, 120);
    const fields = fieldsForSigners(signers, 1, A4.portrait, 120);

    fields.forEach((f, i) => {
      expect(f.x).toBe(blocks[i].x);
      expect(f.y).toBe(blocks[i].y);
      expect(f.width).toBe(blocks[i].width);
      expect(f.height).toBe(blocks[i].height);
    });
  });
});

describe('defaultPanelFor', () => {
  it('matches the signature lines the share certificate already prints', () => {
    expect(defaultPanelFor('share_certificate').map((p) => p.role))
      .toEqual(['Chairperson', 'Treasurer', 'Secretary']);
  });

  it('falls back rather than returning nothing for an unknown kind', () => {
    expect(defaultPanelFor('nonsense').length).toBeGreaterThan(0);
  });

  it('returns a fresh array each time, so editing one panel cannot alter the default', () => {
    const a = defaultPanelFor('share_certificate');
    a[0].email = 'someone@example.com';
    expect(defaultPanelFor('share_certificate')[0].email).toBe('');
  });
});

describe('cleanSigner', () => {
  it('normalises a usable signer', () => {
    expect(cleanSigner({ role: ' Chairperson ', name: ' Amina ', email: ' A@B.CO ' }, 0))
      .toEqual({ role: 'Chairperson', name: 'Amina', email: 'a@b.co', order: 1 });
  });

  it('rejects a signer who cannot actually be invited', () => {
    expect(cleanSigner({ role: 'Chairperson', email: '' }, 0)).toBeNull();
    expect(cleanSigner({ role: '', email: 'a@b.co' }, 0)).toBeNull();
    expect(cleanSigner({ role: 'Chair', email: 'not-an-email' }, 0)).toBeNull();
    expect(cleanSigner(null, 0)).toBeNull();
  });

  it('numbers signers from their position when no order is given', () => {
    expect(cleanSigner({ role: 'Secretary', email: 'c@d.co' }, 2).order).toBe(3);
  });
});

describe('cleanPanel', () => {
  it('drops the unusable rows and keeps the rest', () => {
    const panel = cleanPanel([
      { role: 'Chairperson', email: 'chair@sacco.co.ke' },
      { role: 'Treasurer', email: '' },
      { role: 'Secretary', email: 'sec@sacco.co.ke' },
    ]);
    expect(panel.map((p) => p.role)).toEqual(['Chairperson', 'Secretary']);
  });

  it('is empty for anything that is not a list', () => {
    expect(cleanPanel(null)).toEqual([]);
    expect(cleanPanel('nope')).toEqual([]);
  });
});

describe('status vocabulary', () => {
  it('treats only "released" as issued — signed is not the same claim', () => {
    expect(isIssued('released')).toBe(true);
    expect(isIssued('signed')).toBe(false);
  });

  it('knows which states are the end of the road', () => {
    expect(isTerminal('released')).toBe(true);
    expect(isTerminal('declined')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('sent')).toBe(false);
    expect(isTerminal('signed')).toBe(false);
  });

  it('never presents an unfinished request as verified', () => {
    for (const s of ['draft', 'sent', 'viewed', 'declined', 'cancelled', 'expired', 'failed']) {
      expect(signingVerdict(s).label).not.toBe('Issued');
    }
    expect(signingVerdict('released').label).toBe('Issued');
  });

  it('says something for a status it has never heard of', () => {
    expect(signingVerdict('teleported').label).toBe('Unknown');
  });
});

describe('releaseState', () => {
  it('hands over a released certificate', () => {
    expect(releaseState(true, { status: 'released' })).toMatchObject({ kind: 'allowed', signed: true });
    expect(releaseState(false, { status: 'released' })).toMatchObject({ kind: 'allowed', signed: true });
  });

  it('blocks an unfinished one where a signature is required', () => {
    const r = releaseState(true, { status: 'sent' });
    expect(r.kind).toBe('blocked');
    expect(r.reason).toBeTruthy();

    const never = releaseState(true, null);
    expect(never.kind).toBe('blocked');
    expect(never.reason).toMatch(/signed/i);
  });

  it('leaves tenants who have not turned signing on exactly as they were', () => {
    expect(releaseState(false, null)).toMatchObject({ kind: 'draft', signed: false });
    expect(releaseState(false, { status: 'sent' })).toMatchObject({ kind: 'draft' });
  });
});

describe('docKindLabel', () => {
  it('names the kinds, and does not blow up on one it does not know', () => {
    expect(docKindLabel('share_certificate')).toBe('Share certificate');
    expect(docKindLabel('mystery')).toBe('Document');
  });
});


// ── The guarantee agreement kind ────────────────────────────────────────────
// A sacco-only kind, welded in the database to sacco_loan_guarantees by
// signing_requests_kind_source_chk. Everything below is a place where this file
// and 20260905160000_guarantee_agreement_signing.sql have to agree.
describe('guarantee_agreement', () => {
  it('points at the table the CHECK constraint demands', () => {
    // If this drifts, every send is refused by the database with a constraint
    // violation rather than anything a person could act on.
    expect(DOC_KINDS.guarantee_agreement.sourceTable).toBe('sacco_loan_guarantees');
  });

  it('is the only sacco-only kind', () => {
    expect(isSaccoOnlyKind('guarantee_agreement')).toBe(true);
    for (const k of ['share_certificate', 'settlement_certificate', 'asset_valuation', 'contract']) {
      expect(isSaccoOnlyKind(k)).toBe(false);
    }
    expect(isSaccoOnlyKind('mystery')).toBe(false);
  });

  it('puts the guarantor first, because they sign their own undertaking', () => {
    const panel = defaultPanelFor('guarantee_agreement');
    expect(panel[0].role).toBe(GUARANTOR_ROLE);
    expect(panel[0].order).toBe(1);
    // And somebody countersigns for the society: a guarantee nobody accepted
    // is not a guarantee.
    expect(panel.length).toBeGreaterThan(1);
  });

  it('is executed, never issued', () => {
    // "Issued" is a claim the society makes about its own paper. An agreement
    // is something the guarantor did, and the two must not be described alike.
    expect(signingVerdict('released', 'guarantee_agreement').label).toBe('Executed');
    expect(releaseWords('guarantee_agreement').issuedLabel).toBe('Executed');
    expect(releaseWords('guarantee_agreement').release).not.toMatch(/certificate/i);
  });

  it('leaves the vocabulary of every other kind alone', () => {
    expect(signingVerdict('released').label).toBe('Issued');
    expect(signingVerdict('released', 'share_certificate').label).toBe('Issued');
    expect(releaseWords('share_certificate').issuedLabel).toBe('Issued');
    expect(releaseWords(undefined).release).toBe('Issue certificate');
  });

  it('still reports the states it has no special word for', () => {
    expect(signingVerdict('sent', 'guarantee_agreement').label).toBe('Out for signature');
    expect(signingVerdict('teleported', 'guarantee_agreement').label).toBe('Unknown');
  });
});
