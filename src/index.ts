export interface Env {
  // Bindings die je in wrangler.jsonc toevoegt, komen hier ook te staan.
  // DB: D1Database
  // KV: KVNamespace
}

/**
 * Losse functie in plaats van alles in de fetch-handler, zodat je logica
 * te testen is zonder een Worker te moeten starten. Zie test/index.test.ts.
 */
export function greet(name: string): string {
  return `Hallo ${name} — dit draait op Cloudflare Workers.`;
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, at: new Date().toISOString() });
    }

    return new Response(greet("wereld"), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
