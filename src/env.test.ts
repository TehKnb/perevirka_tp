import { describe, expect, it } from 'vitest';
import { getSupportProblem, isMobileDevice } from './env';

const UA = {
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

describe('isMobileDevice', () => {
  it('ПК з Windows (навіть сенсорний) — не мобільний', () => {
    expect(isMobileDevice({ userAgent: UA.winChrome, maxTouchPoints: 10 })).toBe(false);
  });
  it('Mac без сенсора — не мобільний', () => {
    expect(isMobileDevice({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe(false);
  });
  it('iPad, що видає себе за Mac — мобільний', () => {
    expect(isMobileDevice({ userAgent: UA.macSafari, maxTouchPoints: 5 })).toBe(true);
  });
  it('iPhone — мобільний', () => {
    expect(isMobileDevice({ userAgent: UA.iphone, maxTouchPoints: 5 })).toBe(true);
  });
  it('Android-планшет — мобільний', () => {
    expect(isMobileDevice({ userAgent: UA.androidTablet, maxTouchPoints: 5 })).toBe(true);
  });
  it('userAgentData.mobile має пріоритет', () => {
    expect(isMobileDevice({ userAgent: UA.winChrome, uaDataMobile: true, maxTouchPoints: 0 })).toBe(true);
  });
});

describe('getSupportProblem', () => {
  it('не HTTPS', () => {
    expect(getSupportProblem({ isSecureContext: false, hasGetUserMedia: false })).toBe('insecure');
  });
  it('старий браузер', () => {
    expect(getSupportProblem({ isSecureContext: true, hasGetUserMedia: false })).toBe('unsupported');
  });
  it('усе гаразд', () => {
    expect(getSupportProblem({ isSecureContext: true, hasGetUserMedia: true })).toBeNull();
  });
});
