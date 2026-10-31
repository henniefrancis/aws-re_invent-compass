import { describe, expect, test } from 'vitest';
import { walletForDevice } from '../../src/lib/board/device';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
const IPOD =
  'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPAD_OLD =
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
// iPadOS 13 and later ask for the desktop site and report a Mac, with touch points.
const IPADOS_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DESKTOP_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0';
const DESKTOP_SAFARI = IPADOS_AS_MAC;

describe('walletForDevice', () => {
  test('an iPhone or iPod shows only Apple Wallet, in Safari and in Chrome', () => {
    for (const userAgent of [IPHONE_SAFARI, IPHONE_CHROME, IPOD]) {
      expect(walletForDevice({ userAgent })).toBe('apple');
    }
  });

  test('an Android phone shows only Google Wallet, with or without client hints', () => {
    for (const userAgent of [ANDROID_CHROME, SAMSUNG, ANDROID_FIREFOX]) {
      expect(walletForDevice({ userAgent })).toBe('google');
    }
    expect(walletForDevice({ userAgent: ANDROID_CHROME, platform: 'Android', mobile: true })).toBe(
      'google',
    );
  });

  test('client hints that say a tablet or another system win over the user agent text', () => {
    expect(walletForDevice({ userAgent: ANDROID_CHROME, platform: 'Android', mobile: false })).toBe(
      'both',
    );
    expect(walletForDevice({ userAgent: ANDROID_CHROME, platform: 'Windows', mobile: false })).toBe(
      'both',
    );
  });

  test('computers, iPads (even one that reports a Mac), Android tablets and unknowns show both', () => {
    for (const userAgent of [
      DESKTOP_CHROME,
      DESKTOP_FIREFOX,
      DESKTOP_SAFARI,
      IPADOS_AS_MAC,
      IPAD_OLD,
      ANDROID_TABLET,
      '',
      'curl/8.0',
    ]) {
      expect(walletForDevice({ userAgent })).toBe('both');
    }
  });

  test('nothing to read (a prerender) shows both', () => {
    expect(walletForDevice()).toBe('both');
    expect(walletForDevice({})).toBe('both');
  });
});
