// Redaction for captures. Conservative: anything that looks like a secret or
// personal detail is replaced, and payment hosts are recorded by URL only.

const SECRET_KEY = /pass|card|cvc|cvv|expir|token|secret|auth|session|cookie|csrf|xsrf|email|phone|mobile|first.?name|last.?name|surname|full.?name|address|postcode|zip|dob|birth|iban|sort.?code|account/i;
const DROP_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization|x-.*(token|csrf|xsrf|auth).*)$/i;
export const PAYMENT_HOST = /stripe\.com|stripe\.network|adyen|braintree|paypal|worldpay|sagepay|opayo|3ds|acs|secure.?code|verified.?by/i;

export const REDACTED = '[redacted]';

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = DROP_HEADER.test(k) ? REDACTED : v;
  return out;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 50) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(value)) return REDACTED; // stray email
  if (typeof value === 'string' && /\b(?:\d[ -]?){13,19}\b/.test(value)) return REDACTED; // card-like digits
  return value;
}

export function redactUrl(raw: string): string {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_KEY.test(key)) url.searchParams.set(key, REDACTED);
  }
  return url.toString();
}

/** Form, JSON or opaque body → something safe to keep. */
export function redactBody(body: string | null, contentType: string): unknown {
  if (body === null || body === '') return null;
  if (contentType.includes('json')) {
    try {
      return redactValue(JSON.parse(body));
    } catch {
      return REDACTED;
    }
  }
  if (contentType.includes('x-www-form-urlencoded')) {
    const params = new URLSearchParams(body);
    const out: Record<string, string> = {};
    for (const [k, v] of params) out[k] = SECRET_KEY.test(k) ? REDACTED : String(redactValue(v));
    return out;
  }
  return `[${body.length} bytes of ${contentType || 'unknown'} omitted]`;
}
