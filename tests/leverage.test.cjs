const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, overrides = {}, cache = new Map()) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  const output = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  cache.set(absolute, exports);
  vm.runInNewContext(output, {
    exports, fetch: overrides.fetch, Date, Float64Array, AbortController,
    crypto: { randomUUID: () => 'new-id' },
    require(id) {
      if (id in overrides) return overrides[id];
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(absolute), id);
        if (base.endsWith('.json')) return { default: JSON.parse(fs.readFileSync(base, 'utf8')) };
        return load(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`, overrides, cache);
      }
      return require(id);
    },
  });
  return exports;
}

const core = load('app/lib/leverage.ts');
const settings = { ...core.defaultLeverageSettings };
const rates = [{ date: '2024-01-01', rate: .04 }, { date: '2024-01-03', rate: .9 }];
const point = (date, close) => ({ date, close, return: 0 });
function source(symbol = 'ANY', closes = [100, 110, 99]) {
  return { id: symbol, name: symbol, currency: 'USD', history: { symbol, points: closes.map((close, i) => point(`2024-01-0${i + 1}`, close)), performance: {}, intradayPoints: { '5m': [point('2024-01-02T09:30:00', 105), point('2024-01-02T15:55:00', closes[1])], '30m': [point('2024-01-02T09:30:00', 105), point('2024-01-02T15:30:00', closes[1])] } } };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

test('3x default uses own daily returns, fees, financing, and path-dependent compounding', () => {
  const result = core.simulateLeverage(source(), settings, rates);
  const cost = (.0095 + 2 * (.04 + .005)) / 252;
  near(result.history.points[0].close, 100);
  near(result.history.points[1].close, 100 * (1 + 3 * .1 - cost));
  near(result.history.points[2].close, 100 * (1 + 3 * .1 - cost) * (1 - 3 * .1 - cost));
  assert.equal(result.name, 'ANY 3x (sim)');
  assert.notEqual(result.history.points[2].close, 97);
});

test('inverse financing earns the specified collateral rate and fractional leverage has no financing', () => {
  for (const leverage of [-3, -2, -1, 0, .5, 1, 1.5, 2]) {
    const result = core.simulateLeverage(source(), { ...settings, leverage }, rates);
    const financing = leverage >= 1 ? (leverage - 1) * .045 : leverage < 0 ? -Math.abs(leverage) * .035 : 0;
    near(result.history.points[1].close, 100 * (1 + leverage * .1 - (.0095 + financing) / 252));
  }
});

test('1x without costs reproduces adjusted prices, including weekend observations and sub-penny crypto', () => {
  const original = source('MEME-USD', [.00000001, .000000012, .000000009]);
  const result = core.simulateLeverage(original, { leverage: 1, expenseRatio: 0, financingSpread: 0 }, rates);
  result.history.points.forEach((p, i) => near(p.close, original.history.points[i].close));
  assert.ok(result.history.points.every(p => p.close > 0));
});

test('a clipped total loss never revives and produces -100% drawdown', () => {
  const result = core.simulateLeverage(source('WIPEOUT', [100, 50, 200]), settings, rates);
  assert.equal(result.history.points[1].close, 0);
  assert.equal(result.history.points[2].close, 0);
  assert.equal(core.maximumDrawdown(result.history.points), -100);
});

test('historical financing rates are lagged and do not look ahead', () => {
  const sparseRates = [{ date: '2024-01-01', rate: .01 }, { date: '2024-01-03', rate: .99 }];
  const result = core.simulateLeverage(source(), settings, sparseRates);
  const cost = (.0095 + 2 * .015) / 252;
  near(result.history.points[2].close, 100 * (1.3 - cost) * (.7 - cost));
});

test('intraday marks do not compound leverage per bar and match the daily close', () => {
  const result = core.simulateLeverage(source(), settings, rates);
  const intraday = result.history.intradayPoints['5m'];
  near(intraday.at(-1).close, result.history.points[1].close);
  near(intraday[0].close, 100 * (1 + .05 * 3 - (.0095 + 2 * .045) / 252 / 2));
});

test('distinct settings coexist and identical settings have a stable identity for replacement', () => {
  const a = core.simulateLeverage(source('^NDX'), settings, rates);
  const b = core.simulateLeverage(source('^NDX'), { ...settings, leverage: 2 }, rates);
  const c = core.simulateLeverage(source('^NDX'), { ...settings, expenseRatio: .01 }, rates);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.equal(a.id, core.simulateLeverage(source('^NDX'), settings, rates).id);
  const tinySettings = { ...settings, expenseRatio: 1e-10, leverage: 1e-8 };
  const tinyId = core.simulationId('LOW', tinySettings);
  assert.equal(tinyId, tinyId.toUpperCase());
});

test('works on arbitrary assets without preset mappings and warns for known price-only indices', () => {
  for (const symbol of ['AAPL', 'ETF.TO', '^GSPC', '^NDX', 'BTC-USD', 'NEW.UNKNOWN']) {
    assert.ok(core.simulateLeverage(source(symbol), settings, rates).history.points.length);
  }
  assert.ok(core.indexWarning(source('^GSPC')).includes('^SP500TR'));
  assert.ok(core.indexWarning(source('^NDX')).includes('^XNDX'));
});

test('limited rate coverage is explicit; invalid data and missing rates fail instead of fabricating returns', () => {
  const result = core.simulateLeverage(source(), settings, [{ date: '2024-01-02', rate: .04 }]);
  assert.equal(result.history.points[0].date, '2024-01-02');
  assert.ok(result.simulation.coverageWarning.includes('2024-01-02'));
  assert.throws(() => core.simulateLeverage(source(), settings, []));
  assert.throws(() => core.simulateLeverage(source(), { ...settings, expenseRatio: -1 }, rates));
  assert.throws(() => core.simulateLeverage(source(), { ...settings, leverage: Infinity }, rates));
  assert.throws(() => core.simulateLeverage(source('BAD', [100, 0, 1]), settings, rates));
});

test('backtest alignment accepts local simulated IDs and preserves zero prices', () => {
  const original = source('BASE', [100, 50, 200]);
  const sim = core.simulateLeverage(original, settings, rates);
  const merged = core.combineSeries([original, sim]);
  assert.equal(merged.priceHistory.length, 3);
  assert.equal(merged.priceHistory[1].prices[sim.id], 0);
  assert.equal(merged.priceHistory[2].prices.BASE, 200);
});

test('portfolio leverage acts on the weighted basket before clipping and charges expenses once', () => {
  const down = source('DOWN', [100, 50, 60]);
  const up = source('UP', [100, 200, 180]);
  const basket = core.createPortfolioBasket('weighted', 'Weighted portfolio', [{ series: down, weight: 50 }, { series: up, weight: 50 }]);
  near(basket.history.points[1].close, 125);
  near(basket.history.points[2].close, 125 * 1.05);
  const leveraged = core.simulateLeverage(basket, settings, rates);
  const cost = (.0095 + 2 * .045) / 252;
  near(leveraged.history.points[1].close, 100 * (1.75 - cost));
  near(leveraged.history.points[2].close, 100 * (1.75 - cost) * (1.15 - cost));
  near(basket.history.intradayPoints['5m'].at(-1).close, basket.history.points[1].close);
  assert.throws(() => core.createPortfolioBasket('empty', 'Empty', [{ series: up, weight: 0 }]));
});

function hooks() {
  const state = [], memo = [];
  let cursor = 0;
  return {
    reset() { cursor = 0; },
    react: {
      createContext: () => ({ Provider: 'provider' }),
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
      useRef(initial) { const i = cursor++; state[i] ??= { current: initial }; return state[i]; },
      useCallback: fn => fn,
      useEffect() {},
      useMemo(fn, deps) { const i = cursor++; if (!memo[i] || deps.some((d, j) => d !== memo[i].deps[j])) memo[i] = { deps, value: fn() }; return memo[i].value; },
    },
  };
}

test('shared cache: no initial fetch, one rate request, no underlying re-download, and replace rather than duplicate', async () => {
  const h = hooks();
  const requests = [];
  const provider = load('app/ui/market-data-provider.tsx', {
    react: h.react,
    fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => url === '/api/market/rates' ? { symbol: '^IRX', points: rates } : source('ANY').history };
    },
  });
  const render = () => { h.reset(); return provider.MarketDataProvider({ children: null }).props.value; };
  let market = render();
  assert.equal(requests.length, 0);
  await market.loadSeries('ANY');
  const [first] = await market.applyLeverage(['ANY'], settings);
  await market.applyLeverage(['ANY'], settings);
  await market.applyLeverage(['ANY'], { ...settings, leverage: 2 });
  await market.loadSeries(first.id);
  market = render();
  assert.equal(Object.keys(market.series).length, 3);
  assert.equal(requests.filter(url => url.includes('/history?')).length, 1);
  assert.equal(requests.filter(url => url === '/api/market/rates').length, 1);
});

test('concurrent simulations share financing fetches and a failed rate fetch can be retried', async () => {
  const h = hooks();
  let rateRequests = 0;
  let fail = true;
  const provider = load('app/ui/market-data-provider.tsx', {
    react: h.react,
    fetch: async url => {
      if (url === '/api/market/rates') {
        rateRequests += 1;
        return { ok: !fail, json: async () => fail ? { error: 'Rates unavailable' } : { symbol: '^IRX', points: rates } };
      }
      return { ok: true, json: async () => source().history };
    },
  });
  const render = () => { h.reset(); return provider.MarketDataProvider({ children: null }).props.value; };
  let market = render();
  await assert.rejects(market.applyLeverage(['NOT-LOADED'], settings), /Load/);
  assert.equal(rateRequests, 0);
  await market.loadSeries('ANY');
  await assert.rejects(market.applyLeverage(['ANY'], settings), /Rates unavailable/);
  market = render();
  assert.equal(Object.keys(market.series).length, 1);
  fail = false;
  await Promise.all([market.applyLeverage(['ANY'], settings), market.applyLeverage(['ANY'], { ...settings, leverage: 2 })]);
  assert.equal(rateRequests, 2);
  assert.equal(Object.keys(render().series).length, 3);
});

test('Research tables calculate total loss and annualized returns from the simulated series', () => {
  const sourceText = fs.readFileSync('app/ui/ticker-view.tsx', 'utf8');
  const output = ts.transpileModule(sourceText.slice(sourceText.indexOf('function hasNumber(')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ maximumDrawdown: core.maximumDrawdown });
  vm.runInContext(output, context);
  const simulation = core.simulateLeverage(source('BASE', [100, 50, 200]), settings, rates);
  const result = context.returnsForRange(simulation.history, 'Max');
  assert.equal(result.total, -100);
  assert.equal(result.annualized, -100);
  assert.equal(result.drawdown, -100);
  assert.equal(context.returnsForRange(simulation.history, '10Y').annualized, null);
});

function elements(element, predicate, found = []) {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) elements(child, predicate, found);
  return found;
}

test('Apply Leverage defaults need no input, and custom leverage stays editable through a preset value', async () => {
  const h = hooks();
  const applied = [];
  const series = { ANY: source() };
  const control = load('app/ui/leverage-control.tsx', {
    react: h.react,
    './market-data-provider': { useMarketData: () => ({ series, applyLeverage: async (ids, params) => { applied.push({ ids, params }); return []; } }) },
  });
  const render = () => { h.reset(); return control.LeverageControl({ sourceIds: ['ANY'], onApplied() {} }); };
  const apply = async () => { elements(render(), el => el.type === 'button')[0].props.onClick(); await new Promise(setImmediate); };
  await apply();
  assert.equal(applied[0].params.leverage, 3);
  assert.equal(applied[0].params.expenseRatio, .0095);
  assert.equal(applied[0].params.financingSpread, .005);
  elements(render(), el => el.type === 'select')[0].props.onChange({ target: { value: 'custom' } });
  let custom = elements(render(), el => el.props?.['aria-label'] === 'Custom leverage')[0];
  custom.props.onChange({ target: { value: '2' } });
  custom = elements(render(), el => el.props?.['aria-label'] === 'Custom leverage')[0];
  assert.ok(custom);
  custom.props.onChange({ target: { value: '2.5' } });
  await apply();
  assert.equal(applied[1].params.leverage, 2.5);
});

test('colours and leverage update immediately while ticker edits stay pending', async () => {
  const h = hooks();
  const real = ['VTI', 'VXUS', 'BND', 'VOO'].map(symbol => source(symbol));
  const byId = Object.fromEntries(real.map(item => [item.id, item]));
  const loadedIds = [];
  let rateCalls = 0;
  let ratesFail = false;
  function BacktestTickerInput() {}
  function PortfolioLeverageOptions() {}
  const view = load('app/ui/backtest-view.tsx', {
    react: h.react,
    './backtest-ticker-input': { BacktestTickerInput },
    './portfolio-leverage-options': { PortfolioLeverageOptions },
    './chart-hover': { ChartHover() {} },
    './market-data-provider': { useMarketData: () => ({
      series: byId,
      loadSeries: async id => { loadedIds.push(id); return byId[id]; },
      getRiskFreeRates: async () => { rateCalls += 1; if (ratesFail) throw new Error('Rates unavailable'); return rates; },
    }) },
  });
  const render = () => { h.reset(); return view.BacktestView(); };
  const chart = () => elements(render(), el => el.type?.name === 'PerformanceChart')[0]?.props;
  const options = index => elements(render(), el => el.type === PortfolioLeverageOptions)[index].props;
  const run = async () => {
    elements(render(), el => el.type === 'button' && el.props.children?.some?.(child => child === 'Run backtest'))[0].props.onClick();
    await new Promise(setImmediate);
  };
  await run();
  assert.equal(rateCalls, 0);
  const originalResults = chart().results;
  const loadsBeforeRename = loadedIds.length;
  elements(render(), el => el.type === 'input' && el.props['aria-label'] === 'Portfolio name')[0].props.onChange({ target: { value: 'My portfolio' } });
  assert.equal(chart().portfolios[0].name, 'My portfolio');
  assert.equal(chart().results, originalResults);
  assert.equal(loadedIds.length, loadsBeforeRename);
  elements(render(), el => el.type === 'input' && el.props.type === 'color')[0].props.onChange({ target: { value: '#e11d48' } });
  assert.equal(chart().portfolios[0].color, '#e11d48');
  assert.equal(chart().results, originalResults, 'colour changes do not recalculate returns');
  assert.equal(loadedIds.length, loadsBeforeRename);
  const before = JSON.stringify(chart());
  elements(render(), el => el.type === BacktestTickerInput)[0].props.onChange('NOT-LOADED');
  assert.equal(JSON.stringify(chart()), before, 'ticker edits stay pending');
  options(0).onChange({ enabled: true, settings: { ...settings, leverage: 2 } });
  options(0).onChange({ enabled: false, settings: { ...settings, leverage: 2 } });
  await new Promise(setImmediate);
  near(chart().results.at(-1).values.core, 9900, 'a late rates response cannot undo disabling leverage');
  assert.equal(rateCalls, 1);
  options(0).onChange({ enabled: true, settings: { ...settings, leverage: 2 } });
  assert.equal(chart().portfolios.length, 2, 'no extra comparison portfolios are created');
  assert.ok(chart().portfolios[0].holdings[0].symbol.startsWith('SIM|PORTFOLIO|CORE'));
  assert.equal(chart().portfolios[1].holdings[0].symbol, 'VOO');
  const cost2 = (.0095 + .045) / 252;
  near(chart().results.at(-1).values.core, 10000 * (1.2 - cost2) * (.8 - cost2));
  near(chart().results.at(-1).values.alternative, 9900);
  assert.equal(options(0).value.settings.leverage, 2);
  assert.equal(options(1).value, undefined);
  const holdings = elements(render(), el => el.type === BacktestTickerInput);
  assert.equal(holdings.length, 4, 'the original weighted holding editor remains intact');
  assert.equal(holdings[0].props.value, 'NOT-LOADED', 'pending ticker stays in the editor only');
  assert.equal(loadedIds.length, loadsBeforeRename, 'live leverage never loads pending tickers');
  const after = JSON.stringify(chart());
  options(0).onChange({ enabled: true, settings: { ...settings, leverage: NaN } });
  assert.equal(JSON.stringify(chart()), after, 'an empty numeric field keeps the last valid chart');
  options(0).onChange({ enabled: true, settings: { ...settings, leverage: -1 } });
  options(1).onChange({ enabled: true, settings: { leverage: 3, expenseRatio: .02, financingSpread: .01 } });
  const inverseCost = (.0095 - .035) / 252;
  const cost3 = (.02 + 2 * .05) / 252;
  near(chart().results.at(-1).values.core, 10000 * (.9 - inverseCost) * (1.1 - inverseCost));
  near(chart().results.at(-1).values.alternative, 10000 * (1.3 - cost3) * (.7 - cost3));
  assert.equal(chart().portfolios.length, 2);
  assert.equal(chart().portfolios[0].color, '#e11d48');
  assert.equal(rateCalls, 1, 'cached rates apply immediately without another request');
  options(0).onChange({ ...options(0).value, enabled: false });
  near(chart().results.at(-1).values.core, 9900, 'disabling restores original returns');
  assert.equal(options(0).value.settings.leverage, -1, 'disabling retains configured settings');
  elements(render(), el => el.type === BacktestTickerInput)[0].props.onChange('VTI');
  const successful = JSON.stringify(chart());
  ratesFail = true;
  await run();
  assert.equal(JSON.stringify(chart()), successful, 'failed rates preserve the last result');
});
