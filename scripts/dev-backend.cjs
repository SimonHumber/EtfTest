const { spawn } = require('node:child_process');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');

const root = path.resolve(__dirname, '..');
loadEnvConfig(root, true);
if (!process.env.YFINANCE_API_TOKEN?.trim()) {
  console.error('Set YFINANCE_API_TOKEN in .env before starting the Python service.');
  process.exit(1);
}

const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const child = spawn(python, ['-m', 'api.python_market'], { cwd: root, env: process.env, stdio: 'inherit' });
child.on('error', () => {
  console.error('Could not start Python. Create .venv and install requirements.txt.');
  process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 0; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
