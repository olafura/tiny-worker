import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { RateLimiter, RATE_LIMITS, getClientIP } from './rateLimit';

interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'X-RateLimit-Reset-After': string;
}

export async function rateLimitMiddleware(request: NextRequest): Promise<NextResponse | null> {
  // Only apply rate limiting to URL creation endpoints
  if (!request.nextUrl.pathname.startsWith('/') || request.method !== 'POST') {
    return null; // Don't apply rate limiting
  }

  try {
    const context = await getCloudflareContext({ async: true });
    const kv = context.env.TINY_URL;

    const clientIP = getClientIP(request);

    // Get user ID from session if available
    // For now, we'll use IP-based rate limiting primarily
    // In a real implementation, you'd decode the session to get the user ID
    // const sessionCookie = request.cookies.get('workos-session');
    // TODO: Implement user-based rate limiting when session decoding is available

    // Create rate limiters
    const ipHourlyLimiter = new RateLimiter(kv, RATE_LIMITS.IP_HOURLY);
    const ipDailyLimiter = new RateLimiter(kv, RATE_LIMITS.IP_DAILY);

    // Check IP-based rate limits
    const [ipHourlyResult, ipDailyResult] = await Promise.all([ipHourlyLimiter.checkLimit(clientIP), ipDailyLimiter.checkLimit(clientIP)]);

    // Check if any rate limit is exceeded
    const rateLimitResult = !ipHourlyResult.success ? ipHourlyResult : !ipDailyResult.success ? ipDailyResult : ipHourlyResult; // Use hourly as it's more restrictive

    if (!rateLimitResult.success) {
      const resetAfter = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);

      const headers: RateLimitHeaders = {
        'X-RateLimit-Limit': String(RATE_LIMITS.IP_HOURLY.maxRequests),
        'X-RateLimit-Remaining': String(rateLimitResult.remaining),
        'X-RateLimit-Reset': String(Math.floor(rateLimitResult.resetTime / 1000)),
        'X-RateLimit-Reset-After': String(resetAfter),
      };

      return new NextResponse(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: rateLimitResult.error,
          retryAfter: resetAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(resetAfter),
            ...headers,
          },
        },
      );
    }

    // Add rate limit headers to successful responses
    const remaining = Math.min(ipHourlyResult.remaining, ipDailyResult.remaining);
    const resetTime = Math.min(ipHourlyResult.resetTime, ipDailyResult.resetTime);
    const resetAfter = Math.ceil((resetTime - Date.now()) / 1000);

    const headers: RateLimitHeaders = {
      'X-RateLimit-Limit': String(RATE_LIMITS.IP_HOURLY.maxRequests),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.floor(resetTime / 1000)),
      'X-RateLimit-Reset-After': String(resetAfter),
    };

    // Store rate limit info in request headers for use in the application
    const modifiedHeaders = new Headers(request.headers);
    Object.entries(headers).forEach(([key, value]) => {
      modifiedHeaders.set(key, value);
    });

    return NextResponse.next({
      request: {
        headers: modifiedHeaders,
      },
    });
  } catch (error) {
    console.error('Rate limiting middleware error:', error);
    // If rate limiting fails, allow the request to proceed
    return null;
  }
}
