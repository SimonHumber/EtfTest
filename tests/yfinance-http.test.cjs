const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gunzipSync } = require('node:zlib');
const { NextRequest } = require('next/server');
const ts = require('typescript');
const TEST_TOKEN = 'unit-test-market-secret-not-a-production-credential';

function setup(fetch, env = { YFINANCE_API_URL: 'http://127.0.0.1:8000/api/python_market' }) {
  env = { YFINANCE_API_TOKEN: TEST_TOKEN, ...env };
  const modules = new Map();
  function load(file) {
    const absolute = path.resolve(file);
    if (modules.has(absolute)) return modules.get(absolute);
    const exports = {};
    modules.set(absolute, exports);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, {
      exports, fetch, process: { env }, AbortSignal, Error, Buffer, Uint8Array, Request, Response,
      require(id) {
        // Request isolation is covered separately; these tests isolate the Python transport.
        if (id === '../../../lib/app-request') return { checkAppRequest: () => null };
        if (id === 'next/cache') return { unstable_cache: fn => {
          let cached;
          return () => cached ??= fn().catch(error => { cached = undefined; throw error; });
        } };
        if (id.startsWith('.')) return load(`${path.resolve(path.dirname(absolute), id)}.ts`);
        return require(id);
      },
    });
    return exports;
  }
  return { load, client: load('app/lib/yfinance-http.ts') };
}

test('Python HTTP transport resolves local and Vercel endpoints without using the client host', async () => {
  const calls = [];
  const fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ symbol: 'VOO', price: 100 }); };
  await setup(fetch).client.yfinanceRequest({ action: 'lookup', symbol: 'VOO' });
  assert.equal(calls[0].url, 'http://127.0.0.1:8000/api/python_market');
  const deployed = setup(fetch, { VERCEL_URL: 'atlas-preview.vercel.app', VERCEL_AUTOMATION_BYPASS_SECRET: 'test-secret' });
  const route = deployed.load('app/api/market/lookup/route.ts');
  const response = await route.GET(new NextRequest('https://untrusted.example/api/market/lookup?symbol=voo', { headers: { authorization: 'Bearer forged-client-token' } }));
  assert.equal(response.status, 200);
  assert.equal(calls[1].url, 'https://atlas-preview.vercel.app/api/python_market');
  assert.equal(calls[1].options.headers['x-vercel-protection-bypass'], 'test-secret');
  assert.equal(calls[1].options.headers.authorization, `Bearer ${TEST_TOKEN}`);
  assert.ok(!calls[1].options.body.includes(TEST_TOKEN));
  assert.ok(!(await response.text()).includes(TEST_TOKEN));
  assert.equal(JSON.parse(calls[1].options.body).symbol, 'VOO');
  assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(calls[1].options.redirect, 'error');
});

test('explicit backend endpoint does not receive the Vercel deployment secret', async () => {
  let request;
  const client = setup(async (url, options) => { request = { url, options }; return Response.json({ points: [] }); }, {
    YFINANCE_API_URL: 'https://python.example/custom/market', VERCEL_URL: 'atlas.vercel.app', VERCEL_AUTOMATION_BYPASS_SECRET: 'test-secret',
  }).client;
  await client.yfinanceRequest({ action: 'history', symbol: '^GSPC' });
  assert.equal(request.url, 'https://python.example/custom/market');
  assert.equal(request.options.headers['x-vercel-protection-bypass'], undefined);
});

test('missing endpoint configuration fails before any network request', async () => {
  let calls = 0;
  const { client } = setup(async () => { calls += 1; }, {});
  await assert.rejects(client.yfinanceRequest({ action: 'rates' }), error => error.status === 503 && /YFINANCE_API_URL in .env/.test(error.message));
  assert.equal(calls, 0);
});

test('missing server token disables the proxy before any network request', async () => {
  let calls = 0;
  const { client } = setup(async () => { calls += 1; }, { YFINANCE_API_URL: 'http://127.0.0.1:8000/api/python_market', YFINANCE_API_TOKEN: '' });
  await assert.rejects(client.yfinanceRequest({ action: 'rates' }), error => error.status === 503 && /server-only YFINANCE_API_TOKEN/.test(error.message));
  assert.equal(calls, 0);
});

test('backend launcher loads the shared environment before spawning Python', () => {
  const code = fs.readFileSync('scripts/dev-backend.cjs', 'utf8');
  const env = {};
  let loaded = false;
  let spawned;
  const child = { on() {}, kill() {} };
  vm.runInNewContext(code, {
    __dirname: path.resolve('scripts'), console,
    process: { env, platform: 'linux', on() {}, exit() { throw new Error('Unexpected exit'); } },
    require(id) {
      if (id === '@next/env') return { loadEnvConfig(root, dev) { assert.equal(root, process.cwd()); assert.equal(dev, true); loaded = true; env.YFINANCE_API_TOKEN = TEST_TOKEN; } };
      if (id === 'node:child_process') return { spawn(python, args, options) { assert.ok(loaded); spawned = { python, args, options }; return child; } };
      return require(id);
    },
  });
  assert.ok(spawned.python.endsWith('.venv/bin/python'));
  assert.equal(spawned.args.join(' '), '-m api.python_market');
  assert.equal(spawned.options.env.YFINANCE_API_TOKEN, TEST_TOKEN);
});

test('backend launcher refuses to start without a token', () => {
  const code = fs.readFileSync('scripts/dev-backend.cjs', 'utf8');
  let spawned = false;
  assert.throws(() => vm.runInNewContext(code, {
    __dirname: path.resolve('scripts'), console: { error() {} },
    process: { env: {}, platform: 'linux', exit(code) { assert.equal(code, 1); throw new Error('Stopped without token'); } },
    require(id) {
      if (id === '@next/env') return { loadEnvConfig() {} };
      if (id === 'node:child_process') return { spawn() { spawned = true; } };
      return require(id);
    },
  }), /Stopped without token/);
  assert.equal(spawned, false);
});

test('public route validation and empty search do not call Python', async () => {
  let calls = 0;
  const { load } = setup(async () => { calls += 1; throw new Error('Unexpected HTTP call'); });
  for (const route of ['lookup', 'history']) {
    const response = await load(`app/api/market/${route}/route.ts`).GET(new NextRequest(`http://localhost/api/market/${route}`));
    assert.equal(response.status, 400);
  }
  const search = await load('app/api/market/search/route.ts').GET(new NextRequest('http://localhost/api/market/search?query=%20'));
  assert.deepEqual(await search.json(), { results: [] });
  const backtest = load('app/api/market/backtest/route.ts');
  assert.equal((await backtest.POST(new Request('http://localhost/api/market/backtest', { method: 'POST', body: '{' }))).status, 400);
  assert.equal((await backtest.POST(new Request('http://localhost/api/market/backtest', { method: 'POST', body: '{}' }))).status, 400);
  assert.equal(calls, 0);
});

test('backtest route forwards the selected portfolios with a fixed action', async () => {
  let forwarded;
  const { load } = setup(async (_, options) => { forwarded = JSON.parse(options.body); return Response.json({ priceHistory: [] }); });
  const portfolios = [{ holdings: [{ symbol: 'VOO', weight: 100 }] }];
  const response = await load('app/api/market/backtest/route.ts').POST(new Request('http://localhost/api/market/backtest', { method: 'POST', body: JSON.stringify({ portfolios, action: 'lookup' }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(forwarded, { action: 'backtest', portfolios });
});

test('Python failures, malformed responses, protection and timeouts return usable errors', async () => {
  for (const [fetch, expectedStatus, message] of [
    [async () => Response.json({ error: 'Unknown ticker' }, { status: 422 }), 422, /Unknown ticker/],
    [async () => new Response('<html>Login</html>', { status: 401 }), 502, /Protection Bypass/],
    [async () => Response.json({ error: 'Unauthorized.' }, { status: 401 }), 502, /Python service authentication failed/],
    [async () => new Response('bad json'), 502, /invalid JSON/],
    [async () => Response.json(null), 502, /invalid data/],
    [async () => { throw new Error('Connection refused'); }, 502, /dev:backend/],
    [async () => { const error = new Error('Timeout'); error.name = 'TimeoutError'; throw error; }, 504, /timed out/],
  ]) {
    const { client } = setup(fetch);
    await assert.rejects(client.yfinanceRequest({ action: 'rates' }), error => error.status === expectedStatus && message.test(error.message));
  }
  const { load } = setup(async () => Response.json({ error: 'Search unavailable' }, { status: 502 }));
  const response = await load('app/api/market/search/route.ts').GET(new NextRequest('http://localhost/api/market/search?query=VOO'));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { results: [], error: 'Search unavailable' });
});

test('rates retain the shared Next.js cache after switching to HTTP', async () => {
  let calls = 0;
  const { load } = setup(async () => { calls += 1; return Response.json({ symbol: '^IRX', points: [{ date: '2024-01-01', rate: .04 }] }); });
  const route = load('app/api/market/rates/route.ts');
  const responses = await Promise.all([route.GET(new Request('http://localhost/api/market/rates')), route.GET(new Request('http://localhost/api/market/rates'))]);
  assert.ok(responses.every(response => response.status === 200));
  await route.GET(new Request('http://localhost/api/market/rates'));
  assert.equal(calls, 1);
});

test('large history responses are compressed losslessly when the client accepts gzip', async () => {
  const { client } = setup(async () => Response.json({}));
  const data = { points: Array.from({ length: 10000 }, (_, i) => ({ date: `day-${i}`, close: i / 1000 })) };
  const compressed = client.marketResponse(data, new Request('http://localhost', { headers: { 'accept-encoding': 'gzip' } }));
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await compressed.arrayBuffer())).toString()), data);
  const plain = client.marketResponse({ close: 0 });
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.deepEqual(await plain.json(), { close: 0 });
});
