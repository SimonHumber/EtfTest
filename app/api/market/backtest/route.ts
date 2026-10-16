import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import path from "path";
import { existsSync } from "fs";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const script = path.join(process.cwd(), "services", "yfinance_service.py");
    const python = path.join(process.cwd(), ".venv", "bin", "python");
    const { stdout } = await execFileAsync(existsSync(python) ? python : "python3", [script, JSON.stringify({ action: "backtest", ...payload })], { maxBuffer: 1024 * 1024 * 16, timeout: 120_000 });
    const data = JSON.parse(stdout);
    if (data.error) return NextResponse.json(data, { status: 422 });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to calculate the backtest." }, { status: 502 });
  }
}
