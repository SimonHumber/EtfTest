import { execFile } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "A ticker symbol is required." }, { status: 400 });
  try {
    const script = path.join(process.cwd(), "services", "yfinance_service.py");
    const python = path.join(process.cwd(), ".venv", "bin", "python");
    const { stdout } = await execFileAsync(existsSync(python) ? python : "python3", [script, JSON.stringify({ action: "history", symbol })], { maxBuffer: 1024 * 1024 * 12, timeout: 60_000 });
    const data = JSON.parse(stdout);
    if (data.error) return NextResponse.json(data, { status: 502 });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to retrieve price history." }, { status: 502 });
  }
}
