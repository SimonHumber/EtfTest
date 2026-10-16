import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";

type MarketRequest =
  | { action: "lookup" | "history"; symbol: string }
  | { action: "search"; query: string }
  | { action: "rates" }
  | { action: "backtest"; portfolios: unknown[] };

export class MarketServiceError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = "MarketServiceError";
  }
}

export async function yfinanceRequest<T>(payload: MarketRequest): Promise<T> {
  const endpoint = process.env.YFINANCE_API_URL || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/python_market`
    : undefined);
  if (!endpoint) throw new MarketServiceError("Set YFINANCE_API_URL in .env to the Python market endpoint.", 503);
  const token = process.env.YFINANCE_API_TOKEN?.trim();
  if (!token) throw new MarketServiceError("Configure the server-only YFINANCE_API_TOKEN for Next.js and the Python service.", 503);
  const headers: Record<string, string> = { "content-type": "application/json", "accept-encoding": "gzip", authorization: `Bearer ${token}` };
  // Protected preview deployments also protect the Python function on the same deployment.
  if (!process.env.YFINANCE_API_URL && process.env.VERCEL_URL && process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST", headers, body: JSON.stringify(payload), cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(110_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new MarketServiceError(timedOut ? "The Python market service timed out. Please try again." : "Cannot reach the Python market service. Locally, start it with npm run dev:backend.", timedOut ? 504 : 502);
  }
  if (response.status === 401 || response.status === 403) {
    const pythonRejectedToken = response.headers.get("www-authenticate")?.includes('realm="market-service"');
    throw new MarketServiceError(pythonRejectedToken
      ? "Python rejected the shared token. Check YFINANCE_API_TOKEN in this deployment's environment, leave YFINANCE_API_URL unset for a single Vercel project, and redeploy."
      : `The Python endpoint request was blocked (HTTP ${response.status}). Check Vercel Deployment Protection / Protection Bypass for Automation, leave YFINANCE_API_URL unset for a single Vercel project, and redeploy.`);
  }
  let data;
  try { data = await response.json(); }
  catch {
    throw new MarketServiceError("The Python market service returned an invalid JSON response.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new MarketServiceError("The Python market service returned an invalid data response.");
  if (!response.ok || data?.error) {
    throw new MarketServiceError(typeof data?.error === "string" ? data.error : "Unable to load market data.", response.ok ? 502 : response.status);
  }
  return data as T;
}

export function marketResponse(data: unknown, request?: Request, status = 200) {
  const json = JSON.stringify(data);
  const acceptsGzip = request?.headers.get("accept-encoding")?.includes("gzip");
  if (acceptsGzip && Buffer.byteLength(json) > 128 * 1024) {
    return new NextResponse(new Uint8Array(gzipSync(json)), { status, headers: { "content-type": "application/json; charset=utf-8", "content-encoding": "gzip", vary: "Accept-Encoding", "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json(data, { status, headers: { vary: "Accept-Encoding", "Cache-Control": "private, no-store" } });
}

export function marketError(error: unknown, request?: Request, extra: Record<string, unknown> = {}) {
  return marketResponse({ ...extra, error: error instanceof Error ? error.message : "Unable to load market data." }, request, error instanceof MarketServiceError ? error.status : 502);
}
