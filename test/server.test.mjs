import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoServer } from '../server.mjs';
import { createTriggerBridge } from '../trigger-bridge/agent-trigger-bridge.mjs';

async function withServer(run, options) {
  const server = createDemoServer(options);
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

test('browser live request is limited to the manually prepared case and only calls the internal trigger bridge', async () => {
  const prior = Object.fromEntries(['DEMO_MODE', 'AGENT_TRIGGER_BRIDGE_URL', 'AGENT_TRIGGER_BRIDGE_TOKEN'].map((key) => [key, process.env[key]]));
  process.env.DEMO_MODE = 'hybrid';
  process.env.AGENT_TRIGGER_BRIDGE_URL = 'http://agent-trigger-bridge:7430';
  process.env.AGENT_TRIGGER_BRIDGE_TOKEN = 'bridge-test-token';
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ status: 'ACCEPTED', triggerId: '11111111-1111-1111-1111-111111111111', project: 'security-triage-agent', agent: 'triage-operator', flow: 'octobus', acceptedAt: '2026-08-25T00:00:00.000Z' }), { status: 202, headers: { 'content-type': 'application/json' } });
  };
  try {
    await withServer(async (base) => {
      const rejected = await fetch(`${base}/api/live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'security-normal', message: '任意提示词不能成为 Agent 指令' }) });
      assert.equal(rejected.status, 403);
      const accepted = await fetch(`${base}/api/live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'security-normal', message: '研判告警 A-1001：授权扫描时段的 DNS 活动' }) });
      assert.equal(accepted.status, 202);
      assert.equal((await accepted.json()).flow, 'octobus');
    }, { fetchImpl });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://agent-trigger-bridge:7430/trigger');
    assert.equal(calls[0].options.headers.authorization, 'Bearer bridge-test-token');
    assert.equal(calls[0].options.body, JSON.stringify({ caseId: 'security-normal' }));
  } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('internal trigger bridge uses a closed case map and execFile arguments', async () => {
  const calls = [];
  const bridge = createTriggerBridge({ token: 'bridge-token', execute: async (bin, args, options) => { calls.push({ bin, args, options }); return { stdout: JSON.stringify({ runId: 'run-12345678' }) }; }, now: () => '2026-08-25T00:00:00.000Z' });
  await new Promise((resolve) => bridge.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${bridge.address().port}`;
  try {
    assert.equal((await fetch(`${base}/trigger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'security-normal' }) })).status, 401);
    assert.equal((await fetch(`${base}/trigger`, { method: 'POST', headers: { authorization: 'Bearer bridge-token', 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'malware-normal' }) })).status, 403);
    const accepted = await fetch(`${base}/trigger`, { method: 'POST', headers: { authorization: 'Bearer bridge-token', 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'security-normal', prompt: 'ignored' }) });
    const body = await accepted.json();
    assert.equal(accepted.status, 202);
    assert.equal(body.flow, 'octobus');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'docker');
    assert.deepEqual(calls[0].args.slice(0, 9), ['exec', 'agent-compose', 'agent-compose', '--json', '-p', 'security-triage-agent', 'run', 'triage-operator', '--prompt']);
    assert.match(calls[0].args[9], /A-1001/);
    assert.equal(calls[0].args.includes('ignored'), false);
  } finally { await new Promise((resolve) => bridge.close(resolve)); }
});

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
