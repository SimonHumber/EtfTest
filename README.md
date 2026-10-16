# Atlas

A responsive Next.js investment research and portfolio backtesting app. Next.js/TypeScript provides the public frontend and API routes. A token-protected Python HTTP function fetches market data using `yfinance`.

## Run locally

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Start the Python HTTP service in one terminal:

```bash
npm run dev:backend
```

Start Next.js in another terminal:

```bash
npm run dev
```

Then visit `http://localhost:3000`. The frontend is public and requires no login.

Configure `YFINANCE_API_URL` in `.env` with the Python service's full endpoint URL; the local value is documented in `.env.example`. Set `YFINANCE_API_TOKEN` to a strong shared secret (generate one with `openssl rand -hex 32`). Next.js loads `.env` automatically, and the `dev:backend` launcher loads the same environment files before starting Python. `.env.local` can override `.env`. Restart both processes after changing these values.

The Python endpoint requires `Authorization: Bearer <YFINANCE_API_TOKEN>` on every data request and its GET health check. Next.js adds this header server-side; the browser never receives the token. Missing or incorrect credentials return 401; a missing server token disables the Python endpoint with 503.

Next.js market endpoints use browser request isolation rather than user authentication. Middleware and each `/api/market/*` handler require `Sec-Fetch-Site: same-origin` before accessing caches or calling Python. An Origin header, when present, must match the request URL's origin; POST requests require it. Modern browsers set these headers automatically for requests from the app. Cross-site requests, direct address-bar API navigation, and requests without fetch metadata return 403. Use HTTPS in deployment or localhost in development; insecure remote HTTP and older browsers may not send fetch metadata. The frontend itself has no login, session, or password requirement.

These checks are NOT authentication: non-browser clients can forge Origin and fetch metadata and still call the public Next.js APIs. A public, login-free browser app cannot keep those APIs exclusive to its JavaScript. Python remains protected by its server-only bearer token. Before public deployment, configure platform-level rate limits/bot protection on `/api/market/*` (for example, Vercel Firewall) to reduce abuse. True access restriction would require user authentication or a private network.

If you change the backend port with `YFINANCE_PORT`, update `YFINANCE_API_URL` to match. When starting Python directly instead of using `npm run dev:backend`, export the environment variables yourself.

Environment files are excluded from Git and Vercel uploads; `.env.example` remains tracked as a template. Configure production overrides in Vercel's environment settings, not by committing `.env`.

`npm run dev` runs only Next.js; it does not launch a Python subprocess. All market-data communication uses HTTP, in development and production.

## Deploy on Vercel

1. Push the repository to GitHub and import it as one Vercel project.
2. Keep the project root at this directory and select the **Next.js** framework preset. The default build command is `npm run build`.
3. Deploy. `vercel.json` configures `api/python_market.py` as a separate Python Function alongside Next.js. Vercel installs the pinned Python dependencies from `requirements.txt` and uses Python 3.12 from `.python-version`.
4. Leave `YFINANCE_API_URL` unset on Vercel. The Next.js routes use the deployment's `VERCEL_URL` to call `/api/python_market` automatically. Enable Vercel's automatically exposed system environment variables if they were disabled in project settings.
5. Add `YFINANCE_API_TOKEN` to Vercel's environment settings for each environment you use (Production/Preview). The same project variable is available to both the Next.js routes and Python Function. Use a strong secret and never give it a `NEXT_PUBLIC_` prefix.
6. For deployments with Deployment Protection enabled, create a **Protection Bypass for Automation** secret under **Project Settings > Deployment Protection**, then redeploy. Vercel supplies `VERCEL_AUTOMATION_BYPASS_SECRET`; the Next.js routes send it only to the automatically resolved same-project Python endpoint. This Vercel bypass secret is separate from `YFINANCE_API_TOKEN`. Never use a `NEXT_PUBLIC_` variable for either secret.

The browser continues to call `/api/market/lookup`, `/api/market/search`, `/api/market/history`, `/api/market/backtest`, and `/api/market/rates`. These Next.js routes call the Python Function over HTTP. The `^IRX` cache remains in Next.js, and the Python function puts Yahoo's transient metadata cache in the writable temporary directory.

Both runtimes have a 120-second function limit. Historical responses support gzip to reduce payload size. Python deployment bundles exclude `.venv`, Node dependencies, frontend sources, build artifacts, and tests.

References: [Vercel Python Functions](https://vercel.com/docs/functions/runtimes/python), [deployment protection bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

## Verify

```bash
npm test
npm run test:backend
npm run build
```

The tests mock Yahoo responses and exercise HTTP handlers without starting servers. A successful local build does not verify a deployed Vercel Function or Yahoo connectivity from Vercel.

The backtester uses adjusted close prices, normalizes each portfolio's entered weights, and applies starting, dated, or recurring cash contributions independently to each compared portfolio. This is an educational calculator, not investment advice.
