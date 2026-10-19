const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, elements } = require('./ui-test-helpers.cjs');
const directory = load('app/lib/index-directory.ts');
const listings = directory.indexListings;
const tick = () => new Promise(setImmediate);

test('index allowlist and metadata come exclusively from JSON', () => {
  const metadata = require('../public/indices.json');
  assert.deepEqual(Array.from(listings, item => item.symbol), Object.keys(metadata));
  for (const item of listings) {
    assert.equal(item.name, metadata[item.symbol].name);
    assert.equal(item.description, metadata[item.symbol].description);
  }
  const custom = load('app/lib/index-directory.ts', {
    '../../public/indices.json': { '^NDX': { name: 'NASDAQ-100', description: 'Index description' } },
  });
  assert.deepEqual(Array.from(custom.indexListings, item => item.symbol), ['^NDX']);
  assert.equal(custom.indexListings[0].description, 'Index description');
  assert.equal(directory.indexLeverage(1).enabled, false);
  assert.equal(directory.indexLeverage(3).settings.expenseRatio, .0095);
  const a = { enabled: true, settings: { leverage: 3, expenseRatio: .0095, financingSpread: .005 } };
  const b = { enabled: true, settings: { financingSpread: .005, expenseRatio: .0095, leverage: 3 } };
  assert.equal(directory.indexComparisonKey('^GSPC', a), directory.indexComparisonKey('^GSPC', b));
});

test('Indices uses bundled JSON without fetching and stays mounted after activation', () => {
  const h = hooks();
  let active = false;
  function BacktestView() {}
  const { IndicesView } = load('app/ui/indices-view.tsx', {
    react: h.react, './backtest-view': { BacktestView },
    fetch: () => { throw new Error('Unexpected network request'); },
  });
  const render = () => h.render(() => IndicesView({ active }));
  assert.equal(render(), null);
  active = true;
  assert.equal(render().type, BacktestView);
  assert.deepEqual(Array.from(render().props.indices, item => item.symbol), Array.from(listings, item => item.symbol));
  active = false;
  assert.equal(render().type, BacktestView);
  active = true;
  assert.equal(render().type, BacktestView);
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
  assert.equal(label('Index region'), undefined);
  label('Search indices').props.onChange({ target: { value: '^GSPTSE' } });
  options = elements(render(), el => el.props?.role === 'option');
  assert.equal(options.length, 1);
  assert.equal(options[0].key, '^GSPTSE');
});

test('index descriptions open independently of selection and close with the button or Escape', () => {
  const h = hooks(), adds = [];
  const { IndexComparisonEditor } = load('app/ui/index-comparison-editor.tsx', { react: h.react });
  const entries = [
    { symbol: '^GSPC', name: 'S&P 500', description: 'Tracks large US companies.' },
    { symbol: '^NDX', name: 'NASDAQ-100', description: '' },
  ];
  const render = () => h.render(() => IndexComparisonEditor({ listings: entries, portfolios: [], onAdd: (...args) => adds.push(args), onUpdate() {}, onRemove() {}, onLeverage() {} }));
  const label = value => elements(render(), el => el.props?.['aria-label'] === value)[0];
  const dialog = () => elements(render(), el => el.type === 'dialog')[0];
  label('About ^GSPC').props.onClick();
  assert.ok(JSON.stringify(dialog()).includes('Tracks large US companies.'));
  assert.equal(elements(render(), el => el.props?.role === 'option' && el.props['aria-selected']).length, 0);
  assert.equal(adds.length, 0);
  label('Close description').props.onClick();
  assert.ok(!JSON.stringify(dialog()).includes('Tracks large US companies.'));
  label('About ^NDX').props.onClick();
  assert.ok(JSON.stringify(dialog()).includes('No description is available from Yahoo Finance'));
  dialog().props.onCancel();
  assert.ok(!JSON.stringify(dialog()).includes('NASDAQ-100'));
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
  const cash = elements(app.render(), el => el.props?.['aria-label'] === 'Cash flow amount')[1];
  cash.props.onChange({ target: { value: '-100' } });
  assert.equal(app.chart().results, beforeFlows, 'amount changes commit on blur');
  elements(app.render(), el => el.props?.['aria-label'] === 'Cash flow amount')[1].props.onBlur();
  assert.notEqual(app.chart().results, beforeFlows);
  assert.equal(app.chart().results[0].contributions, 9900);
  const preset = elements(app.render(), el => el.type === 'button' && el.props.children === '1Y')[0];
  preset.props.onClick(); app.render();
  assert.deepEqual(app.calls, ['^GSPC']);
  assert.equal(app.rateCalls.length, 1);
});

test('both backtest pages commit negative cash flows and reject incomplete amounts', () => {
  for (const indices of [undefined, listings]) {
    const h = hooks();
    const { BacktestView } = load('app/ui/backtest-view.tsx', {
      react: h.react,
      './market-data-provider': { useMarketData: () => ({ series: {}, loadSeries() {}, getRiskFreeRates() {} }) },
    });
    const render = () => h.render(() => BacktestView({ indices }));
    const amount = () => elements(render(), el => el.props?.['aria-label'] === 'Cash flow amount')[1];
    assert.equal(amount().props.min, undefined);
    amount().props.onChange({ target: { value: '-1250.50' } });
    amount().props.onBlur();
    assert.equal(amount().props.value, '-1250.5');
    amount().props.onChange({ target: { value: '' } });
    amount().props.onBlur();
    assert.equal(amount().props.value, '-1250.5');
  }
});

test('percentage recurring cash flows recalculate each comparison locally', async () => {
  const app = setup();
  app.editor().onAdd('^GSPC', [1, 3]); await app.run();
  const unit = () => elements(app.render(), el => el.props?.['aria-label'] === 'Recurring cash flow unit')[0];
  const amount = () => elements(app.render(), el => el.props?.['aria-label'] === 'Cash flow amount')[1];
  assert.equal(unit().props.value, 'dollars');
  amount().props.onChange({ target: { value: '-5' } });
  amount().props.onBlur();
  unit().props.onChange({ target: { value: 'percent' } });
  assert.equal(unit().props.value, 'percent');
  const row = app.chart().results[0];
  for (const portfolio of app.chart().portfolios) assert.equal(row.values[portfolio.id], 9500);
  assert.deepEqual(app.calls, ['^GSPC']);
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
