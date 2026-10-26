const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync('app/ui/backtest-view.tsx', 'utf8');
const code = ts.transpileModule(source.slice(source.indexOf('function portfolioDrawdown(')), {
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


test('retirement withdrawals apply after market returns and roll forward to trading days', () => {
  const history = [
    { date: '2024-01-05', prices: { ETF: 100 } },
    { date: '2024-01-08', prices: { ETF: 110 } },
    { date: '2024-02-05', prices: { ETF: 99 } },
  ];
  const rows = context.calculateResults(history, portfolios, [
    { type: 'initial', amount: 10000 },
    { type: 'recurring', frequency: 'monthly', amount: -1000, startAtBeginning: true },
    { type: 'one-time', date: '2024-01-06', amount: -500 },
  ], '', '2024-02-05');
  assert.deepEqual(Array.from(rows, row => row.contributions), [9000, -500, -1000]);
  assert.deepEqual(Array.from(rows, row => Math.round(row.values.test)), [9000, 9400, 7460]);
});

test('every recurring frequency accepts withdrawals', () => {
  const history = prices(['2024-01-02', '2025-01-02']);
  for (const frequency of ['weekly', 'monthly', 'quarterly', 'annual']) {
    const rows = context.calculateResults(history, portfolios, [
      { type: 'initial', amount: 100000 },
      { type: 'recurring', frequency, amount: -100, startAtBeginning: true },
    ], '', '2025-01-02');
    assert.equal(rows[0].values.test, 99900);
    assert.ok(rows[1].contributions < 0);
    assert.equal(rows[1].values.test, 99900 + rows[1].contributions);
  }
});


test('withdrawals stop at zero and market gains cannot revive an exhausted retirement portfolio', () => {
  const history = [100, 110, 220, 330].map((price, i) => ({ date: `2024-01-0${i + 2}`, prices: { ETF: price } }));
  const rows = context.calculateResults(history, portfolios, [
    { type: 'initial', amount: 1000 },
    { type: 'one-time', date: '2024-01-03', amount: -2000 },
  ], '', '2024-01-05');
  assert.deepEqual(Array.from(rows, row => row.values.test), [1000, 0, 0, 0]);
  assert.equal(rows[1].appliedContributions.test, -1100);
  assert.equal(context.portfolioDrawdown(rows, 'test'), 0);
  const intraday = history.map(row => ({ ...row, date: `${row.date}T16:00:00` }));
  const marks = context.intradayResultsForRange(history, intraday, rows, portfolios, [
    { type: 'initial', amount: 1000 },
    { type: 'one-time', date: '2024-01-03', amount: -2000 },
  ], '', '2024-01-05', '5D');
  assert.ok(marks.every(row => row.values.test >= 0));
  assert.equal(marks.at(-1).values.test, 0);
});


test('percentage cash flows use each portfolio value after returns and dollar flows', () => {
  const history = [
    { date: '2024-01-02', prices: { ETF: 100, OTHER: 100 } },
    { date: '2024-02-02', prices: { ETF: 110, OTHER: 90 } },
  ];
  const compared = [...portfolios, { id: 'other', holdings: [{ symbol: 'OTHER', weight: 100 }] }];
  const flows = [
    { type: 'initial', amount: 10000 },
    { type: 'recurring', frequency: 'monthly', amountType: 'percent', amount: -10, startAtBeginning: true },
    { type: 'one-time', date: '2024-02-02', amount: 100 },
  ];
  const rows = context.calculateResults(history, compared, flows, '', '2024-02-02');
  assert.equal(rows[0].values.test, 9000);
  assert.equal(rows[1].values.test, 9000);
  assert.equal(rows[1].values.other, 7380);
  assert.equal(rows[1].appliedContributions.test, -900);
  assert.equal(rows[1].appliedContributions.other, -720);
  assert.ok(Math.abs(context.portfolioDrawdown(rows, 'test')) < 1e-10);
  assert.ok(Math.abs(context.portfolioDrawdown(rows, 'other') + 10) < 1e-10);
  const intraday = history.map(row => ({ ...row, date: `${row.date}T16:00:00` }));
  const marks = context.intradayResultsForRange(history, intraday, rows, compared, flows, '', '2024-02-02', '5D');
  assert.deepEqual(Object.entries(marks.at(-1).values), Object.entries(rows.at(-1).values));
});

test('percentage deposits compound at each occurrence and withdrawals cannot create debt', () => {
  const history = prices(['2024-01-02', '2024-02-02', '2024-03-02']);
  for (const amount of [10, -100, -150]) {
    const rows = context.calculateResults(history, portfolios, [
      { type: 'initial', amount: 1000 },
      { type: 'recurring', frequency: 'monthly', amountType: 'percent', amount, startAtBeginning: true },
    ], '', '2024-03-02');
    const expected = amount === 10 ? [1100, 1210, 1331] : [0, 0, 0];
    assert.deepEqual(Array.from(rows, row => Math.round(row.values.test)), expected);
  }
});

test('percentage schedules support every frequency and custom starts', () => {
  const history = prices(['2024-01-02', '2024-01-09', '2024-02-09', '2024-04-09', '2025-01-09']);
  for (const frequency of ['weekly', 'monthly', 'quarterly', 'annual']) {
    const rows = context.calculateResults(history, portfolios, [
      { type: 'initial', amount: 10000 },
      { type: 'recurring', frequency, amountType: 'percent', amount: -1, date: '2024-01-09', startAtBeginning: false },
    ], '', '2025-01-09');
    assert.equal(rows[0].values.test, 10000);
    assert.equal(rows[1].values.test, 9900);
    assert.ok(rows.at(-1).values.test < 9900);
  }
});

test('recurring end dates are inclusive for every frequency and cash-flow direction', () => {
  const history = prices(['2024-01-02', '2024-01-09', '2024-02-02', '2024-04-02', '2025-01-02', '2026-01-02']);
  for (const frequency of ['weekly', 'monthly', 'quarterly', 'annual']) {
    for (const amount of [100, -100]) {
      const flows = [{ type: 'initial', amount: 100000 }, { type: 'recurring', frequency, amount, startAtBeginning: true, endDate: '2025-01-02' }];
      const rows = context.calculateResults(history, portfolios, flows, '', '2026-01-02');
      assert.notEqual(rows.at(-2).contributions, 0, `${frequency}: occurrence on end date is included`);
      assert.equal(rows.at(-1).contributions, 0);
      assert.equal(rows.at(-1).values.test, rows.at(-2).values.test);
    }
  }
});

test('recurring contributions rolled to a trading day after their end date are excluded', () => {
  const history = prices(['2024-01-05', '2024-01-08', '2024-01-15']);
  const flow = { type: 'recurring', frequency: 'weekly', amount: 100, date: '2024-01-06', startAtBeginning: false };
  const ended = context.calculateResults(history, portfolios, [{ ...flow, endDate: '2024-01-07' }], '', '2024-01-15');
  assert.ok(ended.every(row => row.contributions === 0));
  const inclusive = context.calculateResults(history, portfolios, [{ ...flow, endDate: '2024-01-08' }], '', '2024-01-15');
  assert.deepEqual(Array.from(inclusive, row => row.contributions), [0, 100, 0]);
});

test('clearing recurring end dates restores the full schedule; a cutoff before the start adds nothing', () => {
  const history = prices(['2024-01-02', '2024-02-02', '2024-03-02']);
  for (const startAtBeginning of [true, false]) {
    const flow = { type: 'recurring', frequency: 'monthly', amount: 100, date: '2024-01-02', startAtBeginning };
    const early = context.calculateResults(history, portfolios, [{ ...flow, endDate: '2024-01-01' }], '', '2024-03-02');
    assert.ok(early.every(row => row.contributions === 0));
    const ended = context.calculateResults(history, portfolios, [{ ...flow, endDate: '2024-02-02' }], '', '2024-03-02');
    assert.equal(ended.at(-1).values.test, 200);
    const cleared = context.calculateResults(history, portfolios, [{ ...flow, endDate: '' }], '', '2024-03-02');
    assert.equal(cleared.at(-1).values.test, 300);
  }
});

test('percentage recurring cutoffs stop compounding without ending the backtest', () => {
  const history = prices(['2024-01-02', '2024-02-02', '2024-03-02']);
  for (const amount of [10, -10]) {
    const rows = context.calculateResults(history, portfolios, [
      { type: 'initial', amount: 10000 },
      { type: 'recurring', frequency: 'monthly', amountType: 'percent', amount, startAtBeginning: true, endDate: '2024-02-02' },
    ], '', '2024-03-02');
    assert.equal(rows.length, 3);
    assert.equal(Math.round(rows[1].values.test), amount > 0 ? 12100 : 8100);
    assert.equal(rows[2].values.test, rows[1].values.test);
  }
});
