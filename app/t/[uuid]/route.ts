import { getCloudflareContext } from '@opennextjs/cloudflare';
import { sanitizeAndValidateUrl } from '@/lib/sanitizeAndValidateUrl';

const UUID_BASE = /([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/;
const UUID = new RegExp(`^${UUID_BASE.source}$`);

export async function GET(_request: Request, { params }: { params: Promise<{ uuid: string }> }) {
  try {
    const context = await getCloudflareContext({ async: true });
    const kv = context.env.TINY_URL;

    const { uuid } = await params;
    const redirectUrl = await handleUUID(kv, uuid);

    if (redirectUrl) {
      // Re-validate URL before redirect to prevent stored XSS/malicious URLs
      const validatedUrl = await sanitizeAndValidateUrl(redirectUrl);

      if (!validatedUrl) {
        // URL is no longer valid, remove it from storage and return 404
        await kv.delete(uuid);
        console.warn(`Removed invalid URL from storage: ${uuid}`);
        return new Response('Link no longer available', { status: 404 });
      }

      // Add security headers for redirect
      const headers = new Headers({
        Location: validatedUrl,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Robots-Tag': 'noindex, nofollow',
      });

      return new Response('Redirecting...', {
        headers,
        status: 302,
      });
    } else {
      return new Response('Not Found', { status: 404 });
    }
  } catch (error) {
    // Log error securely without exposing sensitive information
    const errorId = crypto.randomUUID();
    console.error(`[${errorId}] Redirect error:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });

    return new Response('Service temporarily unavailable', { status: 503 });
  }
}

async function handleUUID(kv: KVNamespace, uuidParam: string): Promise<string | null> {
  if (UUID.test(uuidParam)) {
    const [, uuid] = uuidParam.match(UUID) || [];
    return kv.get(uuid, { type: 'text' });
  }

  return new Promise((resolve) => resolve(null));
}
