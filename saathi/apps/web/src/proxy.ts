import { NextResponse, type NextRequest } from 'next/server';

// Optimistic redirect only (Next.js 16 proxy guide): if there is no session cookie at all,
// send the visitor to sign-in with the intended destination preserved. Real authentication
// and authorization happen server-side in every page loader and Route Handler.
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.getAll().some((c) => c.name.endsWith('better-auth.session_token'));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/app/:path*', '/onboarding', '/demo'] };
