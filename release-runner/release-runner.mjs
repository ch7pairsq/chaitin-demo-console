import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const execFileAsync = promisify(execFile);
const port = Number(process.env.RELEASE_RUNNER_PORT || 7420);
function secretValue(name) {
  const file = process.env[`${name}_FILE`];
  try { return file ? readFileSync(file, 'utf8').trim() : (process.env[name] || ''); } catch { return ''; }
}
const expectedToken = secretValue('RELEASE_RUNNER_TOKEN');
let inFlight = false;

function respond(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}
function authorized(header) {
  const supplied = header?.replace(/^Bearer\s+/i, '') || '';
  const left = Buffer.from(supplied); const right = Buffer.from(expectedToken);
  return Boolean(expectedToken) && left.length === right.length && timingSafeEqual(left, right);
}
async function readBody(request) {
  let raw = '';
  for await (const chunk of request) { raw += chunk; if (raw.length > 1024) throw new Error('payload_too_large'); }
  return raw ? JSON.parse(raw) : {};
}
function validRequest(body) {
  return ['security-triage-agent', 'malware-triage-agent'].includes(body?.project)
    && typeof body.commit === 'string' && /^[a-f0-9]{40}$/i.test(body.commit);
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return respond(response, expectedToken ? 200 : 503, { status: expectedToken ? 'ready' : 'missing_runner_token' });
  if (request.method !== 'POST' || request.url !== '/release') return respond(response, 404, { error: 'not_found' });
  if (!authorized(request.headers.authorization)) return respond(response, 401, { error: 'unauthorized' });
  if (inFlight) return respond(response, 429, { error: 'release_already_running' });
  try {
    const body = await readBody(request);
    if (!validRequest(body)) return respond(response, 400, { error: 'invalid_release_request' });
    inFlight = true;
    const releaseId = `release-${randomUUID()}`;
    await execFileAsync('/usr/local/bin/release-agent-project.sh', [body.project, body.commit.toLowerCase()], { timeout: 180_000, maxBuffer: 8_192 });
    return respond(response, 200, { releaseId, project: body.project, commit: body.commit.toLowerCase(), health: 'passed' });
  } catch {
    return respond(response, 502, { error: 'release_failed' });
  } finally { inFlight = false; }
}).listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'release_runner_started', port })));
