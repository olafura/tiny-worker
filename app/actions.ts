'use server';

import { getCloudflareContext } from '@opennextjs/cloudflare';

import { sanitizeAndValidateUrl } from '@/lib/sanitizeAndValidateUrl';

const UUID_BASE = /([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/;
const UUID = new RegExp(`^${UUID_BASE.source}$`);

export async function handleCreate(uuid: string, redirect: string): Promise<boolean> {
  try {
    const sanitizedRedirect = await sanitizeAndValidateUrl(redirect);
    const context = await getCloudflareContext({ async: true });
    const kv = context.env.TINY_URL;

    if (UUID.test(uuid) && sanitizedRedirect && typeof sanitizedRedirect === 'string') {
      const oldRedirect = await kv.get(uuid, { type: 'text' });
      if (!oldRedirect) {
        await kv.put(uuid, sanitizedRedirect);
        return true;
      }
    }
    return false;
  } catch (error) {
    // Secure error logging - don't expose sensitive details
    const errorId = crypto.randomUUID();
    console.error(`[${errorId}] URL creation failed:`, {
      uuid: uuid.substring(0, 8) + '...',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
    return false;
  }
}
