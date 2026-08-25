import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const port = Number(process.env.AGENT_TRIGGER_BRIDGE_PORT || 7430);

// This is deliberately a closed map. Browser text is never used as a shell
// command or forwarded as a free-form prompt to the Agent. Every UI case gets
// a real Agent Compose run; the operation preserves the case safety boundary.
const securityRun = (alertId, label) => ({
  project: 'security-triage-agent',
  agent: 'triage-operator',
  flow: 'agent-compose-to-octobus',
  prompt: `Controlled browser verification: ${label}. Run \`cd agent && node src/cli.js --alert-id ${alertId}\`. Preserve traceId and report only state, matched rule id or evidence id, and capability result. Do not print secrets, raw logs, or IOC values; do not call any backend directly.`
});
const malwareTurn = (sessionId, message, label) => ({
  project: 'malware-triage-agent',
  agent: 'malware-triage-operator',
  flow: 'agent-compose-state-machine',
  prompt: `Controlled browser verification: ${label}. Run \`cd agent && node src/cli.js --session-id ${sessionId} --message '${message}'\`. Report only the state-machine action and safe slot names. Do not inspect, upload, execute, or print a sample; do not print secrets or call a backend directly unless the deterministic workflow explicitly permits its approved OctoBus capability.`
});
const malwareSelfCheck = (label) => ({
  project: 'malware-triage-agent',
  agent: 'malware-triage-operator',
  flow: 'agent-compose-self-check',
  prompt: `Controlled browser verification: ${label}. Run \`cd agent && node src/cli.js --self-check\`; report only check statuses. Do not inspect samples, print secrets, or call a backend directly.`
});

export const liveCaseAllowList = Object.freeze({
  'security-normal': securityRun('A-1001', 'authorized DNS scan suppression review'),
  'security-ioc': securityRun('A-private', 'private evidence escalation review'),
  'security-record-fail': securityRun('A-1001', 'recording-failure manual handoff replay'),
  'security-slots': securityRun('A-2002', 'incomplete alert context review'),
  'security-schema-fallback': securityRun('A-1001', 'model schema fallback replay'),
  'malware-normal': malwareTurn('live-malware-normal', '研判 sample_id demo-android-001 SHA-256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa android-apk', 'sanitized malware workflow'),
  'malware-slots': malwareTurn('live-malware-slots', '研判 sample_id demo-missing-hash', 'missing SHA-256 slot collection'),
  'malware-chat': malwareTurn('live-malware-chat', '今天天气如何', 'unsupported intent refusal'),
  'malware-rag': malwareTurn('live-malware-rag', '研判 sample_id demo-low-evidence SHA-256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb android-apk', 'insufficient-evidence workflow'),
  'malware-llm': malwareSelfCheck('LLM timeout fallback replay boundary'),
  'malware-gateway': malwareSelfCheck('OctoBus transient failure replay boundary'),
  'malware-switch': malwareTurn('live-malware-switch', '先查任务状态，再继续补充 SHA-256', 'multi-turn context pause')
});

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}
function sameSecret(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function tokenFromEnvironment() {
  const file = process.env.AGENT_TRIGGER_BRIDGE_TOKEN_FILE;
  try { return file ? readFileSync(file, 'utf8').trim() : (process.env.AGENT_TRIGGER_BRIDGE_TOKEN || ''); } catch { return ''; }
}
async function requestBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024) throw new Error('payload_too_large');
  }
  return body ? JSON.parse(body) : {};
}
function runIdFrom(stdout) {
  try {
    const value = JSON.parse(stdout);
    const candidate = value?.id ?? value?.runId ?? value?.run_id ?? value?.run?.id;
    if (typeof candidate === 'string' && /^[a-z0-9-]{8,128}$/i.test(candidate)) return candidate;
  } catch { /* Some CLI versions print a plain run id. */ }
  const candidate = String(stdout).match(/\b[a-z0-9-]{8,128}\b/i)?.[0];
  return candidate || null;
}
export async function startAgentRun(entry, execute = execFile) {
  const { stdout } = await execute('docker', [
    'exec', 'agent-compose', 'agent-compose', '--json', '-p', entry.project,
    'run', entry.agent, '--prompt', entry.prompt, '--detach'
  ], { timeout: 12_000, maxBuffer: 8 * 1024, windowsHide: true });
  const agentComposeRunId = runIdFrom(stdout);
  if (!agentComposeRunId) throw new Error('agent_compose_run_id_missing');
  return agentComposeRunId;
}

export function createTriggerBridge({ token = tokenFromEnvironment(), execute = execFile, now = () => new Date().toISOString() } = {}) {
  const accepted = new Map();
  return createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/trigger') return json(response, 404, { error: 'not_found' });
      const authorization = request.headers.authorization || '';
      if (!sameSecret(authorization.replace(/^Bearer\s+/i, ''), token)) return json(response, 401, { error: 'unauthorized' });
      const body = await requestBody(request);
      const entry = typeof body.caseId === 'string' ? liveCaseAllowList[body.caseId] : undefined;
      if (!entry) return json(response, 403, { error: 'case_not_live_enabled', message: '案例未在受控执行白名单中。' });
      const agentComposeRunId = await startAgentRun(entry, execute);
      const triggerId = randomUUID();
      accepted.set(triggerId, { triggerId, caseId: body.caseId, ...entry, agentComposeRunId, acceptedAt: now() });
      // Return only the opaque trigger id. Raw Agent Compose output is not a browser API.
      return json(response, 202, { status: 'ACCEPTED', triggerId, caseId: body.caseId, project: entry.project, agent: entry.agent, flow: entry.flow, acceptedAt: accepted.get(triggerId).acceptedAt });
    } catch (error) {
      const status = error.message === 'payload_too_large' ? 413 : error.message === 'agent_compose_run_id_missing' ? 502 : 503;
      return json(response, status, { error: status === 502 ? 'agent_compose_unexpected_response' : 'agent_compose_trigger_failed' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createTriggerBridge().listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'agent_trigger_bridge_started', port, liveCases: Object.keys(liveCaseAllowList) })));
}
