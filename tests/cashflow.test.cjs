const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('app/ui/backtest-view.tsx', 'utf8');
const code = ts.transpileModule(source.slice(source.indexOf('function calculateResults(')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = vm.createContext({ Date });
vm.runInContext(code, context);
const portfolios = [{ id: 'test', name: 'ETF', holdings: [{ symbol: 'ETF', weight: 100 }] }];
const prices = dates => dates.map(date => ({ date, prices: { ETF: 100 } }));

test('annual contributions occur once per year and move to the next available trading day', () => {
  const history = prices(['2024-01-02', '2024-06-03', '2025-01-02', '2025-06-02', '2026-01-02']);
  const flows = [
    { type: 'initial', amount: 10000 },
    { type: 'recurring', frequency: 'annual', amount: 1000, date: '2024-01-01', startAtBeginning: false },
  ];
  const rows = context.calculateResults(history, portfolios, flows, '', '2026-12-31');
  assert.deepEqual(Array.from(rows, row => row.contributions), [11000, 0, 1000, 0, 1000]);
  assert.equal(rows.at(-1).values.test, 13000);
  const shortened = context.calculateResults(history, portfolios, flows, '', '2025-12-31');
  assert.equal(shortened.at(-1).values.test, 12000);
});

test('annual leap-day contributions use February 28 in non-leap years and recover February 29', () => {
  const history = prices(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-28', '2028-02-29']);
  const rows = context.calculateResults(history, portfolios, [{ type: 'recurring', frequency: 'annual', amount: 100, date: '2024-02-29', startAtBeginning: false }], '', '2028-12-31');
  assert.deepEqual(Array.from(rows, row => row.contributions), [100, 100, 100, 100, 0, 100]);
  assert.equal(rows.at(-1).values.test, 500);
});

test('annual contributions retain month-end anniversaries', () => {
  const history = prices(['2024-01-31', '2025-01-28', '2025-01-31', '2026-01-31']);
  const rows = context.calculateResults(history, portfolios, [{ type: 'recurring', frequency: 'annual', amount: 100, date: '2024-01-31', startAtBeginning: false }], '', '2026-12-31');
  assert.deepEqual(Array.from(rows, row => row.contributions), [100, 0, 100, 100]);
});

test('recurring contributions start at the backtest beginning by default for every frequency', () => {
  const history = prices(['2024-01-02', '2024-01-03', '2024-01-04']);
  for (const frequency of ['weekly', 'monthly', 'quarterly', 'annual']) {
    for (const startAtBeginning of [undefined, true]) {
      const rows = context.calculateResults(history, portfolios, [{ type: 'recurring', frequency, amount: 100, date: '2020-01-01', startAtBeginning }], '', '2024-12-31');
      assert.deepEqual(Array.from(rows, row => row.contributions), [100, 0, 0]);
    }
  }
});

test('checked recurring schedules follow changed custom ranges and return to inception when cleared', () => {
  const history = prices(['2024-01-02', '2024-01-09', '2024-01-16', '2024-02-02', '2024-02-09', '2024-02-16']);
  const flows = [{ type: 'recurring', frequency: 'weekly', amount: 100, date: '', startAtBeginning: true }];
  const initial = context.calculateResults(history, portfolios, flows, '', '2024-01-16');
  assert.deepEqual(Array.from(initial, row => row.contributions), [100, 100, 100]);
  const changed = context.calculateResults(history, portfolios, flows, '2024-02-02', '2024-02-16');
  assert.deepEqual(Array.from(changed, row => row.contributions), [100, 100, 100]);
  assert.equal(changed[0].values.test, 100, 'no earlier recurring contributions may accumulate');
  const weekend = context.calculateResults(history, portfolios, flows, '2024-02-03', '2024-02-16');
  assert.equal(weekend[0].date, '2024-02-09');
  assert.equal(weekend[0].contributions, 100);
  const cleared = context.calculateResults(history, portfolios, flows, '', '2024-01-16');
  assert.deepEqual(Array.from(cleared, row => row.contributions), [100, 100, 100]);
});

test('unchecked recurring schedules use the custom date and empty custom dates are ignored', () => {
  const history = prices(['2024-01-02', '2024-01-09', '2024-01-16']);
  const flow = { type: 'recurring', frequency: 'weekly', amount: 100, date: '2024-01-09', startAtBeginning: false };
  const rows = context.calculateResults(history, portfolios, [flow], '', '2024-01-16');
  assert.deepEqual(Array.from(rows, row => row.contributions), [0, 100, 100]);
  const empty = context.calculateResults(history, portfolios, [{ ...flow, date: '' }], '', '2024-01-16');
  assert.ok(empty.every(row => row.contributions === 0));
});

test('range-anchored recurring contributions never accumulate before price history begins', () => {
  const history = prices(['2024-01-02', '2024-01-09', '2024-01-16']);
  const flow = { type: 'recurring', frequency: 'weekly', amount: 100, date: '', startAtBeginning: true };
  const rows = context.calculateResults(history, portfolios, [flow], '2020-01-01', '2024-01-16');
  assert.deepEqual(Array.from(rows, row => row.contributions), [100, 100, 100]);
});
