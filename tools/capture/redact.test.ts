import { describe, expect, it } from 'vitest';
import { REDACTED, redactBody, redactHeaders, redactUrl, redactValue } from './redact.ts';

describe('capture redaction', () => {
  it('drops auth headers and cookies', () => {
    expect(redactHeaders({ Cookie: 'a=b', 'x-csrf-token': 't', accept: 'json' })).toEqual({ Cookie: REDACTED, 'x-csrf-token': REDACTED, accept: 'json' });
  });

  it('redacts secret and personal keys at any depth, plus stray emails and card numbers', () => {
    expect(redactValue({ user: { Email: 'a@b.co', password: 'x', id: 7 }, note: '4242 4242 4242 4242', other: 'me@example.com' })).toEqual({
      user: { Email: REDACTED, password: REDACTED, id: 7 },
      note: REDACTED,
      other: REDACTED,
    });
  });

  it('redacts form bodies and query strings', () => {
    expect(redactBody('Username=me&Password=pw&slot=3', 'application/x-www-form-urlencoded')).toEqual({ Username: 'me', Password: REDACTED, slot: '3' });
    expect(redactUrl('https://x.test/cb?code=1&access_token=abc')).toBe('https://x.test/cb?code=1&access_token=%5Bredacted%5D');
  });
});
