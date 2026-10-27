import { NextResponse, type NextRequest } from "next/server";

/** فحص أولي سريع لوجود الجلسة فقط — التحقق الحقيقي من الجلسة والصلاحيات يتم على الخادم في كل صفحة وإجراء */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open = pathname.startsWith("/login") || pathname.startsWith("/live-board") || pathname.startsWith("/api/live-board") || pathname === "/api/cron" || pathname.startsWith("/_next") || pathname === "/favicon.ico";
  if (open) return NextResponse.next();
  if (!req.cookies.get("gp_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
