'use server';

import { getCloudflareContext } from '@opennextjs/cloudflare';

import { sanitizeAndValidateUrl } from '@/lib/sanitizeAndValidateUrl';

const UUID_BASE = /([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/;
const UUID = new RegExp(`^${UUID_BASE.source}$`);

export async function handleCreate(uuid: string, redirect: string): Promise<boolean> {
  const sanitizedRedirect = await sanitizeAndValidateUrl(redirect);
  const context = await getCloudflareContext({ async: true });
  const kv = context.env.TINY_URL;
  if (UUID.test(uuid) && sanitizedRedirect && typeof sanitizedRedirect === 'string') {
    const oldRedirect = await kv.get(uuid, { type: 'text' });
    if (!oldRedirect) {
      try {
        await kv.put(uuid, sanitizedRedirect);
        return new Promise((resolve) => resolve(true));
      } catch (e) {
        if (e instanceof Error) {
          console.error(`Failed to create tiny url for ${uuid} -> ${redirect}, error: ${e.message}`);
        } else {
          console.error(`Failed to create tiny url for ${uuid} -> ${redirect}`);
        }
        return new Promise((resolve) => resolve(false));
      }
    }
  }
  return new Promise((resolve) => resolve(false));
}
