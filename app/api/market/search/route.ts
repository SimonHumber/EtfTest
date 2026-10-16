import { execFile } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim();
  if (!query) return NextResponse.json({ results: [] });
  try {
    const script = path.join(process.cwd(), "services", "yfinance_service.py");
    const python = path.join(process.cwd(), ".venv", "bin", "python");
    const { stdout } = await execFileAsync(existsSync(python) ? python : "python3", [script, JSON.stringify({ action: "search", query })], { maxBuffer: 1024 * 1024 * 4, timeout: 30_000 });
    const data = JSON.parse(stdout);
    if (data.error) return NextResponse.json({ results: [], error: data.error }, { status: 502 });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ results: [], error: error instanceof Error ? error.message : "Unable to search tickers." }, { status: 502 });
  }
}
