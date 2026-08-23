import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoCases } from './demo-cases.mjs';

const port = Number(process.env.DEMO_CONSOLE_PORT || 7411);
const mode = process.env.DEMO_MODE || 'replay';
const root = join(import.meta.dirname, 'public');
const counters = { replay_total: 0, replay_non_success_total: 0, malware_total: 0, security_total: 0 };
const typeFor = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let releaseInFlight = false;

function json(response, status, body) {
  response.writeHead(status, secureHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }));
  response.end(JSON.stringify(body));
}
function metrics(response) {
  response.writeHead(200, secureHeaders({ 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }));
  response.end(`# HELP chaitin_demo_replay_total UI replay cases by domain\n# TYPE chaitin_demo_replay_total counter\nchaitin_demo_replay_total{domain="malware"} ${counters.malware_total}\nchaitin_demo_replay_total{domain="security"} ${counters.security_total}\n# HELP chaitin_demo_non_success_total UI rejection or degradation cases\n# TYPE chaitin_demo_non_success_total counter\nchaitin_demo_non_success_total ${counters.replay_non_success_total}\n`);
}
function secureHeaders(headers) {
  return { ...headers, 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" };
}
function portainerUrl() {
  const value = process.env.PORTAINER_URL || '';
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}
function secretValue(name) {
  const file = process.env[`${name}_FILE`];
  try { return file ? readFileSync(file, 'utf8').trim() : (process.env[name] || ''); } catch { return ''; }
}
function releaseSettings() {
  const requestedMode = process.env.RELEASE_MODE || 'preview';
  const mode = requestedMode === 'enabled' ? 'enabled' : 'preview';
  const gateway = process.env.RELEASE_RUNNER_URL || '';
  const runnerToken = secretValue('RELEASE_RUNNER_TOKEN');
  const confirmation = secretValue('RELEASE_UI_CONFIRMATION');
  let gatewayUrl = '';
  try {
    const parsed = new URL(gateway);
    if (parsed.protocol === 'http:' && /^[a-z0-9][a-z0-9-]*$/i.test(parsed.hostname)) gatewayUrl = parsed.toString().replace(/\/$/, '');
  } catch { /* Release remains safely unavailable. */ }
  return { mode, ready: mode === 'enabled' && Boolean(gatewayUrl && runnerToken && confirmation), gatewayUrl, runnerToken, confirmation };
}
function releaseRequest(body) {
  const project = body?.project;
  const commit = body?.commit;
  const confirmation = body?.confirmation;
  if (!['security-triage-agent', 'malware-triage-agent'].includes(project)) return null;
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/i.test(commit)) return null;
  if (confirmation !== undefined && (typeof confirmation !== 'string' || confirmation.length > 128)) return null;
  return { project, commit: commit.toLowerCase(), confirmation: confirmation ?? '' };
}
function sameSecret(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function releasePlan(request) {
  return { project: request.project, commit: request.commit, stages: ['fetch_commit', 'pin_workspace_revision', 'agent_compose_up', 'project_and_capset_health_check'], policy: '仅允许固定项目与 40 位已推送 commit；不读取或返回 token、私钥、样本、IOC。' };
}
async function bodyOf(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 16_384) throw new Error('payload_too_large'); }
  return body ? JSON.parse(body) : {};
}

export function createDemoServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/api/config') {
        const release = releaseSettings();
        return json(response, 200, { mode, portainerUrl: portainerUrl(), release: { mode: release.mode, ready: release.ready, confirmationRequired: true } });
      }
      if (request.method === 'GET' && url.pathname === '/api/cases') return json(response, 200, demoCases.map(({ logs, audit, ...item }) => item));
      if (request.method === 'GET' && url.pathname === '/metrics') return metrics(response);
      if (request.method === 'POST' && url.pathname === '/api/replay') {
        const { caseId } = await bodyOf(request);
        if (typeof caseId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(caseId)) return json(response, 400, { error: 'invalid_case_id' });
        const result = demoCases.find((item) => item.id === caseId);
        if (!result) return json(response, 404, { error: 'unknown_case' });
        counters.replay_total += 1;
        counters[`${result.domain}_total`] += 1;
        if (!['HUMAN_REVIEW_REQUIRED', 'COMPLETED', 'NEEDS_REVIEW', 'ESCALATE'].includes(result.outcome)) counters.replay_non_success_total += 1;
        return json(response, 200, result);
      }
      if (request.method === 'POST' && url.pathname === '/api/release') {
        const payload = releaseRequest(await bodyOf(request));
        if (!payload) return json(response, 400, { error: 'invalid_release_request' });
        const settings = releaseSettings();
        const plan = releasePlan(payload);
        if (settings.mode !== 'enabled') return json(response, 200, { status: 'PREVIEW', plan, message: '发布器处于预览模式；不会执行服务器操作。' });
        if (!settings.ready) return json(response, 503, { error: 'release_runner_not_ready' });
        if (!sameSecret(payload.confirmation, settings.confirmation)) return json(response, 403, { error: 'release_confirmation_rejected' });
        if (releaseInFlight) return json(response, 429, { error: 'release_already_running' });
        releaseInFlight = true;
        try {
          const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 190_000);
          const upstream = await fetch(`${settings.gatewayUrl}/release`, { method: 'POST', signal: abort.signal, headers: { authorization: `Bearer ${settings.runnerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ project: payload.project, commit: payload.commit }) });
          clearTimeout(timer);
          if (!upstream.ok) return json(response, 502, { error: 'release_runner_failed' });
          const result = await upstream.json();
          return json(response, 200, { status: 'PUBLISHED', plan, result: { releaseId: result.releaseId, project: result.project, commit: result.commit, health: result.health } });
        } catch { return json(response, 502, { error: 'release_runner_unreachable' }); }
        finally { releaseInFlight = false; }
      }
      if (request.method === 'POST' && url.pathname === '/api/live') return json(response, 501, { error: 'live_mode_not_enabled', message: '实时模式需部署受控 OctoBus bridge；当前页面仅执行安全回放。' });
      if (request.method === 'GET') {
        const relative = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '');
        if (relative.includes('..')) return json(response, 400, { error: 'invalid_path' });
        const file = join(root, relative);
        const content = await readFile(file);
        response.writeHead(200, secureHeaders({ 'content-type': typeFor[extname(file)] || 'application/octet-stream' }));
        return response.end(content);
      }
      return json(response, 405, { error: 'method_not_allowed' });
    } catch (error) {
      return json(response, error.message === 'payload_too_large' ? 413 : 400, { error: 'invalid_request' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createDemoServer().listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'demo_console_started', mode, port })));
}
