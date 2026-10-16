import { checkAppRequest } from "../../../lib/app-request";
import { NextRequest } from "next/server";
import { marketError, marketResponse, yfinanceRequest } from "../../../lib/yfinance-http";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const denied = checkAppRequest(request);
  if (denied) return denied;
  const query = request.nextUrl.searchParams.get("query")?.trim();
  if (!query) return marketResponse({ results: [] }, request);
  try { return marketResponse(await yfinanceRequest({ action: "search", query }), request); }
  catch (error) { return marketError(error, request, { results: [] }); }
}
