const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');

const origin = 'https://atlas.example';

function setup() {
  const modules = new Map();
  let calls = 0;
  function load(file) {
    const absolute = path.resolve(file);
    if (modules.has(absolute)) return modules.get(absolute);
    const exports = {};
    modules.set(absolute, exports);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, {
      exports, process: { env: { YFINANCE_API_TOKEN: 'private-provider-token', YFINANCE_API_URL: 'https://provider.example/api/python_market' } },
      Request, Response, Buffer, Uint8Array, AbortSignal, Error, URL,
      fetch: async () => { calls++; return Response.json({ symbol: 'VOO', price: 100, points: [{ date: '2025-01-01', rate: 0.04 }] }); },
      require(id) {
        if (id === 'next/cache') return { unstable_cache: fn => {
          let pending;
          return () => pending ??= fn();
        } };
        if (id.startsWith('.')) return load(`${path.resolve(path.dirname(absolute), id)}.ts`);
        return require(id);
      },
    });
    return exports;
  }
  return { load, calls: () => calls };
}

function request(url, { method = 'GET', body, site = 'same-origin', requestOrigin } = {}) {
  const headers = {};
  if (site !== null) headers['sec-fetch-site'] = site;
  if (requestOrigin !== undefined) headers.origin = requestOrigin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`${origin}${url}`, { method, headers, body });
}

test('frontend pages are public, with no password or session required', () => {
  const { load } = setup();
  const { middleware, config } = load('middleware.ts');
  assert.deepEqual(Array.from(config.matcher), ['/api/market/:path*']);
  const response = middleware(request('/', { site: 'none' }));
  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.headers.get('location'), null);
  assert.ok(!fs.readFileSync('app/page.tsx', 'utf8').includes('SignOutButton'));
  assert.equal(fs.existsSync('app/login/page.tsx'), false);
});

test('market browser isolation rejects cross-site, sibling origins, missing metadata, and navigation requests', () => {
  const { load } = setup();
  const { checkAppRequest } = load('app/lib/app-request.ts');
  for (const site of ['cross-site', 'same-site', 'none', null]) {
    const response = checkAppRequest(request('/api/market/rates', { site }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const requestOrigin of ['https://evil.example', 'null', 'http://atlas.example', 'https://atlas.example:444']) {
    assert.equal(checkAppRequest(request('/api/market/rates', { requestOrigin })).status, 403);
  }
  assert.equal(checkAppRequest(request('/api/market/rates')), null);
  assert.equal(checkAppRequest(request('/api/market/rates', { requestOrigin: origin })), null);
});

test('backtest POST requires both same-origin metadata and matching Origin, without login', () => {
  const { load } = setup();
  const { checkAppRequest } = load('app/lib/app-request.ts');
  for (const requestOrigin of [undefined, 'https://evil.example', 'null']) {
    assert.equal(checkAppRequest(request('/api/market/backtest', { method: 'POST', requestOrigin })).status, 403);
  }
  assert.equal(checkAppRequest(request('/api/market/backtest', { method: 'POST', requestOrigin: origin })), null);
});

test('every market handler rejects disallowed browser requests before provider or cache access', async () => {
  const { load, calls } = setup();
  for (const name of ['lookup', 'history', 'search', 'rates', 'backtest']) {
    const method = name === 'backtest' ? 'POST' : 'GET';
    const handler = load(`app/api/market/${name}/route.ts`)[method];
    const req = request(`/api/market/${name}?symbol=VOO&query=VOO`, {
      method, body: method === 'POST' ? '{"portfolios":[]}' : undefined,
      site: 'cross-site', requestOrigin: 'https://evil.example',
    });
    req.headers.set('x-middleware-subrequest', 'middleware:middleware:middleware:middleware:middleware');
    assert.equal((await handler(req)).status, 403, name);
  }
  assert.equal(calls(), 0);
  const rates = load('app/api/market/rates/route.ts');
  assert.equal((await rates.GET(request('/api/market/rates'))).status, 200);
  assert.equal(calls(), 1);
  assert.equal((await rates.GET(request('/api/market/rates', { site: 'cross-site' }))).status, 403);
  assert.equal(calls(), 1);
});

test('public app data access requires no session and never exposes the Python secret', async () => {
  const { load, calls } = setup();
  const response = await load('app/api/market/lookup/route.ts').GET(request('/api/market/lookup?symbol=VOO'));
  assert.equal(response.status, 200);
  assert.equal(calls(), 1);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.ok(!(await response.text()).includes('private-provider-token'));
  const { middleware } = load('middleware.ts');
  assert.equal(middleware(request('/api/market/rates', { site: 'cross-site' })).status, 403);
  // Python uses its own bearer-token handler, not browser fetch metadata.
  assert.equal(middleware(request('/api/python_market', { site: null })).headers.get('x-middleware-next'), '1');
});
