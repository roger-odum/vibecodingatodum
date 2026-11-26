import { describe, expect, it } from "vitest";
import { agingAlsTabel, berekenAging, bucketVoor, openstaandDomein, type OdooFactuur } from "../src/aging";
import { handleMcp } from "../src/index";
import { OdooClient } from "../src/odoo";

const f = (o: Partial<OdooFactuur>): OdooFactuur => ({
  id: 1,
  name: "BILL/1",
  ref: false,
  partner_id: [10, "Leverancier A"],
  move_type: "in_invoice",
  invoice_date: "2026-09-01",
  invoice_date_due: "2026-10-01",
  amount_residual_signed: -100,
  company_currency_id: [1, "EUR"],
  ...o,
});

describe("bucketVoor", () => {
  it("deelt in op dagen na vervaldatum", () => {
    expect(bucketVoor(-5)).toBe("niet_vervallen");
    expect(bucketVoor(0)).toBe("niet_vervallen");
    expect(bucketVoor(1)).toBe("d1_30");
    expect(bucketVoor(30)).toBe("d1_30");
    expect(bucketVoor(31)).toBe("d31_60");
    expect(bucketVoor(90)).toBe("d61_90");
    expect(bucketVoor(91)).toBe("d90_plus");
  });
});

describe("openstaandDomein", () => {
  it("AP zoekt leveranciersfacturen, AR klantfacturen", () => {
    expect(openstaandDomein("AP")[0]).toEqual(["move_type", "in", ["in_invoice", "in_refund"]]);
    expect(openstaandDomein("AR")[0]).toEqual(["move_type", "in", ["out_invoice", "out_refund"]]);
    expect(openstaandDomein("AP", "Acme")).toContainEqual(["partner_id", "ilike", "Acme"]);
  });
});

describe("berekenAging", () => {
  const peil = "2026-11-26";

  it("groepeert per partner, met creditnota's negatief en ongeacht het teken uit Odoo", () => {
    const r = berekenAging("AP", [
      f({ id: 1, invoice_date_due: "2026-12-10", amount_residual_signed: -200 }), // niet vervallen
      f({ id: 2, invoice_date_due: "2026-11-01", amount_residual_signed: 100 }), // 25 dagen
      f({ id: 3, invoice_date_due: "2026-07-01", amount_residual_signed: -50 }), // 148 dagen
      f({ id: 4, move_type: "in_refund", invoice_date_due: "2026-11-20", amount_residual_signed: 30 }), // credit, 6 dagen
      f({ id: 5, partner_id: [20, "Leverancier B"], invoice_date_due: "2026-09-15", amount_residual_signed: -1000 }), // 72 dagen
    ], peil);

    expect(r.partners.map((p) => p.partner)).toEqual(["Leverancier B", "Leverancier A"]); // grootste eerst
    const a = r.partners[1];
    expect(a.buckets).toEqual({ niet_vervallen: 200, d1_30: 70, d31_60: 0, d61_90: 0, d90_plus: 50 });
    expect(a.totaal).toBe(320);
    expect(a.facturen[0].dagen_vervallen).toBe(148); // oudste eerst
    expect(r.totaal).toMatchObject({ d61_90: 1000, totaal: 1320 });
    expect(r.valuta).toEqual(["EUR"]);
  });

  it("valt terug op de factuurdatum als er geen vervaldatum is", () => {
    const r = berekenAging("AR", [f({ move_type: "out_invoice", invoice_date: "2026-10-27", invoice_date_due: false })], peil);
    expect(r.partners[0].facturen[0]).toMatchObject({ dagen_vervallen: 30, bucket: "d1_30" });
  });

  it("maakt een tabel met totaalrij en optioneel details", () => {
    const r = berekenAging("AP", [f({})], peil);
    const kort = agingAlsTabel(r, false);
    expect(kort).toContain("| Leverancier A |");
    expect(kort).toContain("| **Totaal** |");
    expect(kort).not.toContain("BILL/1");
    expect(agingAlsTabel(r, true)).toContain("BILL/1");
  });

  it("zegt het als er niets openstaat", () => {
    expect(agingAlsTabel(berekenAging("AP", [], peil), false)).toContain("Geen openstaande facturen");
  });
});

describe("tool odoo_ouderdomsanalyse", () => {
  it("vraagt account.move op en geeft tabel en gestructureerde data terug", async () => {
    let gevraagd: any;
    const doFetch = (async (_u: string, init: RequestInit) => {
      const { params } = JSON.parse(init.body as string);
      if (params.method === "authenticate") return Response.json({ result: 3 });
      gevraagd = params.args;
      return Response.json({ result: [f({})] });
    }) as unknown as typeof fetch;
    const odoo = new OdooClient({ url: "https://x", db: "x", username: "u", apiKey: "k" }, doFetch);

    const res = await handleMcp(
      new Request("https://t/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name: "odoo_ouderdomsanalyse", arguments: { peildatum: "2026-11-26" } },
        }),
      }),
      odoo,
    );
    const { result } = (await res.json()) as any;
    expect(gevraagd[3]).toBe("account.move");
    expect(gevraagd[5][0][0]).toEqual(["move_type", "in", ["in_invoice", "in_refund"]]); // standaard AP
    expect(result.content[0].text).toContain("Crediteuren (AP)");
    expect(result.structuredContent.totaal.d31_60).toBe(100);
  });
});
