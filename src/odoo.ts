/**
 * Minimale Odoo-client via het externe JSON-RPC-endpoint (`/jsonrpc`).
 * Werkt op Odoo 14 t/m 19, zowel Odoo Online als self-hosted.
 *
 * Inloggen gebeurt met een API-key (Odoo: Voorkeuren → Account-beveiliging
 * → Nieuwe API-sleutel), niet met een wachtwoord. Die key is een echte
 * sleutel: hij hoort als Worker-secret `ODOO_API_KEY`, nooit in een bestand.
 */
export interface OdooConfig {
  url: string; // bv. https://jouwbedrijf.odoo.com
  db: string;
  username: string; // login (meestal e-mailadres) van de API-gebruiker
  apiKey: string;
}

export class OdooError extends Error {}

type Fetch = typeof fetch;

export class OdooClient {
  private uid: number | undefined;

  constructor(
    private readonly cfg: OdooConfig,
    private readonly doFetch: Fetch = fetch,
  ) {}

  private async call(service: string, method: string, args: unknown[]): Promise<any> {
    // Alleen het domein telt: wie https://x.odoo.com/odoo (de adresbalk van
    // de webclient) invult, zou anders naar /odoo/jsonrpc posten.
    const res = await this.doFetch(`${new URL(this.cfg.url).origin}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        id: Date.now(),
        params: { service, method, args },
      }),
    });
    if (!res.ok) throw new OdooError(`Odoo antwoordde met HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string; data?: { message?: string } } };
    if (body.error) {
      throw new OdooError(body.error.data?.message ?? body.error.message ?? "Onbekende Odoo-fout");
    }
    return body.result;
  }

  async login(): Promise<number> {
    if (this.uid !== undefined) return this.uid;
    const uid = await this.call("common", "authenticate", [
      this.cfg.db,
      this.cfg.username,
      this.cfg.apiKey,
      {},
    ]);
    if (typeof uid !== "number" || uid <= 0) {
      throw new OdooError("Inloggen bij Odoo mislukt: controleer database, gebruikersnaam en API-key.");
    }
    this.uid = uid;
    return uid;
  }

  async executeKw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<any> {
    const uid = await this.login();
    return this.call("object", "execute_kw", [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs]);
  }

  searchRead(model: string, domain: unknown[], fields: string[], limit: number, order?: string) {
    return this.executeKw(model, "search_read", [domain], {
      fields,
      limit,
      ...(order ? { order } : {}),
    });
  }

  searchCount(model: string, domain: unknown[]): Promise<number> {
    return this.executeKw(model, "search_count", [domain]);
  }

  fieldsGet(model: string) {
    return this.executeKw(model, "fields_get", [], { attributes: ["string", "type", "relation", "required"] });
  }
}

/** Leest de Odoo-config uit de Worker-omgeving; `undefined` als iets ontbreekt. */
export function odooConfigFromEnv(env: {
  ODOO_URL?: string;
  ODOO_DB?: string;
  ODOO_USERNAME?: string;
  ODOO_API_KEY?: string;
}): OdooConfig | undefined {
  const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY } = env;
  if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_API_KEY) return undefined;
  return { url: ODOO_URL, db: ODOO_DB, username: ODOO_USERNAME, apiKey: ODOO_API_KEY };
}
