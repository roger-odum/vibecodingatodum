import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { greet } from "./logic";
import { OdooClient, OdooError } from "./odoo";
import {
  agingAlsTabel,
  berekenAging,
  FACTUUR_VELDEN,
  openstaandDomein,
  vandaagIn,
  type OdooFactuur,
} from "./aging";

/**
 * De logica van elke tool staat los van MCP (`src/logic.ts`, `src/odoo.ts`).
 * Hier koppelen we ze alleen aan een naam, een beschrijving en een schema —
 * dat is wat een AI-client te zien krijgt.
 *
 * Een nieuwe tool toevoegen = één `registerTool`-blok erbij.
 */
export function createServer(odoo?: OdooClient): McpServer {
  const server = new McpServer({ name: "odum-lab-mcp", version: "0.1.0" });

  server.registerTool(
    "zeg_hallo",
    {
      title: "Zeg hallo",
      description: "Begroet iemand bij naam. Handig om te testen of de verbinding werkt.",
      inputSchema: { naam: z.string().min(1).describe("Wie begroet moet worden") },
    },
    async ({ naam }) => ({
      content: [{ type: "text", text: greet(naam) }],
    }),
  );

  server.registerTool(
    "huidige_tijd",
    {
      title: "Huidige tijd",
      description: "Geeft de huidige datum en tijd in een tijdzone (standaard Europe/Brussels).",
      inputSchema: {
        tijdzone: z
          .string()
          .default("Europe/Brussels")
          .describe("IANA-tijdzone, bv. Europe/Amsterdam of America/New_York"),
      },
    },
    async ({ tijdzone }) => {
      try {
        const tekst = new Intl.DateTimeFormat("nl-BE", {
          dateStyle: "full",
          timeStyle: "long",
          timeZone: tijdzone,
        }).format(new Date());
        return { content: [{ type: "text", text: tekst }] };
      } catch {
        return {
          isError: true,
          content: [{ type: "text", text: `Onbekende tijdzone: ${tijdzone}` }],
        };
      }
    },
  );

  if (odoo) registerOdooTools(server, odoo);

  return server;
}

/**
 * Odoo-tools. Bewust alleen-lezen: geen create/write/unlink. Schrijven via
 * een AI-client is een aparte beslissing, met eigen tools per handeling.
 */
function registerOdooTools(server: McpServer, odoo: OdooClient) {
  const model = z.string().regex(/^[a-z0-9_.]+$/).describe("Technische modelnaam, bv. res.partner, sale.order, account.move");
  const domain = z
    .array(z.any())
    .default([])
    .describe('Odoo-domein, bv. [["is_company","=",true],["country_id.code","=","BE"]]');

  const run = async (fn: () => Promise<unknown>) => {
    try {
      const data = await fn();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      const msg = e instanceof OdooError ? e.message : `Fout bij Odoo: ${String(e)}`;
      return { isError: true, content: [{ type: "text" as const, text: msg }] };
    }
  };

  server.registerTool(
    "odoo_zoeken",
    {
      title: "Odoo: records zoeken",
      description:
        "Zoekt records in een Odoo-model (search_read). Geef altijd een beperkte lijst velden mee; " +
        "gebruik odoo_velden om te zien welke velden er bestaan.",
      inputSchema: {
        model,
        domein: domain,
        velden: z.array(z.string()).min(1).describe("Op te halen velden, bv. [\"name\",\"email\"]"),
        limiet: z.number().int().min(1).max(200).default(20),
        sortering: z.string().optional().describe('bv. "create_date desc"'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ model, domein, velden, limiet, sortering }) => run(() => odoo.searchRead(model, domein, velden, limiet, sortering)),
  );

  server.registerTool(
    "odoo_tellen",
    {
      title: "Odoo: records tellen",
      description: "Telt hoeveel records in een Odoo-model aan een domein voldoen (search_count).",
      inputSchema: { model, domein: domain },
      annotations: { readOnlyHint: true },
    },
    ({ model, domein }) => run(() => odoo.searchCount(model, domein)),
  );

  server.registerTool(
    "odoo_ouderdomsanalyse",
    {
      title: "Odoo: openstaande facturen, ouderdomsanalyse per partner",
      description:
        "Haalt alle geboekte, nog openstaande facturen op en toont een aging-lijst per partner: " +
        "bedragen in bedrijfsvaluta, ingedeeld in niet vervallen / 1–30 / 31–60 / 61–90 / >90 dagen " +
        "na vervaldatum. AP = crediteuren (leveranciersfacturen), AR = debiteuren (klantfacturen). " +
        "Creditnota's tellen negatief. Het saldo is het huidige openstaande saldo; de peildatum " +
        "bepaalt alleen de indeling in ouderdomsklassen.",
      inputSchema: {
        soort: z.enum(["AP", "AR"]).default("AP").describe("AP = leveranciers (crediteuren), AR = klanten (debiteuren)"),
        partner: z.string().optional().describe("Optioneel: alleen partners waarvan de naam dit bevat"),
        peildatum: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("YYYY-MM-DD, standaard vandaag (Europe/Brussels)"),
        details: z.boolean().default(false).describe("Ook de afzonderlijke facturen per partner tonen"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ soort, partner, peildatum, details }) => {
      const MAX = 5000;
      try {
        const rows = (await odoo.searchRead(
          "account.move",
          openstaandDomein(soort, partner),
          FACTUUR_VELDEN,
          MAX,
          "invoice_date_due asc",
        )) as OdooFactuur[];
        const rapport = berekenAging(soort, rows, peildatum ?? vandaagIn());
        let tekst = agingAlsTabel(rapport, details);
        if (rows.length >= MAX) {
          tekst += `\n\n⚠️ Afgekapt op ${MAX} facturen: de cijfers zijn onvolledig. Filter op partner.`;
        }
        return {
          content: [{ type: "text" as const, text: tekst }],
          structuredContent: rapport as unknown as Record<string, unknown>,
        };
      } catch (e) {
        const msg = e instanceof OdooError ? e.message : `Fout bij Odoo: ${String(e)}`;
        return { isError: true, content: [{ type: "text" as const, text: msg }] };
      }
    },
  );

  server.registerTool(
    "odoo_velden",
    {
      title: "Odoo: velden van een model",
      description: "Toont de velden van een Odoo-model met hun type en label (fields_get).",
      inputSchema: { model },
      annotations: { readOnlyHint: true },
    },
    ({ model }) => run(() => odoo.fieldsGet(model)),
  );
}
