import { authkitMiddleware } from '@workos-inc/authkit-nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitMiddleware } from './lib/rateLimitMiddleware';

async function customMiddleware(request: NextRequest, event: any) {
  // Apply authentication middleware first so withAuth works
  const authMiddleware = authkitMiddleware({
    middlewareAuth: {
      enabled: true,
      unauthenticatedPaths: ['/t'],
    },
  });
  const authResponse = await authMiddleware(request, event);

  // If auth middleware returned a response (redirect), use it
  if (authResponse) {
    return authResponse;
  }

  // Apply rate limiting after authentication
  const rateLimitResponse = await rateLimitMiddleware(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  // Add security headers to all responses
  const response = NextResponse.next();

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content Security Policy
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-inline/eval
    "style-src 'self' 'unsafe-inline'", // Tailwind requires unsafe-inline
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.workos.com", // WorkOS API
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export default customMiddleware;

// Match against all pages - ensure AuthKit middleware runs everywhere
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
