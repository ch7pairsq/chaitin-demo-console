import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoServer } from '../server.mjs';

async function withServer(run) {
  const server = createDemoServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('serves replay cases without sample material and exposes metrics', async () => withServer(async (base) => {
  const cases = await fetch(`${base}/api/cases`).then((response) => response.json());
  assert.equal(cases.length, 12);
  assert.equal(JSON.stringify(cases).includes('apk_base64'), false);
  assert.equal(JSON.stringify(cases).includes('203.0.113.77'), false);
  assert.ok(cases.some((item) => item.domain === 'security' && item.id === 'security-normal'));
  const result = await fetch(`${base}/api/replay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'malware-normal' }) }).then((response) => response.json());
  assert.equal(result.outcome, 'HUMAN_REVIEW_REQUIRED');
  assert.ok(result.traceId.startsWith('demo-'));
  assert.deepEqual(result.octobus, { service: 'malware-analysis-service', instance: 'malware-analysis-demo', capset: 'malware-analysis' });
  assert.equal(result.audit[0].traceId, result.traceId);
  assert.equal(result.llm.status, 'OK · schema validated');
  assert.equal(result.knowledgeProof.provenance.ruleId, 'local-rag / candidate-yara gate');
  assert.match(result.knowledgeProof.ablation.verdict, /RAG/);
  const privateEvidence = await fetch(`${base}/api/replay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'security-ioc' }) }).then((response) => response.json());
  assert.equal(privateEvidence.knowledgeProof.provenance.ruleId, 'threat-evidence / APT_IP');
  assert.equal(JSON.stringify(privateEvidence.knowledgeProof).includes('203.0.113.77'), false);
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

test('keeps knowledge proof in the top-level dialog instead of the trace tabs', () => {
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(page, /data-dialog-target="proof-dialog"/);
  assert.match(page, /id="proof-dialog"/);
  assert.doesNotMatch(page, /data-tab="proof"/);
  assert.doesNotMatch(page, /id="guide-dialog"/);
});

test('release endpoint is strict and defaults to a non-mutating preview', async () => withServer(async (base) => {
  const invalid = await fetch(`${base}/api/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'anything', commit: 'x' }) });
  assert.equal(invalid.status, 400);
  const preview = await fetch(`${base}/api/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'security-triage-agent', commit: 'a'.repeat(40) }) });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).status, 'PREVIEW');
  const latestMain = await fetch(`${base}/api/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'malware-triage-agent', target: 'main' }) });
  const latestMainBody = await latestMain.json();
  assert.equal(latestMain.status, 200);
  assert.equal(latestMainBody.status, 'PREVIEW');
  assert.equal(latestMainBody.plan.target, 'remote_main_latest');
  assert.match(latestMainBody.plan.commit, /完整 SHA-1/);
}));

test('release preview never calls a runner even when formal release is enabled', async () => {
  const prior = Object.fromEntries(['RELEASE_MODE', 'RELEASE_RUNNER_URL', 'RELEASE_RUNNER_TOKEN', 'RELEASE_UI_CONFIRMATION'].map((key) => [key, process.env[key]]));
  process.env.RELEASE_MODE = 'enabled';
  process.env.RELEASE_RUNNER_URL = 'http://release-runner:7420';
  process.env.RELEASE_RUNNER_TOKEN = 'runner-test-token';
  process.env.RELEASE_UI_CONFIRMATION = 'confirmation-test-token';
  try {
    await withServer(async (base) => {
      const preview = await fetch(`${base}/api/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'security-triage-agent', commit: 'b'.repeat(40), execute: false }) });
      assert.equal(preview.status, 200);
      assert.equal((await preview.json()).status, 'PREVIEW');
      const release = await fetch(`${base}/api/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'security-triage-agent', commit: 'b'.repeat(40), execute: true, confirmation: 'wrong' }) });
      assert.equal(release.status, 403);
    });
  } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
