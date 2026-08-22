import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer } from '../server.mjs';

async function withServer(run) {
  const server = createDemoServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('serves replay cases without sample material and exposes metrics', async () => withServer(async (base) => {
  const cases = await fetch(`${base}/api/cases`).then((response) => response.json());
  assert.equal(cases.length, 10);
  assert.equal(JSON.stringify(cases).includes('apk_base64'), false);
  assert.equal(JSON.stringify(cases).includes('203.0.113.77'), false);
  assert.ok(cases.some((item) => item.domain === 'security' && item.id === 'security-normal'));
  const result = await fetch(`${base}/api/replay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'malware-normal' }) }).then((response) => response.json());
  assert.equal(result.outcome, 'HUMAN_REVIEW_REQUIRED');
  assert.ok(result.traceId.startsWith('demo-'));
  assert.deepEqual(result.octobus, { service: 'malware-analysis-service', instance: 'malware-analysis-demo', capset: 'malware-analysis' });
  assert.equal(result.audit[0].traceId, result.traceId);
  assert.equal(result.llm.status, 'OK · schema validated');
  const metrics = await fetch(`${base}/metrics`).then((response) => response.text());
  assert.match(metrics, /chaitin_demo_replay_total\{domain="malware"\} 1/);
}));

test('only returns a safe optional Portainer navigation URL', async () => {
  const prior = process.env.PORTAINER_URL;
  process.env.PORTAINER_URL = 'javascript:alert(1)';
  await withServer(async (base) => {
    const config = await fetch(`${base}/api/config`).then((response) => response.json());
    assert.equal(config.portainerUrl, '');
  });
  if (prior === undefined) delete process.env.PORTAINER_URL; else process.env.PORTAINER_URL = prior;
});

test('does not expose a live backend bridge by default', async () => withServer(async (base) => {
  const response = await fetch(`${base}/api/live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error, 'live_mode_not_enabled');
}));
