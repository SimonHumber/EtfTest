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

test('all-time-high investing buys only new records, not drawdowns or repeated highs', () => {
  const history = [100, 110, 90, 100, 110, 121].map((close, i) => ({ date: `2024-01-0${i + 2}`, prices: { ETF: close } }));
  const config = { enabled: true, amount: 100 };
  const flows = [{ type: 'initial', amount: 10000 }, { type: 'recurring', amount: 1000, startAtBeginning: true, frequency: 'weekly' }];
  const rows = context.calculateResults(history, portfolios, flows, '', '2024-01-07', config);
  assert.deepEqual(Array.from(rows, row => Math.round(row.appliedContributions.test)), [10100, 100, 0, 0, 0, 100]);
  assert.ok(Math.abs(rows.at(-1).values.test - 12431) < 1e-9);
  assert.equal(rows.reduce((sum, row) => sum + row.investedContributions.test, 0), 10300);
  assert.equal(rows.reduce((sum, row) => sum + row.investmentPurchases.test, 0), 3);
  const modified = history.map((row, i) => i === 5 ? { ...row, prices: { ETF: 1000 } } : row);
  const future = context.calculateResults(modified, portfolios, flows, '', '2024-01-07', config);
  assert.deepEqual(Array.from(rows.slice(0, 5), row => row.values.test), Array.from(future.slice(0, 5), row => row.values.test));
});

test('invested capital includes initial balance and positive deposits, not gains or withdrawals', () => {
  const history = [
    { date: '2024-01-02', prices: { ETF: 100 } },
    { date: '2024-02-02', prices: { ETF: 110 } },
    { date: '2024-03-02', prices: { ETF: 99 } },
  ];
  const rows = context.calculateResults(history, portfolios, [
    { type: 'initial', amount: 10000 },
    { type: 'recurring', amount: 1000, frequency: 'monthly', startAtBeginning: true },
    { type: 'one-time', amount: 500, date: '2024-02-02' },
    { type: 'one-time', amount: -2000, date: '2024-02-02' },
    { type: 'one-time', amount: -999999, date: '2024-03-02' },
  ], '', '2024-03-02');
  assert.deepEqual(Array.from(rows, row => row.investedContributions.test), [11000, 1500, 1000]);
  assert.deepEqual(Array.from(rows, row => row.investmentPurchases.test), [1, 2, 1]);
  assert.equal(rows.at(-1).values.test, 0);
});

test('multiple recurring occurrences on one trading day count as separate additional purchases', () => {
  const rows = context.calculateResults(prices(['2024-01-02', '2024-01-23']), portfolios, [
    { type: 'initial', amount: 1000 },
    { type: 'recurring', amount: 100, frequency: 'weekly', startAtBeginning: true },
  ], '', '2024-01-23');
  assert.deepEqual(Array.from(rows, row => row.investmentPurchases.test), [1, 3]);
  assert.deepEqual(Array.from(rows, row => row.investedContributions.test), [1100, 300]);
});

test('percentage deposits track actual contributed capital separately for each comparison', () => {
  const history = [
    { date: '2024-01-02', prices: { ETF: 100, OTHER: 100 } },
    { date: '2024-02-02', prices: { ETF: 110, OTHER: 90 } },
  ];
  const compared = [...portfolios, { id: 'other', holdings: [{ symbol: 'OTHER', weight: 100 }] }];
  const rows = context.calculateResults(history, compared, [
    { type: 'initial', amount: 10000 },
    { type: 'recurring', amount: 10, amountType: 'percent', frequency: 'monthly', startAtBeginning: true },
  ], '', '2024-02-02');
  assert.equal(rows[0].investedContributions.test, 11000);
  assert.equal(rows[0].investedContributions.other, 11000);
  assert.ok(Math.abs(rows[1].investedContributions.test - 1210) < 1e-9);
  assert.ok(Math.abs(rows[1].investedContributions.other - 990) < 1e-9);
  assert.equal(rows[1].investmentPurchases.test, 1);
  const mixed = context.calculateResults(history, portfolios, [
    { type: 'initial', amount: 1000 },
    { type: 'recurring', amount: -10, amountType: 'percent', frequency: 'monthly', startAtBeginning: true },
    { type: 'recurring', amount: 20, amountType: 'percent', frequency: 'monthly', startAtBeginning: true },
  ], '', '2024-02-02');
  assert.equal(mixed[0].investedContributions.test, 1180);
  assert.equal(mixed[0].investmentPurchases.test, 1);
});

test('high investing resets prior peaks at the investment start and when the start date changes', () => {
  const history = [150, 100, 120, 150, 160].map((close, i) => ({ date: `2024-01-0${i + 2}`, prices: { ETF: close } }));
  const rows = context.calculateResults(history, portfolios, [], '2024-01-03', '2024-01-06', { enabled: true, amount: 250.5 });
  assert.deepEqual(Array.from(rows, row => Math.round(row.appliedContributions.test * 10) / 10), [250.5, 250.5, 250.5, 250.5]);
  const changed = context.calculateResults(history, portfolios, [], '2024-01-05', '2024-01-06', { enabled: true, amount: 250.5 });
  assert.equal(changed[0].values.test, 250.5, 'the new range starts a fresh peak and position');
  assert.equal(changed.length, 2);
});

test('ATH starting balance is invested immediately during a drawdown while other scheduled flows stay paused', () => {
  const history = [150, 100, 120, 160].map((close, i) => ({ date: `2024-01-0${i + 2}`, prices: { ETF: close } }));
  const flows = [
    { type: 'initial', amount: 10000 },
    { type: 'recurring', amount: 1000, frequency: 'monthly', startAtBeginning: true },
    { type: 'one-time', amount: 500, date: '2024-01-04' },
  ];
  const config = { enabled: true, amount: 100 };
  const rows = context.calculateResults(history, portfolios, flows, '2024-01-03', '2024-01-05', config);
  assert.deepEqual(Array.from(rows, row => Math.round(row.values.test)), [10100, 12220, 16393]);
  assert.deepEqual(Array.from(rows, row => Math.round(row.appliedContributions.test)), [10100, 100, 100]);
  assert.equal(rows.reduce((total, row) => total + row.appliedContributions.test, 0), 10300);
  const intraday = [
    { date: '2024-01-03T10:00:00', prices: { ETF: 100 } },
    { date: '2024-01-03T16:00:00', prices: { ETF: 100 } },
  ];
  const marks = context.intradayResultsForRange(history, intraday, rows, portfolios, flows, '2024-01-03', '2024-01-05', '1D', config);
  assert.equal(marks[1].values.test, 10000);
  assert.equal(marks[2].values.test, 10100);
});

test('all-time-high investing uses independent price paths for comparisons and weighted baskets', () => {
  const history = [
    { date: '2024-01-02', prices: { ETF: 100, OTHER: 100 } },
    { date: '2024-01-03', prices: { ETF: 110, OTHER: 90 } },
    { date: '2024-01-04', prices: { ETF: 120, OTHER: 70 } },
  ];
  const compared = [...portfolios, { id: 'other', holdings: [{ symbol: 'OTHER', weight: 100 }] }, { id: 'basket', holdings: [{ symbol: 'ETF', weight: 50 }, { symbol: 'OTHER', weight: 50 }] }];
  const rows = context.calculateResults(history, compared, [], '', '2024-01-04', { enabled: true, amount: 100 });
  assert.ok(rows[1].appliedContributions.test > 99);
  assert.equal(rows[1].appliedContributions.other, 0);
  assert.equal(rows[1].appliedContributions.basket, 0);
  assert.equal(rows[2].appliedContributions.basket, 0);
  assert.equal(rows[2].values.other, 70);
  for (const amount of [0, -100, NaN, Infinity]) {
    const empty = context.calculateResults(history, portfolios, [], '', '2024-01-04', { enabled: true, amount });
    assert.ok(empty.every(row => row.values.test === 0));
    assert.ok(empty.every(row => row.athPurchases.test === 0));
  }
});

test('all-time-high intraday purchases occur at the close and unfinished sessions cannot trigger buys', () => {
  const history = [100, 110].map((close, i) => ({ date: `2024-01-0${i + 2}`, prices: { ETF: close } }));
  const config = { enabled: true, amount: 100 };
  const rows = context.calculateResults(history, portfolios, [], '', '2024-01-04', config);
  const intraday = [
    { date: '2024-01-03T10:00:00', prices: { ETF: 105 } },
    { date: '2024-01-03T16:00:00', prices: { ETF: 110 } },
    { date: '2024-01-04T10:00:00', prices: { ETF: 200 } },
  ];
  const marks = context.intradayResultsForRange(history, intraday, rows, portfolios, [], '', '2024-01-04', '5D', config);
  assert.equal(marks[1].values.test, 105);
  assert.equal(marks[2].values.test, 210);
  assert.ok(Math.abs(marks[3].values.test - 210 * 200 / 110) < 1e-9, 'live mark grows existing shares without adding a purchase');
});
