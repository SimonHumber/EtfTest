# Atlas

A responsive Next.js investment research and portfolio backtesting app. Market data is loaded server-side with `yfinance`.

## Run locally

```bash
npm install
python3 -m pip install -r requirements.txt
npm run dev
```

Then visit `http://localhost:3000`.

The backtester uses adjusted close prices, normalizes each portfolio's entered weights, and applies starting, dated, or recurring cash contributions independently to each compared portfolio. This is an educational calculator, not investment advice.
