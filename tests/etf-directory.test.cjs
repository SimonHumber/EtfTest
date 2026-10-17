const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, overrides = {}, cache = new Map()) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  if (absolute.endsWith('.json')) return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const exports = {};
  cache.set(absolute, exports);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  let sequence = 0;
  vm.runInNewContext(code, {
    exports, Date, Float64Array, AbortController,
    crypto: { randomUUID: () => `request-${++sequence}` },
    fetch: overrides.fetch ?? (() => { throw new Error('Unexpected market API call'); }),
    window: { setTimeout, clearTimeout },
    require(id) {
      if (id in overrides) return overrides[id];
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(absolute), id);
        const target = fs.existsSync(base) && fs.statSync(base).isFile() ? base : ['.ts', '.tsx'].map(ext => base + ext).find(file => fs.existsSync(file));
        return load(target, overrides, cache);
      }
      return require(id);
    },
  });
  return exports;
}

function hooks() {
  const slots = [];
  let cursor, dirty, effects;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const react = {
    Suspense: 'suspense',
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) {
        const old = slots[i];
        slots[i] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  return { react, render(fn) {
    let result;
    for (let pass = 0; pass < 20; pass++) {
      cursor = 0; dirty = false; effects = [];
      result = fn();
      for (const effect of effects) effect();
      if (!dirty) return result;
    }
    throw new Error('Render did not settle');
  } };
}

function elements(element, predicate, found = []) {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) elements(child, predicate, found);
  return found;
}

const directory = load('app/lib/etf-directory.ts');
const canada = JSON.parse(fs.readFileSync('public/iShareCan.json', 'utf8'));
const usa = JSON.parse(fs.readFileSync('public/iShareUsa.json', 'utf8'));

test('directory uses both JSONs and resolved Canadian symbols without guessing the exchange', () => {
  const listings = directory.directoryListings(canada, usa);
  assert.equal(listings.length, canada.length + usa.length);
  for (const ticker of ['CWO', 'CRQ', 'CIE', 'CJP', 'CLU', 'CLU.C']) {
    const row = listings.find(row => row.market === 'Canada' && row.ticker === ticker);
    assert.equal(row.symbol, `${ticker.replaceAll('.', '-')}.NE`);
  }
  assert.equal(listings.find(row => row.id === 'CA:XUU.U').symbol, 'XUU-U.TO');
  assert.equal(listings.find(row => row.id === 'US:IVV').symbol, 'IVV');
  const unresolved = directory.directoryListings([{ ticker: 'UNKNOWN', name: null, aum: null, mer: null, inceptionDate: null }], []);
  assert.equal(unresolved[0].symbol, null);
});

test('ETF filtering and numeric sorting are local, stable, and keep nulls last', () => {
  const rows = directory.directoryListings([], [
    { ticker: 'BIG', name: 'Large fund', aum: 1000, mer: .5, inceptionDate: '2020-01-01' },
    { ticker: 'SMALL', name: 'Small fund', aum: 2, mer: 0, inceptionDate: '2000-01-01' },
    { ticker: 'EMPTY', name: null, aum: null, mer: null, inceptionDate: null },
  ]);
  for (const direction of ['asc', 'desc']) assert.equal(directory.filterEtfs(rows, '', 'All', 'aum', direction).at(-1).ticker, 'EMPTY');
  assert.equal(directory.filterEtfs(rows, '', 'All', 'aum', 'asc')[0].ticker, 'SMALL');
  assert.equal(directory.filterEtfs(rows, ' LARGE ', 'U.S.', 'ticker', 'asc')[0].ticker, 'BIG');
  assert.equal(directory.filterEtfs(rows, '', 'Canada', 'ticker', 'asc').length, 0);
  assert.equal(rows[0].ticker, 'BIG', 'sorting must not mutate imported data');
  assert.equal(directory.etfAum(null), '-');
  assert.equal(directory.etfAum(0), '0');
  assert.equal(directory.etfDate('2000-01-01'), 'Jan 1, 2000');
  assert.equal(directory.etfDate(null), '-');
});

test('ETF table searches, filters, paginates, and dispatches both row actions', () => {
  const h = hooks();
  const research = [], backtest = [];
  const { EtfDirectoryView } = load('app/ui/etf-directory-view.tsx', { react: h.react });
  const render = () => h.render(() => EtfDirectoryView({ onResearch: value => research.push(value), onBacktest: value => backtest.push(value) }));
  const byLabel = label => elements(render(), el => el.props?.['aria-label'] === label)[0];
  assert.equal(elements(render(), el => el.type === 'tbody')[0].props.children.length, 25);
  byLabel('Next ETF page').props.onClick();
  assert.equal(byLabel('Previous ETF page').props.disabled, false);
  byLabel('Search ETFs').props.onChange({ target: { value: 'CWO' } });
  assert.equal(byLabel('Previous ETF page').props.disabled, true);
  byLabel('Research CWO (Canada)').props.onClick();
  byLabel('Add CWO (Canada) to Backtest').props.onClick();
  assert.deepEqual(research, ['CWO.NE']);
  assert.deepEqual(backtest, ['CWO.NE']);
  elements(render(), el => el.type === 'button' && el.props.children === 'U.S.')[0].props.onClick();
  assert.equal(elements(render(), el => el.props?.role === 'status' && el.props.children === 'No ETFs found.').length, 1);
  byLabel('Clear ETF search').props.onClick();
  byLabel('Search ETFs').props.onChange({ target: { value: 'IVV' } });
  byLabel('Research IVV (U.S.)').props.onClick();
  assert.equal(research.at(-1), 'IVV');
});

test('ETF table renders with real React and bounded, horizontally scrollable mobile columns', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { EtfDirectoryView } = load('app/ui/etf-directory-view.tsx');
  const html = renderToStaticMarkup(React.createElement(EtfDirectoryView, { onResearch() {}, onBacktest() {} }));
  assert.ok(html.includes('<caption'));
  assert.ok(html.includes('overflow-x-auto'));
  assert.ok(html.includes('min-w-[830px]'));
  assert.ok(html.includes('sticky right-0'));
  assert.equal((html.match(/aria-label="Research /g) ?? []).length, 25);
  assert.equal((html.match(/to Backtest"/g) ?? []).length, 50, 'each row has an accessible Backtest action and tooltip');
});

test('/etfs opens the directory entry route', () => {
  let destination;
  const page = load('app/etfs/page.tsx', { 'next/navigation': { redirect(url) { destination = url; } } });
  page.default();
  assert.equal(destination, '/?view=etfs');
});

test('workspace opens ETF actions in the correct tab and preserves both mounted views', () => {
  const h = hooks();
  let params = new URLSearchParams('view=etfs');
  const pushes = [];
  function TickerView() {}
  function BacktestView() {}
  function EtfDirectoryView() {}
  const page = load('app/page.tsx', {
    react: h.react,
    'next/navigation': { useSearchParams: () => params, useRouter: () => ({ push(url) { pushes.push(url); params = new URL(url, 'https://atlas.example').searchParams; } }) },
    './ui/ticker-view': { TickerView }, './ui/backtest-view': { BacktestView }, './ui/etf-directory-view': { EtfDirectoryView },
  });
  const Workspace = page.default().props.children.type;
  const render = () => h.render(Workspace);
  const props = type => elements(render(), el => el.type === type)[0].props;
  const visible = () => elements(render(), el => el.type === 'div' && el.props.hidden !== undefined).findIndex(el => !el.props.hidden);
  assert.equal(visible(), 2, 'directory URL opens the ETF view');
  assert.equal(props(TickerView).selection, undefined);
  props(EtfDirectoryView).onResearch('CWO.NE');
  assert.equal(pushes.at(-1), '/?view=research');
  assert.equal(props(TickerView).selection.symbol, 'CWO.NE');
  assert.equal(visible(), 0);
  props(EtfDirectoryView).onBacktest('IVV');
  assert.equal(pushes.at(-1), '/?view=backtest');
  assert.equal(props(BacktestView).portfolioSelection.symbol, 'IVV');
  assert.equal(visible(), 1);
  const first = props(BacktestView).portfolioSelection.id;
  props(EtfDirectoryView).onBacktest('IVV');
  assert.notEqual(props(BacktestView).portfolioSelection.id, first);
  assert.equal(elements(render(), el => el.type === TickerView).length, 1);
  assert.equal(elements(render(), el => el.type === BacktestView).length, 1);
  params = new URLSearchParams('view=etfs');
  assert.equal(visible(), 2, 'browser history can return to the directory without clearing the selection');
  assert.equal(props(BacktestView).portfolioSelection.symbol, 'IVV');
});

test('adding an ETF appends one 100% portfolio without fetching or touching last-run chart', async () => {
  const h = hooks();
  const loadedIds = [];
  const byId = {};
  for (const symbol of ['VTI', 'VXUS', 'BND', 'VOO']) byId[symbol] = { id: symbol, name: symbol, currency: 'USD', history: { symbol, points: [{ date: '2024-01-01', close: 100, return: 0 }, { date: '2024-01-02', close: 110, return: .1 }], performance: {} } };
  function BacktestTickerInput() {}
  const { BacktestView } = load('app/ui/backtest-view.tsx', {
    react: h.react,
    './backtest-ticker-input': { BacktestTickerInput },
    './portfolio-leverage-options': { PortfolioLeverageOptions() {} },
    './chart-hover': { ChartHover() {} },
    './market-data-provider': { useMarketData: () => ({ series: byId, loadSeries: async id => { loadedIds.push(id); return byId[id]; }, getRiskFreeRates: () => { throw new Error('Must not fetch rates'); } }) },
  });
  let selection;
  const render = () => h.render(() => BacktestView({ portfolioSelection: selection }));
  const chart = () => elements(render(), el => el.type?.name === 'PerformanceChart')[0].props;
  elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Run backtest'))[0].props.onClick();
  await new Promise(setImmediate);
  const before = chart();
  const calls = loadedIds.length;
  selection = { id: 'from-etfs', symbol: 'CWO.NE' };
  const tree = render();
  const holdings = elements(tree, el => el.type === BacktestTickerInput);
  assert.equal(holdings.length, 5);
  assert.equal(holdings.at(-1).props.value, 'CWO.NE');
  const weights = elements(tree, el => el.type === 'input' && el.props.type === 'number' && el.props.max === '100');
  assert.equal(weights.at(-1).props.value, 100);
  assert.equal(elements(tree, el => el.props?.['aria-label'] === 'Portfolio name').at(-1).props.value, 'Portfolio');
  assert.equal(loadedIds.length, calls);
  assert.equal(chart().results, before.results);
  assert.equal(chart().portfolios.length, 2, 'new editor portfolio is not included until Run backtest');
  selection = { ...selection };
  assert.equal(elements(render(), el => el.type === BacktestTickerInput).length, 5, 'replayed requests must not duplicate portfolios');
});

test('Research selection loads the exact Yahoo symbol only on action and ignores stale lookups', async () => {
  const h = hooks();
  const requests = [], historyIds = [], resolvers = new Map();
  const series = {};
  const { TickerView } = load('app/ui/ticker-view.tsx', {
    react: h.react,
    fetch: url => { requests.push(url); return new Promise(resolve => resolvers.set(url, resolve)); },
    './market-data-provider': { useMarketData: () => ({ series, loadSeries: async (id, quote) => {
      historyIds.push(id);
      return series[id] = { id, name: id, currency: 'USD', quote, history: { symbol: id, points: [], performance: {} } };
    } }) },
    './chart-hover': { ChartHover() {} }, './leverage-control': { LeverageControl() {} },
  });
  let selection;
  const render = () => h.render(() => TickerView({ selection }));
  render();
  assert.equal(requests.length, 0, 'no market requests on page entry');
  selection = { id: 'slow', symbol: 'CWO.NE' }; render();
  selection = { id: 'fast', symbol: 'IVV' }; render();
  const quote = symbol => ({ symbol, name: symbol, currency: 'USD', exchange: 'ETF', price: 100, change: 0, changePercent: 0 });
  resolvers.get('/api/market/lookup?symbol=IVV')({ ok: true, json: async () => quote('IVV') });
  await new Promise(setImmediate);
  resolvers.get('/api/market/lookup?symbol=CWO.NE')({ ok: true, json: async () => quote('CWO.NE') });
  await new Promise(setImmediate);
  assert.equal(elements(render(), el => el.type === 'h2' && el.props.children === 'IVV').length, 1);
  assert.deepEqual(historyIds, ['IVV']);
  selection = { id: 'again', symbol: 'IVV' }; render();
  assert.equal(requests.length, 2, 'loaded Research quotes are reused');
});
