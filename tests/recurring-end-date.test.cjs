const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, elements } = require('./ui-test-helpers.cjs');

test('recurring end date defaults blank, updates cached results and clears in Backtest and Indices', async () => {
  for (const indices of [undefined, [{ symbol: '^GSPC', name: 'S&P 500', region: 'U.S.' }]]) {
    const h = hooks(), calls = [];
    const { BacktestView } = load('app/ui/backtest-view.tsx', {
      react: h.react,
      './market-data-provider': { useMarketData: () => ({ series: {}, loadSeries: async id => {
        calls.push(id);
        return { id, name: id, currency: 'USD', history: { points: ['2024-01-02', '2024-02-02', '2024-03-02'].map(date => ({ date, close: 100 })) } };
      } }) },
    });
    const render = () => h.render(() => BacktestView({ indices }));
    const label = name => elements(render(), el => el.props?.['aria-label'] === name)[0];
    const chart = () => elements(render(), el => el.type?.name === 'PerformanceChart')[0].props;
    assert.equal(label('Recurring contribution end date').props.value, '');
    assert.equal(calls.length, 0);
    if (indices) elements(render(), el => el.type?.name === 'IndexComparisonEditor')[0].props.onAdd('^GSPC', [1]);
    label('Recurring contribution end date').props.onChange({ target: { value: '2024-02-02' } });
    assert.equal(calls.length, 0);
    elements(render(), el => el.props?.['aria-label'] === 'Cash flow amount')[1].props.onChange({ target: { value: '100' } });
    elements(render(), el => el.props?.['aria-label'] === 'Cash flow amount')[1].props.onBlur();
    elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Run backtest'))[0].props.onClick();
    await new Promise(setImmediate);
    const id = chart().portfolios[0].id;
    assert.equal(chart().results.at(-1).values[id], 10200);
    const requests = calls.length;
    label('Clear recurring contribution end date').props.onClick();
    assert.equal(label('Recurring contribution end date').props.value, '');
    assert.equal(chart().results.at(-1).values[id], 10300);
    label('Recurring contribution end date').props.onChange({ target: { value: '2024-01-01' } });
    assert.equal(chart().results.at(-1).values[id], 10000);
    assert.equal(elements(render(), el => el.props?.role === 'alert').length, 1);
    assert.equal(calls.length, requests);
  }
});
