import { describe, expect, it } from 'vitest';
import { detectConnectionKind, mobileOperatorFor, parseIp, type MobileRangesData } from './mobileNetwork';

const data: MobileRangesData = {
  operators: [
    { name: 'Київстар', v4: [['46.211.0.0', '46.211.63.255']], v6: [] },
    { name: 'lifecell', v4: [['37.73.0.0', '37.73.255.255']], v6: [['2a00:1e98::', '2a00:1e9f:ffff:ffff:ffff:ffff:ffff:ffff']] },
  ],
};

describe('parseIp', () => {
  it('IPv4, IPv6 і IPv4 усередині IPv6', () => {
    expect(parseIp('1.2.3.4')).toEqual({ v6: false, value: 0x01020304n });
    expect(parseIp('::1')).toEqual({ v6: true, value: 1n });
    expect(parseIp('2a00:1e98::5')?.value).toBe((0x2a001e98n << 96n) + 5n);
    expect(parseIp('::ffff:1.2.3.4')).toEqual({ v6: false, value: 0x01020304n });
  });
  it('не адреса → null', () => {
    expect(parseIp('')).toBeNull();
    expect(parseIp('300.1.1.1')).toBeNull();
    expect(parseIp('1:2:3')).toBeNull();
    expect(parseIp('1::2::3')).toBeNull();
    expect(parseIp('hello')).toBeNull();
  });
});

describe('mobileOperatorFor', () => {
  it('адреса в мобільному діапазоні оператора', () => {
    expect(mobileOperatorFor('46.211.10.20', data)).toBe('Київстар');
    expect(mobileOperatorFor('37.73.0.1', data)).toBe('lifecell');
    expect(mobileOperatorFor('2a00:1e9c:12::1', data)).toBe('lifecell');
  });
  it('межі діапазону включно, поза ним — ні', () => {
    expect(mobileOperatorFor('46.211.63.255', data)).toBe('Київстар');
    expect(mobileOperatorFor('46.211.64.0', data)).toBeNull();
    // Домашній інтернет Київстар (Golden Telecom FTTB) — не мобільний.
    expect(mobileOperatorFor('188.163.0.1', data)).toBeNull();
  });
  it('справжній список: мобільні пули операторів є', () => {
    // …mobile.kyivstar.net, …gprs.kyivstar.net
    expect(mobileOperatorFor('46.211.0.77')).toBe('Київстар');
    expect(mobileOperatorFor('81.23.18.77')).toBe('Київстар');
    // …mobile.vf-ua.net
    expect(mobileOperatorFor('46.133.0.77')).toBe('Vodafone');
    expect(mobileOperatorFor('178.133.0.77')).toBe('Vodafone');
    expect(mobileOperatorFor('37.73.0.1')).toBe('lifecell');
  });

  it('справжній список: домашній інтернет мобільних операторів — не мобільний', () => {
    // Київстар: …broadband.kyivstar.net (у RIPE підписано «Kyivstar GSM», але це домашній інтернет)
    for (const ip of ['94.153.0.77', '37.115.0.77', '37.229.0.77', '5.248.0.77', '134.249.0.77', '176.8.0.77', '178.137.0.77', '109.162.0.77', '46.185.0.77'])
      expect(mobileOperatorFor(ip), ip).toBeNull();
    // Київстар: …ip.kyivstar.net, Golden Telecom FTTB
    expect(mobileOperatorFor('94.153.128.77')).toBeNull();
    expect(mobileOperatorFor('188.163.0.1')).toBeNull();
    // Vodafone: статичні адреси …staticip.vf-ua.net
    expect(mobileOperatorFor('31.144.0.77')).toBeNull();
    // Datagroup-Volia (група lifecell) — домашній
    expect(mobileOperatorFor('77.120.0.1')).toBeNull();
  });
});

describe('detectConnectionKind', () => {
  it('мобільна IPv4 при немобільній IPv6 — однаково мобільний', () => {
    expect(detectConnectionKind(['2a02:8a8::1', '46.211.1.1'], undefined, data)).toEqual({
      kind: 'mobile',
      operator: 'Київстар',
      source: 'ip',
    });
  });
  it('браузер сам каже cellular', () => {
    expect(detectConnectionKind(['8.8.8.8'], 'cellular', data)).toEqual({ kind: 'mobile', operator: null, source: 'browser' });
  });
  it('звичайна адреса → other; жодної адреси → unknown', () => {
    expect(detectConnectionKind(['188.163.0.1', null], 'wifi', data)).toEqual({ kind: 'other' });
    expect(detectConnectionKind([null, null], undefined, data)).toEqual({ kind: 'unknown' });
    expect(detectConnectionKind(['garbage'], undefined, data)).toEqual({ kind: 'unknown' });
  });
});
