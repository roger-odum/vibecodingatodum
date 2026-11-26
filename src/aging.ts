/**
 * Ouderdomsanalyse (aging) van openstaande facturen, los van Odoo en MCP
 * zodat de rekenregels gewone, testbare code zijn.
 *
 * AP = crediteuren (leveranciersfacturen: in_invoice / in_refund)
 * AR = debiteuren  (klantfacturen:       out_invoice / out_refund)
 */
export type Soort = "AP" | "AR";

export const MOVE_TYPES: Record<Soort, [string, string]> = {
  AP: ["in_invoice", "in_refund"],
  AR: ["out_invoice", "out_refund"],
};

/** Odoo-domein voor geboekte facturen met een openstaand saldo. */
export function openstaandDomein(soort: Soort, partner?: string): unknown[] {
  const d: unknown[] = [
    ["move_type", "in", MOVE_TYPES[soort]],
    ["state", "=", "posted"],
    ["amount_residual", "!=", 0],
  ];
  if (partner) d.push(["partner_id", "ilike", partner]);
  return d;
}

export const FACTUUR_VELDEN = [
  "name",
  "ref",
  "partner_id",
  "move_type",
  "invoice_date",
  "invoice_date_due",
  "amount_residual_signed",
  "company_currency_id",
];

/** Zoals Odoo een factuur via search_read teruggeeft (alleen wat we gebruiken). */
export interface OdooFactuur {
  id: number;
  name: string;
  ref?: string | false;
  partner_id: [number, string] | false;
  move_type: string;
  invoice_date: string | false;
  invoice_date_due: string | false;
  amount_residual_signed: number;
  company_currency_id?: [number, string] | false;
}

export const BUCKETS = ["niet_vervallen", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABELS: Record<Bucket, string> = {
  niet_vervallen: "Niet vervallen",
  d1_30: "1–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90_plus: "> 90",
};

export interface FactuurRegel {
  id: number;
  nummer: string;
  referentie: string | null;
  factuurdatum: string | null;
  vervaldatum: string | null;
  dagen_vervallen: number;
  bucket: Bucket;
  openstaand: number;
}

export interface PartnerAging {
  partner_id: number | null;
  partner: string;
  buckets: Record<Bucket, number>;
  totaal: number;
  facturen: FactuurRegel[];
}

export interface AgingRapport {
  soort: Soort;
  peildatum: string;
  valuta: string[];
  partners: PartnerAging[];
  totaal: Record<Bucket, number> & { totaal: number };
}

function dagNummer(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function bucketVoor(dagenVervallen: number): Bucket {
  if (dagenVervallen <= 0) return "niet_vervallen";
  if (dagenVervallen <= 30) return "d1_30";
  if (dagenVervallen <= 60) return "d31_60";
  if (dagenVervallen <= 90) return "d61_90";
  return "d90_plus";
}

const rond = (n: number) => Math.round(n * 100) / 100;
const leeg = (): Record<Bucket, number> =>
  ({ niet_vervallen: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });

/**
 * Bedragen in bedrijfsvaluta, positief = openstaand, creditnota's negatief.
 * Het teken van `amount_residual_signed` verschilt tussen Odoo-versies, dus
 * we nemen de absolute waarde en leiden het teken af uit het factuurtype.
 */
export function berekenAging(soort: Soort, facturen: OdooFactuur[], peildatum: string): AgingRapport {
  const vandaag = dagNummer(peildatum);
  const perPartner = new Map<string, PartnerAging>();
  const valuta = new Set<string>();

  for (const f of facturen) {
    const isCredit = f.move_type === MOVE_TYPES[soort][1];
    const bedrag = rond(Math.abs(f.amount_residual_signed) * (isCredit ? -1 : 1));
    const verval = f.invoice_date_due || f.invoice_date || null;
    const dagen = verval ? vandaag - dagNummer(verval) : 0;
    const bucket = bucketVoor(dagen);
    if (f.company_currency_id) valuta.add(f.company_currency_id[1]);

    const pid = f.partner_id ? f.partner_id[0] : null;
    const key = String(pid);
    let p = perPartner.get(key);
    if (!p) {
      p = { partner_id: pid, partner: f.partner_id ? f.partner_id[1] : "(geen partner)", buckets: leeg(), totaal: 0, facturen: [] };
      perPartner.set(key, p);
    }
    p.buckets[bucket] = rond(p.buckets[bucket] + bedrag);
    p.totaal = rond(p.totaal + bedrag);
    p.facturen.push({
      id: f.id,
      nummer: f.name,
      referentie: f.ref || null,
      factuurdatum: f.invoice_date || null,
      vervaldatum: verval,
      dagen_vervallen: Math.max(0, dagen),
      bucket,
      openstaand: bedrag,
    });
  }

  const partners = [...perPartner.values()].sort((a, b) => b.totaal - a.totaal);
  for (const p of partners) p.facturen.sort((a, b) => b.dagen_vervallen - a.dagen_vervallen);

  const totaal = { ...leeg(), totaal: 0 };
  for (const p of partners) {
    for (const b of BUCKETS) totaal[b] = rond(totaal[b] + p.buckets[b]);
    totaal.totaal = rond(totaal.totaal + p.totaal);
  }

  return { soort, peildatum, valuta: [...valuta], partners, totaal };
}

const fmt = (n: number) =>
  n === 0 ? "–" : new Intl.NumberFormat("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Leesbare markdown-tabel, één rij per partner, met totaalrij. */
export function agingAlsTabel(r: AgingRapport, metDetails: boolean): string {
  const titel = r.soort === "AP" ? "Crediteuren (AP)" : "Debiteuren (AR)";
  const wie = r.soort === "AP" ? "Leverancier" : "Klant";
  const valuta = r.valuta.length ? ` — bedragen in ${r.valuta.join(", ")}` : "";
  const regels = [
    `## Ouderdomsanalyse ${titel} per ${r.peildatum}${valuta}`,
    "",
    `Dagen na vervaldatum. ${r.partners.length} ${wie.toLowerCase()}(s) met openstaande facturen.`,
  ];
  if (r.valuta.length > 1) {
    regels.push("", "⚠️ Meerdere bedrijfsvaluta's: de totalen tellen bedragen in verschillende valuta op.");
  }
  if (!r.partners.length) return [...regels, "", "Geen openstaande facturen."].join("\n");

  const kop = [wie, ...BUCKETS.map((b) => BUCKET_LABELS[b]), "Totaal"];
  regels.push("", `| ${kop.join(" | ")} |`, `|${kop.map((_, i) => (i ? "---:" : "---")).join("|")}|`);
  for (const p of r.partners) {
    regels.push(`| ${p.partner} | ${BUCKETS.map((b) => fmt(p.buckets[b])).join(" | ")} | **${fmt(p.totaal)}** |`);
  }
  regels.push(`| **Totaal** | ${BUCKETS.map((b) => `**${fmt(r.totaal[b])}**`).join(" | ")} | **${fmt(r.totaal.totaal)}** |`);

  if (metDetails) {
    for (const p of r.partners) {
      regels.push("", `### ${p.partner}`, "", "| Factuur | Referentie | Factuurdatum | Vervaldatum | Dagen | Openstaand |", "|---|---|---|---|---:|---:|");
      for (const f of p.facturen) {
        regels.push(`| ${f.nummer} | ${f.referentie ?? ""} | ${f.factuurdatum ?? ""} | ${f.vervaldatum ?? ""} | ${f.dagen_vervallen} | ${fmt(f.openstaand)} |`);
      }
    }
  }
  return regels.join("\n");
}

/** Vandaag als YYYY-MM-DD in de opgegeven tijdzone. */
export function vandaagIn(tijdzone = "Europe/Brussels"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tijdzone }).format(new Date());
}
