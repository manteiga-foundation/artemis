import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getState, setState } from '../src/store';
import { normalizeTarget, hostOf } from '../src/target';
import { controller, installFakeWindow, restoreWindow } from './harness';
import { engageConsole } from '../src/session';

const initialState = getState();

beforeEach(() => {
  installFakeWindow();
  controller.main = null;
  setState(initialState);
});
afterEach(() => {
  setState(initialState);
  restoreWindow();
});

describe('the website under review', () => {
  test('bare domains and paths are completed to https URLs', () => {
    expect(normalizeTarget('example.com')).toBe('https://example.com/');
    expect(normalizeTarget('  shop.example.co.uk/checkout/step-2  ')).toBe('https://shop.example.co.uk/checkout/step-2');
    expect(normalizeTarget('http://localhost:3000/app')).toBe('http://localhost:3000/app');
    expect(normalizeTarget('HTTPS://Example.com')).toBe('https://example.com/');
  });

  test('anything that is not a web address is rejected', () => {
    expect(normalizeTarget('')).toBeNull();
    expect(normalizeTarget('   ')).toBeNull();
    expect(normalizeTarget('not a url')).toBeNull();
    expect(normalizeTarget('ftp://files.example.com')).toBeNull();
    expect(normalizeTarget('javascript:alert(1)')).toBeNull();
    expect(normalizeTarget('example')).toBeNull();
  });

  test('hostOf gives the display host', () => {
    expect(hostOf('https://shop.example.co.uk/checkout')).toBe('shop.example.co.uk');
    expect(hostOf('http://localhost:3000/app')).toBe('localhost:3000');
  });
});

describe('engaging the console', () => {
  test('starts the console on the given website and announces it', () => {
    expect(getState().engaged).toBe(false);
    expect(getState().targetUrl).toBeNull();
    const ok = engageConsole('example.com');
    expect(ok).toBe(true);
    expect(getState().engaged).toBe(true);
    expect(getState().targetUrl).toBe('https://example.com/');
    expect(getState().status).toBe('Console online. Reviewing example.com.');
    expect(getState().statusTone).toBe('ok');
  });

  test('refuses to start without a valid website', () => {
    const ok = engageConsole('nope');
    expect(ok).toBe(false);
    expect(getState().engaged).toBe(false);
    expect(getState().targetUrl).toBeNull();
  });
});
