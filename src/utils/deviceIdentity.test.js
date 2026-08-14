import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyDeviceType,
  slotForType,
  describeDevice,
  getDeviceId,
  DEVICE_ID_STORAGE_KEY,
} from './deviceIdentity';

// Real-world strings — the classifier's whole job is telling these apart, so
// paraphrasing them would test nothing.
const UA = {
  iphone:        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidPhone:  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  ipad:          'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  windows:       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  mac:           'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  firefoxLinux:  'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
  edgeWindows:   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
};

describe('classifyDeviceType', () => {
  it('reads phones as phones', () => {
    expect(classifyDeviceType(UA.iphone)).toBe('phone');
    expect(classifyDeviceType(UA.androidPhone)).toBe('phone');
  });

  it('reads tablets as tablets, not phones', () => {
    // An iPad's Safari UA also carries "Mobile", and an Android tablet is an
    // Android UA *without* it — both are why tablets are tested first.
    expect(classifyDeviceType(UA.ipad)).toBe('tablet');
    expect(classifyDeviceType(UA.androidTablet)).toBe('tablet');
  });

  it('reads desktops and laptops as laptops', () => {
    expect(classifyDeviceType(UA.windows)).toBe('laptop');
    expect(classifyDeviceType(UA.mac)).toBe('laptop');
    expect(classifyDeviceType(UA.firefoxLinux)).toBe('laptop');
  });

  it('falls back to laptop when there is no user agent', () => {
    expect(classifyDeviceType('')).toBe('laptop');
    expect(classifyDeviceType(null)).toBe('laptop');
  });
});

describe('slotForType', () => {
  it('gives the phone its own slot', () => {
    expect(slotForType('phone')).toBe('mobile');
  });

  it('makes a laptop and a tablet compete for the same slot', () => {
    // This is the rule: one phone, and ONE laptop-or-tablet — not one of each.
    expect(slotForType('laptop')).toBe('computer');
    expect(slotForType('tablet')).toBe('computer');
  });
});

describe('describeDevice', () => {
  it('names the browser and the operating system', () => {
    expect(describeDevice(UA.windows)).toBe('Chrome on Windows');
    expect(describeDevice(UA.edgeWindows)).toBe('Edge on Windows');
    expect(describeDevice(UA.iphone)).toBe('Safari on iOS');
    expect(describeDevice(UA.firefoxLinux)).toBe('Firefox on Linux');
  });

  it('does not invent a name when there is no user agent', () => {
    expect(describeDevice('')).toBe('Unknown device');
  });
});

describe('getDeviceId', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('mints an id once and reuses it', () => {
    const first = getDeviceId();
    expect(first).toBeTruthy();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(getDeviceId()).toBe(first);
    expect(window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(first);
  });

  it('replaces an id the server would reject as malformed', () => {
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, 'short');
    const id = getDeviceId();
    expect(id).not.toBe('short');
    expect(id.length).toBeGreaterThanOrEqual(8);
  });
});
