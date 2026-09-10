import { describe, it, expect } from 'vitest';
import {
  ACQUISITION_CHANNELS, ACQUISITION_CHANNEL_VALUES, channelMeta,
  REGISTRATION_SOURCES, REGISTRATION_SOURCE_VALUES, sourceMeta,
  isAwaitingActivation, signupLink,
} from './clientAcquisition';

/**
 * The vocabulary is a contract between four things that cannot see each other:
 * the public registration page that writes it, the admin client list that
 * renders it, the report builder that counts it, and a CHECK constraint in the
 * database that rejects anything else. A value that drifts out of step here
 * does not throw — it produces a report that is quietly missing a column, or an
 * insert that fails at 9pm on a Friday.
 */
describe('the channel vocabulary matches the database', () => {
  it('offers exactly the two values clients_acquisition_channel_chk accepts', () => {
    // Adding a value here means adding it to the CHECK constraint in
    // 20260830220000. This test is the reminder.
    expect(ACQUISITION_CHANNEL_VALUES).toEqual(['direct', 'agent']);
  });

  it('offers exactly the values clients_registration_source_chk accepts', () => {
    expect(REGISTRATION_SOURCE_VALUES)
      .toEqual(['staff', 'agent_portal', 'self_service', 'import']);
  });

  it('gives every entry a label, an icon and a tone', () => {
    [...ACQUISITION_CHANNELS, ...REGISTRATION_SOURCES].forEach((entry) => {
      expect(entry.label, entry.value).toBeTruthy();
      expect(entry.icon, entry.value).toBeTruthy();
      expect(entry.tone, entry.value).toBeTruthy();
    });
  });
});

describe('channelMeta', () => {
  it('describes the two known channels', () => {
    expect(channelMeta('direct').label).toBe('Direct');
    expect(channelMeta('agent').label).toBe('Sales agent');
    expect(channelMeta('agent').known).toBe(true);
  });

  it('keeps a value it has never heard of rather than dropping it', () => {
    // A client row that renders as nothing is a client the admin thinks they
    // do not have. Same reasoning as sourceMeta in crmVocabulary.
    const meta = channelMeta('walk_in_2019');
    expect(meta.label).toBe('Walk In 2019');
    expect(meta.known).toBe(false);
  });

  it('reads a missing channel as unrecorded, not as direct', () => {
    // 'direct' is a claim about how the customer was won. A row with nothing in
    // the column is a row nobody answered the question for, and quietly
    // counting it as direct would understate what the agents brought in.
    expect(channelMeta(null).label).toBe('Unrecorded');
    expect(channelMeta('').label).toBe('Unrecorded');
    expect(channelMeta(undefined).known).toBe(false);
  });
});

describe('sourceMeta', () => {
  it('names how the row came to exist', () => {
    expect(sourceMeta('self_service').label).toBe('Self-registered');
    expect(sourceMeta('agent_portal').label).toBe('Agent portal');
    expect(sourceMeta('staff').label).toBe('Entered by staff');
  });

  it('titles an unknown source rather than dropping it', () => {
    expect(sourceMeta('csv_dump').label).toBe('Csv Dump');
    expect(sourceMeta('csv_dump').known).toBe(false);
  });
});

describe('isAwaitingActivation', () => {
  const client = (over) => ({
    client_status: 'pending',
    registration_source: 'self_service',
    ...over,
  });

  it('is true for a self-registered client nobody has looked at', () => {
    expect(isAwaitingActivation(client())).toBe(true);
  });

  it('is false once the company activates them', () => {
    expect(isAwaitingActivation(client({ client_status: 'active' }))).toBe(false);
  });

  it('is false for an admin-invited client sitting at pending', () => {
    // This is the whole reason the helper exists rather than a `status ===
    // 'pending'` check: an invited client is also pending, and staff have
    // already met that person. Only the self-registered ones are strangers.
    expect(isAwaitingActivation(client({ registration_source: 'staff' }))).toBe(false);
    expect(isAwaitingActivation(client({ registration_source: 'agent_portal' }))).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(isAwaitingActivation(null)).toBe(false);
    expect(isAwaitingActivation(undefined)).toBe(false);
  });
});

describe('signupLink', () => {
  it('builds the link the registration page reads its code from', () => {
    expect(signupLink('K7M2PQR4', 'https://app.example.com'))
      .toBe('https://app.example.com/user-registration-screen?code=K7M2PQR4');
  });

  it('encodes and trims whatever it is handed', () => {
    // The code is read off a poster and pasted around; a stray space must not
    // produce a link that 404s.
    expect(signupLink('  AB CD  ', 'https://x.test'))
      .toBe('https://x.test/user-registration-screen?code=AB%20CD');
  });
});
