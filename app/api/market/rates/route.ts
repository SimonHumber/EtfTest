import { checkAppRequest } from "../../../lib/app-request";
import { unstable_cache } from "next/cache";
import type { RateHistory } from "../../../lib/market-types";
import { marketError, marketResponse, yfinanceRequest } from "../../../lib/yfinance-http";

export const runtime = "nodejs";
export const maxDuration = 120;
const cachedRates = unstable_cache(async (): Promise<RateHistory> => {
  const result = await yfinanceRequest<RateHistory>({ action: "rates" });
  if (!result.points?.length) throw new Error("Historical ^IRX rates are unavailable.");
  return result;
}, ["irx-daily-rates-v1"], { revalidate: 86400 });

let pending: Promise<RateHistory> | undefined;
export async function GET(request: Request) {
  const denied = checkAppRequest(request);
  if (denied) return denied;
  try {
    pending ??= cachedRates().finally(() => { pending = undefined; });
    return marketResponse(await pending, request);
  } catch (error) {
    return marketError(error, request);
  }
}
