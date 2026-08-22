import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoCases } from './demo-cases.mjs';

const port = Number(process.env.DEMO_CONSOLE_PORT || 7411);
const mode = process.env.DEMO_MODE || 'replay';
const root = join(import.meta.dirname, 'public');
const counters = { replay_total: 0, replay_non_success_total: 0, malware_total: 0, security_total: 0 };
const typeFor = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

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
async function bodyOf(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 16_384) throw new Error('payload_too_large'); }
  return body ? JSON.parse(body) : {};
}

export function createDemoServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/api/config') return json(response, 200, { mode, portainerUrl: process.env.PORTAINER_URL || '' });
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
