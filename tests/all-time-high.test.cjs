const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, elements } = require('./ui-test-helpers.cjs');

test('both testers default ATH investing off with $100, commit amounts on blur and preserve cash flows', async () => {
  for (const indices of [undefined, [{ symbol: '^GSPC', name: 'S&P 500', region: 'U.S.' }]]) {
    const h = hooks(), calls = [];
    const { BacktestView } = load('app/ui/backtest-view.tsx', {
      react: h.react,
      './market-data-provider': { useMarketData: () => ({ series: {}, loadSeries: async id => {
        calls.push(id);
        return { id, name: id, currency: 'USD', history: { points: [100, 110, 90, 121].map((close, i) => ({ date: `2024-01-0${i + 2}`, close })) } };
      } }) },
    });
    const render = () => h.render(() => BacktestView({ indices }));
    const label = name => elements(render(), el => el.props?.['aria-label'] === name)[0];
    const chart = () => elements(render(), el => el.type?.name === 'PerformanceChart')[0].props;
    const investmentTable = () => elements(render(), el => el.type?.name === 'BacktestInvestmentsTable')[0]?.props;
    const toggle = () => label('Invest only at all-time highs');
    assert.equal(toggle().props.checked, false);
    assert.equal(investmentTable(), undefined);
    toggle().props.onChange({ target: { checked: true } });
    assert.equal(label('All-time-high investment amount').props.value, 100);
    assert.equal(calls.length, 0);
    if (indices) elements(render(), el => el.type?.name === 'IndexComparisonEditor')[0].props.onAdd('^GSPC', [1]);
    elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Run backtest'))[0].props.onClick();
    await new Promise(setImmediate);
    const id = chart().portfolios[0].id;
    assert.equal(investmentTable().annual[0].year, '2024');
    assert.equal(investmentTable().annual[0].counts[id], 3, 'only the three ATH investments count, not the starting balance');
    assert.ok(Math.abs(chart().results.at(-1).values[id] - 12431) < 1e-9);
    assert.equal(elements(render(), el => el.props?.['aria-label'] === 'Cash flow amount').length, 1, 'starting balance remains editable; other cash flows are hidden');
    const requests = calls.length;
    const before = chart().results;
    label('All-time-high investment amount').props.onChange({ target: { value: '250.5' } });
    assert.equal(chart().results, before);
    label('All-time-high investment amount').props.onBlur();
    assert.ok(Math.abs(chart().results.at(-1).values[id] - (12100 + 331 * 2.505)) < 1e-9);
    assert.equal(investmentTable().annual[0].counts[id], 3);
    for (const invalid of ['', '-100', 'Infinity']) {
      label('All-time-high investment amount').props.onChange({ target: { value: invalid } });
      label('All-time-high investment amount').props.onBlur();
      assert.equal(label('All-time-high investment amount').props.value, 250.5);
    }
    label('Cash flow amount').props.onChange({ target: { value: '5000' } });
    label('Cash flow amount').props.onBlur();
    assert.ok(Math.abs(chart().results.at(-1).values[id] - (6050 + 331 * 2.505)) < 1e-9);
    toggle().props.onChange({ target: { checked: false } });
    assert.ok(Math.abs(chart().results.at(-1).values[id] - 6050) < 1e-9);
    assert.equal(elements(render(), el => el.props?.['aria-label'] === 'Cash flow amount').length, 2);
    assert.equal(investmentTable(), undefined);
    assert.equal(calls.length, requests);
  }
});

test('each comparison measures highs from its first backtest day, not an older pre-investment record', async () => {
  const h = hooks();
  const histories = {
    '^GSPC': [150, 100, 120, 160],
    '^NDX': [null, 100, 110, 120],
  };
  const indices = Object.keys(histories).map(symbol => ({ symbol, name: symbol, region: 'U.S.' }));
  const { BacktestView } = load('app/ui/backtest-view.tsx', {
    react: h.react,
    './market-data-provider': { useMarketData: () => ({ series: {}, loadSeries: async id => ({ id, name: id, currency: 'USD', history: {
      points: histories[id].flatMap((close, i) => close === null ? [] : [{ date: `2024-01-0${i + 2}`, close }]),
    } }) }) },
  });
  const render = () => h.render(() => BacktestView({ indices }));
  const editor = () => elements(render(), el => el.type?.name === 'IndexComparisonEditor')[0].props;
  editor().onAdd('^GSPC', [1]); editor().onAdd('^NDX', [1]);
  elements(render(), el => el.props?.['aria-label'] === 'Invest only at all-time highs')[0].props.onChange({ target: { checked: true } });
  elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Run backtest'))[0].props.onClick();
  await new Promise(setImmediate);
  const chart = elements(render(), el => el.type?.name === 'PerformanceChart')[0].props;
  const [older, newer] = chart.portfolios;
  assert.deepEqual(Array.from(chart.results, row => Math.round(row.appliedContributions[older.id])), [10100, 100, 100]);
  assert.deepEqual(Array.from(chart.results, row => Math.round(row.appliedContributions[newer.id])), [10100, 100, 100]);
});

test('Nasdaq-100 1x and 3x receive contributions from a 2007 start despite earlier record prices', async () => {
  const h = hooks(), requests = [];
  const points = [300, 250, 210, 180, 155, 135, 120, 110, 100, 110, 120, 105, 130]
    .map((close, i) => ({ date: i < 8 ? `2000-01-${String(i + 2).padStart(2, '0')}` : `2007-01-0${i - 6}`, close }));
  const indices = [{ symbol: '^NDX', name: 'Nasdaq-100', description: '' }];
  const { BacktestView } = load('app/ui/backtest-view.tsx', {
    react: h.react,
    './market-data-provider': { useMarketData: () => ({ series: {},
      loadSeries: async id => { requests.push(id); return { id, name: id, currency: 'USD', history: { points } }; },
      getRiskFreeRates: async () => [{ date: '1999-01-01', rate: .04 }],
    }) },
  });
  const render = () => h.render(() => BacktestView({ indices }));
  const label = name => elements(render(), el => el.props?.['aria-label'] === name)[0];
  elements(render(), el => el.type?.name === 'IndexComparisonEditor')[0].props.onAdd('^NDX', [1, 3]);
  label('Invest only at all-time highs').props.onChange({ target: { checked: true } });
  elements(render(), el => el.type?.name === 'DateInput')[0].props.onChange('2007-01-02');
  elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Run backtest'))[0].props.onClick();
  await new Promise(setImmediate);
  const chart = () => elements(render(), el => el.type?.name === 'PerformanceChart')[0].props;
  const investmentTable = () => elements(render(), el => el.type?.name === 'BacktestInvestmentsTable')[0].props;
  for (const portfolio of chart().portfolios) {
    assert.deepEqual(Array.from(chart().results, row => Math.round(row.appliedContributions[portfolio.id])), [10100, 100, 100, 0, 100]);
    assert.equal(investmentTable().annual[0].counts[portfolio.id], 4);
  }
  elements(render(), el => el.type?.name === 'DateInput')[0].props.onChange('2007-01-05');
  for (const portfolio of chart().portfolios) {
    assert.deepEqual(Array.from(chart().results, row => Math.round(row.appliedContributions[portfolio.id])), [10100, 100]);
    assert.equal(investmentTable().annual[0].counts[portfolio.id], 2);
  }
  assert.deepEqual(requests, ['^NDX'], 'changing the investment start recalculates without reloading prices');
});
