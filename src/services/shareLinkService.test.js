import { describe, it, expect, vi, beforeEach } from 'vitest';

// The service talks to Supabase for the two RPCs; everything else is pure.
const rpc = vi.fn();
const invoke = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpc(...args),
    functions: { invoke: (...args) => invoke(...args) },
  },
}));

const {
  toWhatsAppNumber, buildShareMessage, whatsappHref, smsHref,
  listingUrl, createShareLink, revokeShareLink, emailShareLink,
} = await import('./shareLinkService');

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
});

describe('toWhatsAppNumber', () => {
  it('turns a local Kenyan number into the msisdn wa.me needs', () => {
    // wa.me rejects a leading 0 and a leading +, so both have to go.
    expect(toWhatsAppNumber('0712345678')).toBe('254712345678');
    expect(toWhatsAppNumber('0712 345 678')).toBe('254712345678');
    expect(toWhatsAppNumber('+254712345678')).toBe('254712345678');
    expect(toWhatsAppNumber('254712345678')).toBe('254712345678');
  });

  it('adds the country code to a bare nine-digit number', () => {
    expect(toWhatsAppNumber('712345678')).toBe('254712345678');
    expect(toWhatsAppNumber('112345678')).toBe('254112345678');
  });

  it('leaves an already-international number alone', () => {
    expect(toWhatsAppNumber('+44 7700 900123')).toBe('447700900123');
  });

  it('returns null when there is nothing usable, so the caller can hide the channel', () => {
    expect(toWhatsAppNumber('')).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
    expect(toWhatsAppNumber('12345')).toBeNull();
  });
});

describe('buildShareMessage', () => {
  it('leads with the listing and ends with the link and the agent', () => {
    const msg = buildShareMessage({
      agentName: 'Jane Doe',
      assetTitle: '3-Bedroom Apartment — Westlands',
      price: 8500000,
      location: 'Nairobi',
      url: 'https://app.example.com/listing/abc123',
      note: 'Thought of you.',
    });

    expect(msg).toContain('*3-Bedroom Apartment — Westlands*');
    expect(msg).toContain('Nairobi');
    expect(msg).toContain('Thought of you.');
    expect(msg).toContain('https://app.example.com/listing/abc123');
    expect(msg.trimEnd().endsWith('— Jane Doe')).toBe(true);
  });

  it('skips the parts it was not given rather than printing blanks', () => {
    const msg = buildShareMessage({ assetTitle: 'Toyota Hilux', url: 'https://x.test/listing/t' });
    expect(msg).toContain('Toyota Hilux');
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('null');
  });
});

describe('link hrefs', () => {
  it('url-encodes the message so a multi-line body survives', () => {
    const href = whatsappHref('0712345678', 'Line one\nLine two');
    expect(href).toBe('https://wa.me/254712345678?text=Line%20one%0ALine%20two');
  });

  it('falls back to the chooser when there is no usable number', () => {
    expect(whatsappHref('', 'hi')).toBe('https://wa.me/?text=hi');
  });

  it('builds an sms: href with the body encoded', () => {
    expect(smsHref('0712345678', 'a&b')).toBe('sms:0712345678?body=a%26b');
  });
});

describe('listingUrl', () => {
  it('points at the public route on the current origin', () => {
    // jsdom serves http://localhost by default.
    expect(listingUrl('tok_123')).toBe(`${window.location.origin}/listing/tok_123`);
  });

  it('is empty without a token, so nothing renders a half-built link', () => {
    expect(listingUrl(null)).toBe('');
  });
});

describe('createShareLink', () => {
  it('passes the share through to the RPC and returns the public url', async () => {
    rpc.mockResolvedValue({ data: { id: 'l-1', token: 'tok_abc' }, error: null });

    const { link, url } = await createShareLink({
      assetId: 'asset-1',
      leadId: 'lead-1',
      recipientName: 'Alice',
      recipientPhone: '0712345678',
      channel: 'whatsapp',
      note: 'Have a look',
      expiresDays: 7,
    });

    expect(rpc).toHaveBeenCalledWith('create_asset_share_link', {
      p_asset_id: 'asset-1',
      p_lead_id: 'lead-1',
      p_recipient_name: 'Alice',
      p_recipient_phone: '0712345678',
      p_recipient_email: null,
      p_channel: 'whatsapp',
      p_note: 'Have a look',
      p_expires_days: 7,
    });
    expect(link.token).toBe('tok_abc');
    expect(url).toBe(`${window.location.origin}/listing/tok_abc`);
  });

  it('unwraps the row when PostgREST returns the composite as an array', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'l-2', token: 'tok_xyz' }], error: null });
    const { link } = await createShareLink({ assetId: 'asset-2' });
    expect(link.token).toBe('tok_xyz');
  });

  it('refuses without an asset, before it ever reaches the database', async () => {
    await expect(createShareLink({})).rejects.toThrow(/Pick an item/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces the database refusal — a wrong-tenant asset must not look like success', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'That item is not in your catalogue.' } });
    await expect(createShareLink({ assetId: 'someone-elses' }))
      .rejects.toThrow('That item is not in your catalogue.');
  });
});

describe('revokeShareLink', () => {
  it('reports true only when the database actually revoked a row', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(revokeShareLink('l-1')).resolves.toBe(true);

    // The RPC returns false for a link belonging to another agent.
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(revokeShareLink('not-mine')).resolves.toBe(false);
  });
});

describe('emailShareLink', () => {
  it('sends through the listing_share template with the public url', async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });

    await emailShareLink({
      to: 'buyer@example.com',
      recipientName: 'Alice',
      agentName: 'Jane Doe',
      assetName: 'Plot in Ruiru',
      price: 2500000,
      url: 'https://x.test/listing/tok',
    });

    expect(invoke).toHaveBeenCalledWith('send-email', {
      body: expect.objectContaining({
        type: 'listing_share',
        to: 'buyer@example.com',
        data: expect.objectContaining({ listingUrl: 'https://x.test/listing/tok' }),
      }),
    });
  });

  it('tells the agent to send it themselves when the mailer fails', async () => {
    // The link already exists at this point — losing the email must not read
    // as losing the link.
    invoke.mockResolvedValue({ data: null, error: { message: 'relay down' } });
    await expect(emailShareLink({ to: 'a@b.com', url: 'https://x.test/listing/t' }))
      .rejects.toThrow(/Copy it and send it yourself/i);
  });
});
