// Webhook signature boundary test — valid passes, tampered/missing fail.
// The receiver returns 401 on a bad signature and 2xx for data-level errors
// (feedback_data_level_errors_must_return_2xx); this asserts the crypto gate.
'use strict';
const crypto = require('node:crypto');
const { verifyHmac } = require('../src/routes/webhooks');

const SECRET = 'test-secret';
const body = Buffer.from(JSON.stringify({ type: 'ping', data: { n: 1 } }));
const sign = (s, b) => 'sha256=' + crypto.createHmac('sha256', s).update(b).digest('hex');

describe('verifyHmac', () => {
  test('valid signature → true', () => {
    expect(verifyHmac(SECRET, body, sign(SECRET, body))).toBe(true);
  });
  test('tampered body → false', () => {
    const tampered = Buffer.from(JSON.stringify({ type: 'ping', data: { n: 2 } }));
    expect(verifyHmac(SECRET, tampered, sign(SECRET, body))).toBe(false);
  });
  test('wrong secret → false', () => {
    expect(verifyHmac(SECRET, body, sign('other-secret', body))).toBe(false);
  });
  test('missing signature → false', () => {
    expect(verifyHmac(SECRET, body, undefined)).toBe(false);
  });
});
