'use strict';
// Credential-redaction guard for the pino logger.
//
// History this test exists to prevent repeating:
//  1. The redact list had `'*.key'` and the live 64-char FORUM_AUTOMATION_KEY
//     still reached CloudWatch in cleartext — pino's `*` is a SINGLE-LEVEL glob,
//     so it never matched `x-forum-automation-key`.
//  2. The previous version of THIS FILE hid that. It asserted `data.key` was
//     redacted — a property literally named `key`, the one shape `*.key` does
//     handle — so the suite proved the wildcard worked in the only case that did
//     not matter. A check that could not fail.
//  3. The first fix enumerated credential headers explicitly and STILL missed
//     `x-signature-256`. Hence the allowlist: the headline test below is that an
//     unknown header is redacted by default.
//  4. pino-http OVERRIDES the base logger's serializers, so wiring the allowlist
//     into pino() instead of pinoHttp() would be silently inert. That is
//     asserted end-to-end through a real HTTP request, not by unit-calling the
//     serializer.
const express = require('express');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { Writable } = require('stream');
const fs = require('fs');
const path = require('path');
const logRedact = require('../src/lib/logRedact');

const SENTINEL = 'a'.repeat(64); // stands in for a live 64-char credential

function sink() {
  const chunks = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  stream.text = () => chunks.join('');
  return stream;
}

// Drives the REAL wiring: base logger + pinoHttp with the exported serializers,
// exercised by a real request. If the serializers stop taking effect, this fails.
async function roundtrip(headers) {
  const out = sink();
  const logger = pino({ redact: logRedact.redact }, out);
  const app = express();
  app.use(pinoHttp({ logger, serializers: logRedact.serializers }));
  app.get('/probe', (_q, res) => res.set('set-cookie', `s=${SENTINEL}`).json({ ok: true }));

  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  await fetch(`http://127.0.0.1:${srv.address().port}/probe`, { headers });
  await new Promise((r) => setTimeout(r, 50));
  srv.close();
  return out.text();
}

describe('log redaction — allowlist behaviour', () => {
  // THE headline property. A denylist cannot pass this test; that is the point.
  it('redacts a header nobody has ever classified (fail-closed)', async () => {
    const text = await roundtrip({ 'x-some-header-invented-tomorrow': SENTINEL });
    expect(text).not.toContain(SENTINEL);
    expect(text).toContain('[REDACTED]');
  });

  // Every credential-bearing header found in the 2026-08-01 fleet sweep. These
  // are covered by the allowlist automatically; listing them means a failure
  // names the specific header rather than just "something leaked".
  const CREDENTIAL_HEADERS = [
    'x-forum-automation-key',
    'x-satellite-token',
    'x-satellite-refresh',
    'x-hubport-signature',
    'x-salesport-signature',
    'x-opsport-signature',
    'x-reviewport-signature',
    'x-bugreport-signature',
    'x-twilio-email-event-webhook-signature',
    'x-signature-256',
    'authorization',
    'cookie',
  ];

  it.each(CREDENTIAL_HEADERS)('redacts %s', async (header) => {
    const text = await roundtrip({ [header]: SENTINEL });
    expect(text).not.toContain(SENTINEL);
  });

  // Over-redaction is a real regression: losing these blinds log-sweep and makes
  // cross-app requests untraceable.
  it('preserves the headers needed for tracing and debugging', async () => {
    const keep = {
      'x-correlation-id': 'corr-123',
      'x-satellite-id': 'salesport',
      'x-lifecycle-event-id': 'evt-456',
      'user-agent': 'probe-agent',
    };
    const text = await roundtrip(keep);
    for (const v of Object.values(keep)) expect(text).toContain(v);
  });

  it('still logs method and url', async () => {
    const text = await roundtrip({});
    expect(text).toContain('"method":"GET"');
    expect(text).toContain('/probe');
  });

  it('redacts set-cookie on the response', async () => {
    const text = await roundtrip({});
    expect(text).not.toContain(SENTINEL);
    // Positive control, and it is load-bearing. Without it this test passed for
    // a reason that had nothing to do with redaction: the res serializer was
    // emitting NO response headers at all, so "the sentinel is absent" was true
    // by vacuity. Assert a header we deliberately keep, so the absence above
    // means "redacted" rather than "nothing was logged".
    expect(text).toContain('content-type');
  });

  // pino-http wraps a custom serializer in wrapResponseSerializer/
  // wrapRequestSerializer (pino-http/logger.js:33-34), which run the std
  // serializer FIRST and hand us the result. Calling pino.stdSerializers.res()
  // on that already-serialized object a second time re-reads fields that only
  // exist on the raw ServerResponse — headersSent, getHeaders — finds none, and
  // returns statusCode: null with the headers gone.
  //
  // That shipped to prod on 2026-08-01 and every access log line in the fleet
  // has read "res":{"statusCode":null} since. Verified against a real
  // /ecs/opsport-api line on 2026-09-02. Nothing failed, which is exactly why it
  // lasted: no alarm keys on a field that is always null.
  it('keeps res.statusCode — the field every alarm and log sweep reads', async () => {
    const text = await roundtrip({});
    expect(text).toContain('"statusCode":200');
    expect(text).not.toContain('"statusCode":null');
  });

  it('keeps req.remoteAddress — the peer address, when there is no x-forwarded-for', async () => {
    // Second casualty of the same double-serialization: stdSerializers.req
    // computes remoteAddress from req.info/req.socket, neither of which survives
    // the first pass. A request arriving without x-forwarded-for left nothing to
    // attribute it to.
    const text = await roundtrip({});
    expect(text).toContain('remoteAddress');
  });
});

describe('log redaction — base redact (non-header payloads)', () => {
  // Renamed: this only ever covered the NESTED shape. `*.token` is a
  // single-level glob, so `data.token` is exactly the case it does handle —
  // and the old name ("bare token/secret/key") claimed the one case it did not.
  it('redacts password and NESTED token/secret/key fields on logged objects', () => {
    const out = sink();
    const log = pino({ redact: logRedact.redact }, out);
    log.info({ password: 'pw-raw', data: { token: 'tok-raw', secret: 'sec-raw', key: 'key-raw' } }, 'x');
    const text = out.text();
    for (const v of ['pw-raw', 'tok-raw', 'sec-raw', 'key-raw']) expect(text).not.toContain(v);
    expect(text).toContain('[REDACTED]');
  });

  // The shape the block above does NOT reach. pino's `*` matches a property
  // exactly ONE level below root, so `*.token` covers `data.token` and never a
  // top-level `{ token }`. `password` survives only because it is a literal
  // path, not a glob. Literal 'token'/'secret'/'key' paths are what close this.
  it('redacts TOP-LEVEL bare token/secret/key fields on logged objects', () => {
    const out = sink();
    const log = pino({ redact: logRedact.redact }, out);
    log.info({ token: 'tok-top', secret: 'sec-top', key: 'key-top' }, 'x');
    const text = out.text();
    for (const v of ['tok-top', 'sec-top', 'key-top']) expect(text).not.toContain(v);
    // Positive control. A "value absent" assertion also passes when nothing was
    // logged at all, so the redaction must be observed FIRING, not just inferred
    // from an absence.
    expect(text).toContain('[REDACTED]');
  });
});

describe('log redaction — wiring', () => {
  // pino-http overrides base-logger serializers, so the allowlist is only live
  // if app.js passes it to pinoHttp(). Guard the wiring itself: removing it
  // would otherwise leave every test above passing while prod leaks.
  // Returns the source of the whole `pinoHttp( ... )` call, brace-matched. The
  // previous version sliced to the first '}))', which is fragile, and asserted
  // only `toContain('serializers')`, which is not enough — see below.
  function pinoHttpCall() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
    const i = src.indexOf('pinoHttp(');
    if (i < 0) throw new Error('no pinoHttp( call in app.js');
    let depth = 0;
    for (let k = i; k < src.length; k += 1) {
      if (src[k] === '(') depth += 1;
      else if (src[k] === ')') { depth -= 1; if (depth === 0) return src.slice(i, k); }
    }
    throw new Error('unbalanced pinoHttp( call');
  }

  it('app.js passes the logRedact serializers to pinoHttp', () => {
    expect(pinoHttpCall()).toContain('logRedact.serializers');
  });

  // Count the key, don't just look for the word. On 2026-08-01 the allowlist
  // fan-out added a SECOND `serializers:` key to salesport's pinoHttp call; a
  // duplicate key in an object literal silently overrides the first, so the
  // allowlist was dead there — and `toContain('serializers')` passed anyway,
  // precisely BECAUSE there were two. eslint's no-dupe-keys catches this, but
  // only in the repos that actually have a lint script.
  it('app.js declares exactly one serializers key on pinoHttp (a second silently overrides the first)', () => {
    expect(pinoHttpCall().match(/\bserializers\s*:/g) || []).toHaveLength(1);
  });

  it('logger.js applies the redact config', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'logger.js'), 'utf8');
    expect(src).toMatch(/redact/);
  });
});
