import { NextResponse } from "next/server";

// Browser isolation, not authentication: non-browser clients can forge these headers.
export function checkAppRequest(request: Request) {
  const origin = request.headers.get("origin");
  const sameOrigin = origin === new URL(request.url).origin;
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (request.headers.get("sec-fetch-site") !== "same-origin" || (origin !== null && !sameOrigin) || (!safeMethod && !sameOrigin)) {
    return NextResponse.json({ error: "Only same-origin app requests are allowed." }, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Sec-Fetch-Site, Origin" },
    });
  }
  return null;
}
