/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const UUID_BASE = /([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})/;
const UUID = new RegExp(`^${UUID_BASE.source}$`);
const UUID_PATH = new RegExp(`^\/${UUID_BASE.source}$`);

interface Env {
  TINY_URL: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    console.log(`Request for ${url.pathname} with method ${request.method}`);
    switch (url.pathname) {
      case "/shorten":
        if (request.method === "POST") {
          const formData = await request.formData();
          if (formData.has("uuid") && formData.has("redirect")) {
            const uuidValue = formData.get("uuid") as string;
            const redirectValue = formData.get("redirect") as string;
            const hasCreated = await handleCreate(env, uuidValue, redirectValue);
            if (hasCreated) {
              return new Response(`New tiny url ${url.origin}/${uuidValue}`, { status: 201 });
            }
            return new Response("Forbidden", { status: 401 });
          }
        }
    }

    const redirect = await handleUUID(env, url.pathname);

    if (redirect) {
      const headers = new Headers({
        Location: redirect,
      });

      const status = 302;

      return new Response("", {
        headers,
        status,
      });
    } else {
      return new Response("Not Found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;

async function handleUUID(env: Env, path: string): Promise<string | null> {
  if (UUID_PATH.test(path)) {
    const [, uuid] = path.match(UUID_PATH) || [];
    return env.TINY_URL.get(uuid, { type: "text" });
  }

  return new Promise((resolve) => resolve(null));
}

async function handleCreate(env: Env, uuid: string, redirect: string): Promise<boolean> {
  if (UUID.test(uuid)) {
    const oldRedirect = await env.TINY_URL.get(uuid, { type: "text" });
    if (!oldRedirect) {
      try {
        await env.TINY_URL.put(uuid, redirect);

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
