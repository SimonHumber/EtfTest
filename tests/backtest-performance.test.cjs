const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, elements } = require('./ui-test-helpers.cjs');
const { calculateBacktestPerformance, calculateAnnualInvestments } = load('app/lib/backtest-performance.ts');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('calendar returns include year-boundary growth and CAGR uses elapsed investment dates', () => {
  const rows = [
    { date: '2020-06-30', values: { a: 100 }, contributions: 100 },
    { date: '2020-12-31', values: { a: 220 }, contributions: 100 },
    { date: '2021-01-04', values: { a: 121 }, contributions: -121 },
    { date: '2021-12-31', values: { a: 133.1 }, contributions: 0 },
    { date: '2022-06-30', values: { a: 146.41 }, contributions: 0 },
  ];
  const result = calculateBacktestPerformance(rows, ['a']);
  assert.equal(result.startDate, '2020-06-30');
  assert.equal(result.endDate, '2022-06-30');
  assert.deepEqual(Array.from(result.annual, period => period.year), ['2020', '2021', '2022']);
  near(result.annual[0].returns.a, 20);
  near(result.annual[1].returns.a, 21);
  near(result.annual[2].returns.a, 10);
  near(result.cagr.a, (1.5972 ** (365.25 / 730) - 1) * 100);
});

test('per-portfolio ATH and percentage cash flows do not inflate annual returns or CAGR', () => {
  const rows = [
    { date: '2023-01-02', values: { a: 100, b: 500 }, contributions: 0, appliedContributions: { a: 100, b: 500 } },
    { date: '2024-01-02', values: { a: 210, b: 1100 }, contributions: 0, appliedContributions: { a: 100, b: 550 } },
    { date: '2025-01-02', values: { a: 1231, b: 605 }, contributions: 0, appliedContributions: { a: 1000, b: -605 } },
  ];
  const result = calculateBacktestPerformance(rows, ['a', 'b']);
  for (const id of ['a', 'b']) {
    near(result.annual[1].returns[id], 10);
    near(result.annual[2].returns[id], 10);
    near(result.cagr[id], (1.21 ** (365.25 / 731) - 1) * 100);
  }
});

test('zero or single observations do not annualize; a total market loss remains -100%', () => {
  const empty = calculateBacktestPerformance([], ['a']);
  assert.equal(empty.startDate, null);
  assert.equal(empty.cagr.a, null);
  const single = calculateBacktestPerformance([{ date: '2024-01-02', values: { a: 100 }, contributions: 100 }], ['a']);
  assert.equal(single.cagr.a, null);
  assert.equal(single.annual[0].returns.a, null);
  const unfunded = calculateBacktestPerformance([
    { date: '2024-01-02', values: { a: 0 }, contributions: 0 },
    { date: '2025-01-02', values: { a: 0 }, contributions: 0 },
  ], ['a']);
  assert.equal(unfunded.cagr.a, null);
  const loss = calculateBacktestPerformance([
    { date: '2024-01-02', values: { a: 100 }, contributions: 100 },
    { date: '2024-02-02', values: { a: 100 }, contributions: 100 },
    { date: '2025-01-02', values: { a: 200 }, contributions: 0 },
  ], ['a']);
  assert.equal(loss.annual[0].returns.a, -100);
  assert.equal(loss.cagr.a, -100);
});

test('a full withdrawal does not count as a market loss', () => {
  const result = calculateBacktestPerformance([
    { date: '2024-01-02', values: { a: 100 }, contributions: 100 },
    { date: '2025-01-02', values: { a: 0 }, contributions: -110, appliedContributions: { a: -110 } },
  ], ['a']);
  near(result.annual[1].returns.a, 10);
});

test('annual investment counts use actual ATH events, include zero years and exclude starting balances', () => {
  const annual = calculateAnnualInvestments([
    { date: '2020-01-02', contributions: 10000 },
    { date: '2020-01-03', athPurchases: { a: 1, b: 0 } },
    { date: '2020-12-31', athPurchases: { a: 1, b: 1 } },
    { date: '2021-01-04', athPurchases: { a: 0, b: 0 } },
    { date: '2022-01-03', athPurchases: { a: 0, b: 1 } },
  ], ['a', 'b']);
  assert.deepEqual(JSON.parse(JSON.stringify(annual)), [
    { year: '2020', counts: { a: 2, b: 1 } },
    { year: '2021', counts: { a: 0, b: 0 } },
    { year: '2022', counts: { a: 0, b: 1 } },
  ]);
  assert.equal(calculateAnnualInvestments([], ['a']).length, 0);
});

test('both testers update returns locally, preserve the investment period on chart zoom and follow live labels', async () => {
  for (const indices of [undefined, [{ symbol: '^NDX', name: 'Nasdaq-100', description: '' }]]) {
    const h = hooks(), calls = [];
    const { BacktestView } = load('app/ui/backtest-view.tsx', {
      react: h.react,
      './market-data-provider': { useMarketData: () => ({ series: {}, loadSeries: async id => {
        calls.push(id);
        return { id, name: id, currency: 'USD', history: { points: [
          { date: '2020-01-02', close: 100 }, { date: '2020-12-31', close: 110 },
          { date: '2021-12-31', close: 121 }, { date: '2022-01-03', close: 133.1 },
        ] } };
      } }) },
    });
    const render = () => h.render(() => BacktestView({ indices }));
    const table = () => elements(render(), el => el.type?.name === 'BacktestReturnsTable')[0].props;
    const label = name => elements(render(), el => el.props?.['aria-label'] === name)[0];
    assert.equal(table().performance.startDate, null);
    assert.equal(calls.length, 0);
    if (indices) elements(render(), el => el.type?.name === 'IndexComparisonEditor')[0].props.onAdd('^NDX', [1]);
    elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Run backtest'))[0].props.onClick();
    await new Promise(setImmediate);
    const before = table().performance;
    const id = table().portfolios[0].id;
    for (const period of before.annual) near(period.returns[id], 10);
    elements(render(), el => el.type === 'button' && el.props.children === '1Y')[0].props.onClick();
    assert.equal(table().performance, before);
    label('Invest only at all-time highs').props.onChange({ target: { checked: true } });
    near(table().performance.cagr[id], before.cagr[id]);
    label('All-time-high investment amount').props.onChange({ target: { value: '100000' } });
    label('All-time-high investment amount').props.onBlur();
    near(table().performance.cagr[id], before.cagr[id]);
    if (indices) elements(render(), el => el.type?.name === 'IndexComparisonEditor')[0].props.onUpdate(id, { name: 'Renamed comparison', color: '#ff0000' });
    else label('Portfolio name').props.onChange({ target: { value: 'Renamed comparison' } });
    assert.equal(table().portfolios[0].name, 'Renamed comparison');
    const requests = calls.length;
    elements(render(), el => el.type?.name === 'DateInput')[0].props.onChange('2021-12-31');
    assert.equal(table().performance.startDate, '2021-12-31');
    assert.deepEqual(Array.from(table().performance.annual, period => period.year), ['2021', '2022']);
    assert.equal(calls.length, requests);
  }
});

test('return table renders signed percentages, actual coverage dates and an internal mobile scroll region', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { BacktestReturnsTable } = load('app/ui/backtest-returns-table.tsx');
  const html = renderToStaticMarkup(React.createElement(BacktestReturnsTable, {
    portfolios: [{ id: 'a', name: 'LongPortfolioName'.repeat(10), color: '#ff0000' }],
    performance: { startDate: '2023-05-01', endDate: '2024-06-28', annual: [
      { year: '2023', from: '2023-05-01', to: '2023-12-29', returns: { a: 10 } },
      { year: '2024', from: '2024-01-02', to: '2024-06-28', returns: { a: -5 } },
    ], cagr: { a: null } },
  }));
  assert.ok(html.includes('+10.00%'));
  assert.ok(html.includes('-5.00%'));
  assert.ok(html.includes('May 1, 2023'));
  assert.ok(html.includes('overflow-x-auto'));
  assert.ok(html.includes('Since investment start'));
  assert.ok(html.includes('scope="row"'));
  assert.ok(html.indexOf('>CAGR<') < html.indexOf('>2023<'), 'CAGR appears before annual return rows');
});

test('ATH investment table renders year counts, totals and a bounded mobile scroll region', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { BacktestInvestmentsTable } = load('app/ui/backtest-returns-table.tsx');
  const html = renderToStaticMarkup(React.createElement(BacktestInvestmentsTable, {
    portfolios: [{ id: 'a', name: 'Portfolio', color: '#17724a' }],
    annual: [{ year: '2023', counts: { a: 12 } }, { year: '2024', counts: { a: 0 } }],
  }));
  assert.ok(html.includes('Starting balance excluded'));
  assert.ok(html.includes('>Total<'));
  assert.ok(html.includes('>2024<'));
  assert.ok(html.includes('>0</td>'));
  assert.equal((html.match(/>12<\/td>/g) ?? []).length, 2, 'the total equals the year count');
  assert.ok(html.includes('overflow-x-auto'));
  assert.equal(renderToStaticMarkup(React.createElement(BacktestInvestmentsTable, { portfolios: [], annual: [] })), '');
});
