import { getCloudflareContext } from '@opennextjs/cloudflare';

const UUID_BASE = /([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/;
const UUID = new RegExp(`^${UUID_BASE.source}$`);

export async function GET(_request: Request, { params }: { params: Promise<{ uuid: string }> }) {
  const context = await getCloudflareContext({ async: true });
  const kv = context.env.TINY_URL;

  const { uuid } = await params;
  const redirect = await handleUUID(kv, uuid);

  if (redirect) {
    const headers = new Headers({
      Location: redirect,
    });

    const status = 302;

    return new Response('', {
      headers,
      status,
    });
  } else {
    return new Response('Not Found', { status: 404 });
  }
}

async function handleUUID(kv: KVNamespace, uuidParam: string): Promise<string | null> {
  if (UUID.test(uuidParam)) {
    const [, uuid] = uuidParam.match(UUID) || [];
    return kv.get(uuid, { type: 'text' });
  }

  return new Promise((resolve) => resolve(null));
}
