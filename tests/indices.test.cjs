const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks, elements } = require('./ui-test-helpers.cjs');
const directory = load('app/lib/index-directory.ts');
const listings = directory.parseIndexDirectory(fs.readFileSync('public/indices.txt', 'utf8'));
const tick = () => new Promise(setImmediate);

test('index allowlist handles BOM, CRLF, duplicates, suffixes and unknown additions', () => {
  const items = directory.parseIndexDirectory('\uFEFF^GSPC\r\n\n000001.SS\nFTSEMIB.MI\n ^GSPC \nCUSTOM.INDEX\n');
  assert.deepEqual(Array.from(items, item => item.symbol), ['^GSPC', '000001.SS', 'FTSEMIB.MI', 'CUSTOM.INDEX']);
  assert.equal(items[0].name, 'S&P 500');
  assert.equal(items.at(-1).name, 'CUSTOM.INDEX');
  assert.equal(listings.length, 46);
  assert.equal(directory.indexLeverage(1).enabled, false);
  assert.equal(directory.indexLeverage(3).settings.expenseRatio, .0095);
  const a = { enabled: true, settings: { leverage: 3, expenseRatio: .0095, financingSpread: .005 } };
  const b = { enabled: true, settings: { financingSpread: .005, expenseRatio: .0095, leverage: 3 } };
  assert.equal(directory.indexComparisonKey('^GSPC', a), directory.indexComparisonKey('^GSPC', b));
});

test('Indices loads only the static list on activation, preserves it and supports retry', async () => {
  const h = hooks(), calls = [];
  let active = false, fail = true;
  function BacktestView() {}
  const { IndicesView } = load('app/ui/indices-view.tsx', {
    react: h.react, './backtest-view': { BacktestView },
    fetch: async url => { calls.push(url); return { ok: !fail, text: async () => '^GSPC\n^NDX' }; },
  });
  const render = () => h.render(() => IndicesView({ active }));
  render(); assert.equal(calls.length, 0);
  active = true; render(); await tick();
  assert.equal(elements(render(), el => el.props?.role === 'alert').length, 1);
  fail = false;
  elements(render(), el => el.type === 'button')[0].props.onClick(); render(); await tick();
  assert.equal(render().type, BacktestView);
  assert.equal(render().props.indices.length, 2);
  active = false; render(); active = true; render();
  assert.deepEqual(calls, ['/indices.txt', '/indices.txt']);
});

test('picker filters locally and adds checked and custom leverage choices', () => {
  const h = hooks(), adds = [];
  const { IndexComparisonEditor } = load('app/ui/index-comparison-editor.tsx', { react: h.react });
  const render = () => h.render(() => IndexComparisonEditor({ listings, portfolios: [], onAdd: (...args) => adds.push(args), onUpdate() {}, onRemove() {}, onLeverage() {} }));
  const label = value => elements(render(), el => el.props?.['aria-label'] === value)[0];
  label('Search indices').props.onChange({ target: { value: 'nasdaq-100' } });
  let options = elements(render(), el => el.props?.role === 'option');
  assert.equal(options.length, 1);
  options[0].props.onClick();
  const checkboxes = () => elements(render(), el => el.type === 'input' && el.props.type === 'checkbox');
  assert.equal(checkboxes()[0].props.checked, true);
  checkboxes()[2].props.onChange({ target: { checked: true } });
  label('Custom index leverage').props.onChange({ target: { value: '1.5' } });
  elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Add comparisons'))[0].props.onClick();
  assert.equal(adds[0][0], '^NDX');
  assert.deepEqual(Array.from(adds[0][1]), [1, 3, 1.5]);
  label('Clear index search').props.onClick();
  label('Index region').props.onChange({ target: { value: 'Canada' } });
  options = elements(render(), el => el.props?.role === 'option');
  assert.equal(options.length, 1);
  assert.equal(options[0].key, '^GSPTSE');
});

function setup({ failed = [], failRates = false } = {}) {
  const h = hooks(), calls = [], rateCalls = [];
  const series = Object.fromEntries(['^GSPC', '^NDX', '^VIX'].map(symbol => [symbol, {
    id: symbol, name: symbol, currency: 'USD', history: { symbol, quoteType: 'INDEX', points: [
      { date: '2024-01-02', close: 100 }, { date: '2024-01-03', close: 110 }, { date: '2024-01-04', close: 99 },
    ], performance: {} },
  }]));
  function IndexComparisonEditor() {}
  const { BacktestView } = load('app/ui/backtest-view.tsx', {
    react: h.react, './index-comparison-editor': { IndexComparisonEditor },
    './market-data-provider': { useMarketData: () => ({ series, loadSeries: async id => { calls.push(id); if (failed.includes(id)) throw new Error('Unavailable'); return series[id]; }, getRiskFreeRates: async () => { rateCalls.push(1); if (failRates) throw new Error('Rates unavailable'); return [{ date: '2024-01-01', rate: .04 }]; } }) },
  });
  const render = () => h.render(() => BacktestView({ indices: listings }));
  const editor = () => elements(render(), el => el.type === IndexComparisonEditor)[0].props;
  const chart = () => elements(render(), el => el.type?.name === 'PerformanceChart')[0]?.props;
  const run = async () => { elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Run backtest'))[0].props.onClick(); await tick(); };
  const text = () => JSON.stringify(render());
  return { render, editor, chart, run, calls, rateCalls, text };
}

test('indices start empty; additions are allowlisted, deduplicated and pending until Run', async () => {
  const app = setup();
  assert.equal(app.editor().portfolios.length, 0);
  assert.equal(app.calls.length, 0);
  app.editor().onAdd('VTI', [1]);
  assert.equal(app.editor().portfolios.length, 0);
  app.editor().onAdd('^GSPC', [1, 3]);
  app.editor().onAdd('^GSPC', [1, 3]);
  assert.equal(app.editor().portfolios.length, 2);
  assert.equal(app.chart(), undefined);
  assert.equal(app.calls.length, 0);
  await app.run();
  assert.deepEqual(app.calls, ['^GSPC']);
  assert.equal(app.rateCalls.length, 1);
  assert.equal(app.chart().portfolios.length, 2);
  const baseline = app.chart().portfolios[0];
  assert.equal(app.chart().results[0].values[baseline.id], 10000);
  assert.equal(app.chart().results.at(-1).values[baseline.id], 9900);
  assert.match(app.text(), /excludes dividends/);
  const before = app.chart().results;
  app.editor().onAdd('^NDX', [2]);
  assert.equal(app.chart().results, before);
  assert.equal(app.chart().portfolios.length, 2);
});

test('names and colours change immediately, leverage recalculates without loading underlying again', async () => {
  const app = setup();
  app.editor().onAdd('^GSPC', [1, 3]); await app.run();
  const [base, leveraged] = app.editor().portfolios;
  const before = app.chart().results;
  app.editor().onUpdate(leveraged.id, { name: 'My index', color: '#ff0000' });
  assert.equal(app.chart().portfolios[1].name, 'My index');
  assert.equal(app.chart().portfolios[1].color, '#ff0000');
  assert.equal(app.chart().results, before);
  await app.editor().onLeverage(leveraged.id, directory.indexLeverage(2)); await tick();
  assert.notEqual(app.chart().results, before);
  assert.equal(app.chart().portfolios[1].name, 'My index');
  assert.deepEqual(app.calls, ['^GSPC']);
  assert.equal(app.rateCalls.length, 1);
  app.editor().onLeverage(leveraged.id, directory.indexLeverage(1)); await tick();
  assert.match(app.text(), /already exists/);
  assert.equal(app.editor().portfolios[1].leverage.settings.leverage, 2);
  app.editor().onRemove(base.id);
  assert.equal(app.chart().portfolios.length, 2, 'removals remain pending');
  await app.run();
  assert.equal(app.chart().portfolios.length, 1);
});

test('index date ranges, recurring cash flows and chart ranges recalculate locally', async () => {
  const app = setup();
  app.editor().onAdd('^GSPC', [1, 3]); await app.run();
  const initialResults = app.chart().results;
  const dates = elements(app.render(), el => el.type?.name === 'DateInput');
  dates[0].props.onChange('2024-01-03');
  assert.notEqual(app.chart().results, initialResults);
  const beforeFlows = app.chart().results;
  const cash = elements(app.render(), el => el.type === 'input' && el.props.type === 'number' && el.props.min === '0')[1];
  cash.props.onChange({ target: { value: '100' } });
  assert.equal(app.chart().results, beforeFlows, 'amount changes commit on blur');
  elements(app.render(), el => el.type === 'input' && el.props.type === 'number' && el.props.min === '0')[1].props.onBlur();
  assert.notEqual(app.chart().results, beforeFlows);
  const preset = elements(app.render(), el => el.type === 'button' && el.props.children === '1Y')[0];
  preset.props.onClick(); app.render();
  assert.deepEqual(app.calls, ['^GSPC']);
  assert.equal(app.rateCalls.length, 1);
});

test('invalid leverage edits preserve the last valid chart and auto names follow valid edits', async () => {
  const app = setup();
  app.editor().onAdd('^NDX', [3]); await app.run();
  const portfolio = app.editor().portfolios[0];
  app.editor().onLeverage(portfolio.id, directory.indexLeverage(2)); await tick();
  assert.equal(app.chart().portfolios[0].name, '^NDX 2x (sim)');
  const before = app.chart().results;
  app.editor().onLeverage(portfolio.id, { enabled: true, settings: { leverage: NaN, expenseRatio: .0095, financingSpread: .005 } }); await tick();
  assert.equal(app.chart().results, before);
});

test('failed indices do not discard successful comparisons and spot VIX warning is shown', async () => {
  const app = setup({ failed: ['^NDX'] });
  app.editor().onAdd('^GSPC', [1]); app.editor().onAdd('^NDX', [3]); app.editor().onAdd('^VIX', [1]);
  await app.run();
  assert.equal(app.chart().portfolios.length, 2);
  assert.match(app.text(), /\^NDX: Unavailable/);
  assert.match(app.text(), /does not represent VIX futures/);
  const before = app.chart().results;
  for (const item of app.editor().portfolios.filter(item => item.holdings[0].symbol !== '^NDX')) app.editor().onRemove(item.id);
  await app.run();
  assert.equal(app.chart().results, before, 'a completely failed run retains the previous chart');
});

test('missing financing rates preserve successful unleveraged lines', async () => {
  const app = setup({ failRates: true });
  app.editor().onAdd('^GSPC', [1, 3]); await app.run();
  assert.equal(app.chart().portfolios.length, 1);
  assert.match(app.text(), /Rates unavailable/);
});

test('indices route redirects to its own workspace tab', () => {
  let destination;
  load('app/indices/page.tsx', { 'next/navigation': { redirect(url) { destination = url; } } }).default();
  assert.equal(destination, '/?view=indices');
});

test('workspace navigation opens Indices while keeping an independent regular Backtest mounted', () => {
  const h = hooks();
  let params = new URLSearchParams('view=indices');
  function BacktestView() {}
  function IndicesView() {}
  const page = load('app/page.tsx', {
    react: h.react,
    'next/navigation': { useSearchParams: () => params, useRouter: () => ({ push(url) { params = new URL(url, 'https://example.test').searchParams; } }) },
    './ui/ticker-view': { TickerView() {} }, './ui/backtest-view': { BacktestView },
    './ui/etf-directory-view': { EtfDirectoryView() {} }, './ui/indices-view': { IndicesView },
  });
  const Workspace = page.default().props.children.type;
  const render = () => h.render(Workspace);
  const indices = () => elements(render(), el => el.type === IndicesView)[0];
  assert.equal(indices().props.active, true);
  const visible = () => elements(render(), el => el.type === 'div' && el.props.hidden !== undefined).findIndex(el => !el.props.hidden);
  assert.equal(visible(), 3);
  elements(render(), el => el.type?.name === 'NavButton' && el.props.label === 'Backtest')[0].props.onClick();
  assert.equal(indices().props.active, false);
  assert.equal(visible(), 1);
  assert.equal(elements(render(), el => el.type === BacktestView).length, 1);
  assert.equal(elements(render(), el => el.type === IndicesView).length, 1);
});
