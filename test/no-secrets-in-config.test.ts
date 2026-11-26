/**
 * Geen sleutels in deze repository.
 *
 * ═══ DE REGEL IS SCHERPER DAN "NOOIT SLEUTELS IN CODE" ═════════════════════════════
 *
 * Xavier stelde de goede vraag, op 23/9: de publishable key van Supabase — de `anon`-key —
 * botst met onze regel, terwijl Supabase hem zelf in elke frontend zet. Moet die dan als
 * secret behandeld worden?
 *
 * Nee, en de reden is de moeite waard omdat ze de regel verduidelijkt in plaats van er een
 * uitzondering op te maken:
 *
 *     Een waarde die de leverancier zelf in zijn eigen frontend publiceert, is geen sleutel.
 *     Al de rest wel.
 *
 * De anon-key geeft op zichzelf geen enkel recht. Wat iemand mag, bepalen zijn login en de
 * RLS-policies op de tabellen. Hij staat in de browser van elke bezoeker. Hem als secret
 * behandelen levert geen bescherming op, alleen de schijn ervan — en die schijn kost iets:
 * wie ziet dat Supabase-keys "in secrets horen", zet op een dag de `service_role`-key op
 * dezelfde plek met hetzelfde comfortabele gevoel. Die omzeilt RLS volledig.
 *
 * Deze test bewaakt precies dat onderscheid. De publieke key mag in `wrangler.jsonc`; alles
 * wat een echte sleutel is, valt door de mand voor het gedeployd wordt.
 *
 * ═══ WAAR DE AANDACHT WERKELIJK HEEN MOET ══════════════════════════════════════════
 *
 * De anon-key is veilig OP VOORWAARDE DAT RLS op elke tabel aanstaat. Dat is de echte
 * beveiliging, niet de key. Een tabel zonder policy is via die publieke key leesbaar voor de
 * hele wereld — ook, en juist, wanneer er nog mock-data in zit en niemand erop let.
 *
 * Deze test kan dat niet nagaan; ze ziet geen Supabase. Schrijf er in je eigen project een
 * test bij die per tabel controleert dat RLS aanstaat en dat er minstens één policy op zit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'dist', '.wrangler', 'package-lock.json']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|jsonc|yml|yaml|toml|md|env|sh)$/;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (TEXT.test(name)) out.push(full);
  }
  return out;
}

interface Pattern {
  name: string;
  re: RegExp;
  why: string;
  /**
   * Waar dit patroon geldt. Weggelaten betekent: overal.
   *
   * Eén patroon heeft dit nodig, en de reden is instructief. `service_role` is de NAAM van de
   * rol die RLS omzeilt, en die naam hoort in documentatie te staan — dit bestand en de README
   * leggen juist uit waarom je hem nergens anders wil zien. Een regel die zijn eigen uitleg
   * verbiedt, wordt binnen de week uitgezet.
   *
   * De sleutel zélf blijft overal verboden: `sb_secret_` en het JWT-patroon kennen geen
   * uitzondering, ook niet in proza.
   */
  where?: RegExp;
}

const PATTERNS: Pattern[] = [
  { name: 'Supabase service_role-key (nieuw formaat)',
    re: /\bsb_secret_[A-Za-z0-9_-]{10,}/,
    why: 'Deze sleutel omzeilt RLS volledig en geeft toegang tot elke rij in elke tabel. Hij '
       + 'hoort in de Secrets Store of als Worker-secret, nooit in een bestand dat meegaat '
       + 'met de repository.' },

  { name: 'Supabase service_role-key (legacy JWT)',
    // Een JWT met "role":"service_role" in de payload. We decoderen niet: base64url van
    // `"role":"service_role"` begt met een handvol vaste varianten naargelang de offset, en
    // de naam zelf zoeken is betrouwbaarder dan de drie varianten uitschrijven.
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    why: 'Er staat een JWT in dit bestand. De publishable (anon) key van Supabase is er ook '
       + 'een, en die mag hier staan — maar de service_role-key ziet er identiek uit en mag '
       + 'dat absoluut niet. Omdat ze van buitenaf niet te onderscheiden zijn, hoort geen van '
       + 'beide hier hard ingetypt te worden: zet de anon-key als `vars`-waarde met een '
       + 'duidelijke naam (SUPABASE_PUBLISHABLE_KEY) en controleer op supabase.com dat het de '
       + 'publishable is. Is dat gebeurd, voeg dit bestand dan toe aan ALLOW hieronder, met '
       + 'de reden erbij.' },

  { name: 'service_role, letterlijk',
    re: /["'`]service_role["'`]|\bservice_role\s*[:=]/,
    where: /\.(ts|tsx|js|mjs|cjs|json|jsonc|yml|yaml|toml|env|sh)$/,
    why: 'De naam van de rol die RLS omzeilt. Als die hier staat, staat de sleutel er '
       + 'vermoedelijk naast.' },

  { name: 'private key',
    re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    why: 'Een privésleutel hoort nooit in een repository, ook niet in een testmap.' },

  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/,
    why: 'Een AWS-sleutel geeft toegang tot wat de bijhorende rol mag, en dat is zelden weinig.' },

  { name: 'GitHub token', re: /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    why: 'Een GitHub-token in een repository is een token dat iedereen met leesrecht heeft.' },

  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    why: 'Geeft toegang tot de werkruimte waar hij bij hoort.' },

  { name: 'OpenAI- of Anthropic-sleutel', re: /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/,
    why: 'Een API-sleutel op onze rekening. Hoort in de Secrets Store.' },

  { name: 'Cloudflare API-token in tekst', re: /CLOUDFLARE_API_TOKEN\s*[:=]\s*["'][^"'$\s]{20,}/,
    why: 'Het deploy-token hoort een GitHub-secret te zijn, niet een waarde in een bestand.' },
];

/**
 * Bestanden waarvoor een patroon bewust toegestaan is, met de reden.
 *
 * Voeg hier niets aan toe om van een falende test af te komen. Een uitzondering hoort een
 * beslissing te zijn die iemand kan navertellen, niet een stilzwijgende.
 */
const ALLOW: { file: string; pattern: string; why: string }[] = [
  // Voorbeeld — laat staan als model:
  // { file: 'src/supabase.ts', pattern: 'Supabase service_role-key (legacy JWT)',
  //   why: 'Publishable (anon) key, nagekeken op supabase.com op <datum> door <naam>. '
  //      + 'Geeft geen rechten; RLS bepaalt wat een gebruiker mag.' },
];

describe('geen sleutels in deze repository', () => {
  const scanned = files(ROOT).filter((f) => !f.endsWith('no-secrets-in-config.test.ts'));

  test('er valt iets te scannen', () => {
    expect(scanned.length).toBeGreaterThan(0);
  });

  for (const p of PATTERNS) {
    test(p.name, () => {
      const hits: string[] = [];
      for (const f of scanned) {
        const rel = relative(ROOT, f);
        if (ALLOW.some((a) => a.file === rel && a.pattern === p.name)) continue;
        if (p.where && !p.where.test(f)) continue;
        if (p.re.test(readFileSync(f, 'utf8'))) hits.push(rel);
      }
      expect(hits, `${p.name} gevonden in: ${hits.join(', ')}\n\n${p.why}`).toEqual([]);
    });
  }
});
