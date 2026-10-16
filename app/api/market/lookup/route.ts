import { checkAppRequest } from "../../../lib/app-request";
import { NextRequest } from "next/server";
import { marketError, marketResponse, yfinanceRequest } from "../../../lib/yfinance-http";
import type { Quote } from "../../../lib/market-types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const denied = checkAppRequest(request);
  if (denied) return denied;
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) return marketResponse({ error: "A ticker symbol is required." }, request, 400);
  try { return marketResponse(await yfinanceRequest<Quote>({ action: "lookup", symbol }), request); }
  catch (error) { return marketError(error, request); }
}
