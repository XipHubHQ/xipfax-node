import { describe, expect, it } from 'vitest';
import { credentialShaped, strip } from './no-credentials.js';

describe('the environment every spec runs in', () => {
  it('holds no variable shaped like a credential or named for XipFax', () => {
    expect(Object.keys(process.env).filter(credentialShaped)).toEqual([]);
  });

  it('loses a key, a token and the XipFax variables, and keeps the rest', () => {
    const env = {
      XIPFAX_API_KEY: 'stand-in',
      XIPFAX_TO: '+1 202 555 0143',
      GITHUB_TOKEN: 'stand-in',
      PATH: '/usr/bin',
      HOME: '/home/someone',
    };

    expect(strip(env).sort()).toEqual(['GITHUB_TOKEN', 'XIPFAX_API_KEY', 'XIPFAX_TO']);
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/someone' });
  });
});
