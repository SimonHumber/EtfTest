const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, elements } = require('./ui-test-helpers.cjs');

test('both testers show starting capital plus normal contributions with additional purchase counts', async () => {
  for (const indices of [undefined, [{ symbol: '^NDX', name: 'Nasdaq-100', description: '' }]]) {
    const h = hooks(), calls = [];
    const { BacktestView } = load('app/ui/backtest-view.tsx', {
      react: h.react,
      './market-data-provider': { useMarketData: () => ({ series: {}, loadSeries: async id => {
        calls.push(id);
        return { id, name: id, currency: 'USD', history: { points: [
          { date: '2024-01-02', close: 100 }, { date: '2024-02-02', close: 110 }, { date: '2024-03-02', close: 121 },
        ] } };
      } }) },
    });
    const render = () => h.render(() => BacktestView({ indices }));
    const summary = () => elements(render(), el => el.type === 'p' && el.props.title === 'Starting balance plus additional deposits, excluding market gains')[0];
    const amounts = () => elements(render(), el => el.props?.['aria-label'] === 'Cash flow amount');
    const setAmount = (index, value) => { amounts()[index].props.onChange({ target: { value } }); amounts()[index].props.onBlur(); };
    if (indices) elements(render(), el => el.type?.name === 'IndexComparisonEditor')[0].props.onAdd('^NDX', [1]);
    elements(render(), el => el.type === 'button' && el.props.children?.includes?.('Run backtest'))[0].props.onClick();
    await new Promise(setImmediate);
    assert.equal(summary().props.children[1].props.children, '$10,000');
    assert.equal(summary().props.children[0], 'Book value ');
    assert.equal(summary().props.children[3], 0);
    const requests = calls.length;
    setAmount(1, '1000');
    assert.equal(summary().props.children[1].props.children, '$13,000');
    assert.equal(summary().props.children[3], 3);
    setAmount(0, '5000');
    assert.equal(summary().props.children[1].props.children, '$8,000');
    assert.equal(summary().props.children[3], 3);
    assert.equal(calls.length, requests);
  }
});
