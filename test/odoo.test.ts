import { describe, expect, it } from "vitest";
import worker, { handleMcp, isAuthorized } from "../src/index";
import { OdooClient } from "../src/odoo";

/** Nep-Odoo: onthoudt de calls en antwoordt zoals /jsonrpc dat doet. */
function fakeOdoo(handler: (service: string, method: string, args: any[]) => unknown) {
  const calls: { service: string; method: string; args: any[] }[] = [];
  const doFetch = (async (_url: string, init: RequestInit) => {
    const { params } = JSON.parse(init.body as string);
    calls.push(params);
    try {
      return Response.json({ jsonrpc: "2.0", id: 1, result: handler(params.service, params.method, params.args) });
    } catch (e) {
      return Response.json({ jsonrpc: "2.0", id: 1, error: { message: "Odoo Server Error", data: { message: String((e as Error).message) } } });
    }
  }) as unknown as typeof fetch;
  const client = new OdooClient({ url: "https://x.odoo.com/", db: "x", username: "api@x", apiKey: "k" }, doFetch);
  return { client, calls };
}

async function callTool(odoo: OdooClient, name: string, args: unknown) {
  const res = await handleMcp(
    new Request("https://test.local/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
    odoo,
  );
  return ((await res.json()) as any).result;
}

describe("OdooClient", () => {
  it("logt eerst in en doet dan search_read met de juiste argumenten", async () => {
    const { client, calls } = fakeOdoo((s, m) => (m === "authenticate" ? 7 : [{ id: 1, name: "Acme" }]));
    const rows = await client.searchRead("res.partner", [["is_company", "=", true]], ["name"], 5);
    expect(rows).toEqual([{ id: 1, name: "Acme" }]);
    expect(calls[0]).toMatchObject({ service: "common", method: "authenticate" });
    expect(calls[1].args).toEqual(["x", 7, "k", "res.partner", "search_read", [[["is_company", "=", true]]], { fields: ["name"], limit: 5 }]);
  });

  it("geeft een duidelijke fout als inloggen mislukt", async () => {
    const { client } = fakeOdoo(() => false);
    await expect(client.login()).rejects.toThrow(/Inloggen bij Odoo mislukt/);
  });
});

describe("Odoo-tools via MCP", () => {
  it("odoo_tellen geeft het aantal terug", async () => {
    const { client } = fakeOdoo((_s, m) => (m === "authenticate" ? 2 : 42));
    const r = await callTool(client, "odoo_tellen", { model: "sale.order" });
    expect(r.content[0].text).toBe("42");
  });

  it("een Odoo-fout wordt een nette toolfout", async () => {
    const { client } = fakeOdoo((_s, m) => {
      if (m === "authenticate") return 2;
      throw new Error("Object bestaat.niet doesn't exist");
    });
    const r = await callTool(client, "odoo_velden", { model: "bestaat.niet" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("doesn't exist");
  });
});

describe("toegang tot /mcp", () => {
  it("is dicht zonder ingesteld token", () => {
    expect(isAuthorized(new Request("https://x/mcp"), undefined)).toBe(false);
  });

  it("vraagt het juiste bearer-token", () => {
    const req = (t: string) => new Request("https://x/mcp", { headers: { authorization: `Bearer ${t}` } });
    expect(isAuthorized(req("geheim"), "geheim")).toBe(true);
    expect(isAuthorized(req("fout!!"), "geheim")).toBe(false);
  });

  it("de Worker weigert /mcp met 401 zonder token", async () => {
    const res = await worker.fetch(new Request("https://x/mcp", { method: "POST" }), {});
    expect(res.status).toBe(401);
  });
});
