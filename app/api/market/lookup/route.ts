import { execFile } from "child_process";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { existsSync } from "fs";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

async function yfinance(payload: unknown) {
  const script = path.join(process.cwd(), "services", "yfinance_service.py");
  const python = path.join(process.cwd(), ".venv", "bin", "python");
  const { stdout } = await execFileAsync(existsSync(python) ? python : "python3", [script, JSON.stringify(payload)], { maxBuffer: 1024 * 1024 * 8, timeout: 60_000 });
  const data = JSON.parse(stdout);
  if (data.error) throw new Error(data.error);
  return data;
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "A ticker symbol is required." }, { status: 400 });
  try { return NextResponse.json(await yfinance({ action: "lookup", symbol })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to retrieve market data." }, { status: 502 }); }
}
