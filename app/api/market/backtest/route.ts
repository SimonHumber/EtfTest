import { checkAppRequest } from "../../../lib/app-request";
import { marketError, marketResponse, yfinanceRequest } from "../../../lib/yfinance-http";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const denied = checkAppRequest(request);
  if (denied) return denied;
  let payload;
  try { payload = await request.json(); }
  catch { return marketResponse({ error: "A valid JSON request body is required." }, request, 400); }
  if (!payload || !Array.isArray(payload.portfolios)) return marketResponse({ error: "A portfolios list is required." }, request, 400);
  try { return marketResponse(await yfinanceRequest({ action: "backtest", portfolios: payload.portfolios }), request); }
  catch (error) { return marketError(error, request); }
}
