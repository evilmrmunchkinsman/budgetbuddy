'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createApp } = require('../server');
const mocks = require('../mocks');
const { createIntegration } = require('../integration');
const alerts = require('../sample-alerts.json');

const silent = { error() {}, warn() {}, log() {} };
const baseConfig = {
  nodeEnv: 'test',
  port: 0,
  useMocks: true,
  maxAlertLength: 1000,
  report: { largeSpendThreshold: 10000, duplicateWindowMinutes: 10, currency: 'INR' },
};

async function withServer(adapters, fn, config = baseConfig) {
  const app = createApp({ config, adapters, logger: silent });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await fn(url); } finally { await new Promise((r) => server.close(r)); }
}

const post = (url, body, raw = false) => fetch(`${url}/process-alert`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: raw ? body : JSON.stringify(body),
});

test('GET /health', async () => {
  await withServer(mocks, async (url) => {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', mode: 'mock' });
  });
});

test('POST /process-alert validates input', async () => {
  await withServer(mocks, async (url) => {
    for (const body of [{}, { alert: 123 }, { alert: '   ' }, { alert: 'x'.repeat(1001) }, [1, 2]]) {
      const res = await post(url, body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
      assert.equal((await res.json()).error.code, 'INVALID_REQUEST');
    }
    const bad = await post(url, '{not json', true);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'INVALID_JSON');
  });
});

test('unknown route returns JSON 404', async () => {
  await withServer(mocks, async (url) => {
    const res = await fetch(`${url}/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'NOT_FOUND');
  });
});

test('agent failure becomes a clean 500 without leaking internals in production', async () => {
  const adapters = { processAlert: async () => { throw new Error('secret stack detail'); }, getAllTransactions: async () => [] };
  await withServer(adapters, async (url) => {
    const res = await post(url, { alert: 'hello' });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error.code, 'AGENT_ERROR');
    assert.equal(body.error.details, undefined);
  }, { ...baseConfig, nodeEnv: 'production' });
});

test('full flow with sample alerts: report shows categories, duplicates and large spends', async () => {
  mocks.reset();
  await withServer(mocks, async (url) => {
    for (const a of alerts) {
      const res = await post(url, { alert: a.message });
      assert.equal(res.status, 200, `${a.id} failed`);
    }
    const report = await (await fetch(`${url}/report`)).json();
    assert.ok(report.spendingByCategory.length >= 5);
    assert.equal(report.totals.creditCount, 2);
    assert.equal(report.flaggedSummary.duplicates, 3);
    assert.equal(report.flaggedSummary.largeSpends, 3);
    assert.equal(report.skipped.length, 0);
    const largeMerchants = report.flagged.filter((f) => f.flags.some((x) => x.type === 'large_spend')).map((f) => f.merchant).sort();
    assert.deepEqual(largeMerchants, ['Gold Leaf Jewellers', 'Skyline Airways', 'TechNest Electronics']);
  });
  mocks.reset();
});

test('real integration returns 503 when Group 1/2 modules are missing', async () => {
  const missing = createIntegration({
    agentPath: path.join(__dirname, 'does-not-exist-agent.js'),
    dbPath: path.join(__dirname, 'does-not-exist-db.js'),
  });
  await withServer(missing, async (url) => {
    const a = await post(url, { alert: 'Rs.10 debited at X' });
    assert.equal(a.status, 503);
    assert.equal((await a.json()).error.code, 'MODULE_UNAVAILABLE');
    const r = await fetch(`${url}/report`);
    assert.equal(r.status, 503);
  });
});
