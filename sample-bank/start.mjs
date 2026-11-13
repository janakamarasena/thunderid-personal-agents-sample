// Runs the bank API, the portal and the SMTP server together. Ctrl+C stops them all, and if one exits the
// others stop.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// The repository's .env (scripts/generate-secrets.sh) holds the bank API's client secret. Every service inherits it.
const envFile = join(root, '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const services = [
  { name: 'backend', color: 36, cwd: 'backend', args: ['start'] },
  { name: 'portal ', color: 35, cwd: 'bank-portal', args: ['run', 'dev'] },
  { name: 'smtp   ', color: 33, cwd: 'smtp-server', args: ['start'] },
];

// Install each component's dependencies on first run. A component without dependencies is skipped.
for (const service of services) {
  const dir = join(root, service.cwd);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const hasDependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
  if (!hasDependencies || existsSync(join(dir, 'node_modules'))) {
    continue;
  }
  console.log(`[setup] Installing the ${service.cwd} dependencies...`);
  const install = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

const children = [];
let stopping = false;

function stopAll(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500);
}

for (const service of services) {
  const child = spawn(npm, service.args, { cwd: join(root, service.cwd), env: process.env });
  const prefix = `\x1b[${service.color}m[${service.name}]\x1b[0m `;
  const relay = (stream, target) => {
    let pending = '';
    stream.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        target.write(`${prefix}${line}\n`);
      }
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      console.log(`${prefix}exited with code ${code}; stopping the others`);
      stopAll(code ?? 1);
    }
  });
  children.push(child);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
