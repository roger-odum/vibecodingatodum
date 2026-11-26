import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./mcp";
import { OdooClient, odooConfigFromEnv } from "./odoo";

export { greet } from "./logic";

export interface Env {
  // Gewone instellingen (vars in wrangler.jsonc) — geen geheimen.
  ODOO_URL?: string;
  ODOO_DB?: string;
  ODOO_USERNAME?: string;

  // Secrets — nooit in een bestand. Zie README, "MCP-server en Odoo".
  ODOO_API_KEY?: string;
  MCP_TOKEN?: string;
}

/**
 * MCP over "Streamable HTTP", stateless: elke request krijgt een verse
 * server en transport. Geen sessies, geen Durable Objects nodig — prima
 * zolang je tools zelf geen toestand tussen calls bijhouden.
 */
export async function handleMcp(request: Request, odoo?: OdooClient): Promise<Response> {
  const server = createServer(odoo);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/**
 * Het endpoint geeft toegang tot Odoo-data, dus het staat nooit open.
 * Geen MCP_TOKEN ingesteld = dicht (fail closed), niet open.
 */
export function isAuthorized(request: Request, token: string | undefined): boolean {
  if (!token) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      if (!isAuthorized(request, env.MCP_TOKEN)) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "www-authenticate": 'Bearer realm="mcp"' },
        });
      }
      const cfg = odooConfigFromEnv(env);
      return handleMcp(request, cfg ? new OdooClient(cfg) : undefined);
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        odoo: odooConfigFromEnv(env) ? "geconfigureerd" : "niet geconfigureerd",
        at: new Date().toISOString(),
      });
    }

    return new Response(
      `MCP-server draait. Verbind je client met ${url.origin}/mcp\n`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  },
} satisfies ExportedHandler<Env>;
