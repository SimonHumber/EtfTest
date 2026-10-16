import { NextRequest, NextResponse } from "next/server";
import { checkAppRequest } from "./app/lib/app-request";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/market/")) return checkAppRequest(request) ?? NextResponse.next();
  return NextResponse.next();
}

export const config = { matcher: ["/api/market/:path*"] };
