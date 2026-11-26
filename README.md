# Odum Lab Starter

Startpunt voor een nieuw project van een Digital Challenger. Draait op
Cloudflare Workers in het **Odum Labs**-account, op een eigen hostname
onder `lab.odum.cloud`.

Alles wat je nodig hebt staat er al in. Je hernoemt drie dingen en je bent weg.

## Een nieuw project beginnen

1. **Use this template** op GitHub → nieuwe repository onder `Odum-digital`.

2. **Kies een naam.** Kleine letters en koppeltekens, en dezelfde naam op
   drie plaatsen:

   | Bestand | Veld |
   |---|---|
   | `wrangler.jsonc` | `name` |
   | `wrangler.jsonc` | `routes[0].pattern` → `<naam>.lab.odum.cloud` |
   | `package.json` | `name` |

3. **Push naar `main`.** De rest gebeurt vanzelf: de controles draaien, de
   Worker wordt gedeployed, en Cloudflare maakt het DNS-record aan.

Je project staat daarna op `https://<naam>.lab.odum.cloud`.

## Lokaal werken

```
npm install
npm run dev        # lokale server
npm test           # tests
npm run typecheck  # typecontrole
npm run tail       # live logs van de gedeployde Worker
```

Commit je `package-lock.json` na die eerste `npm install`.

## Wat al beslist is, en waarom

**`workers_dev: false`** — je project krijgt geen tweede adres op
`workers.dev`. Eén project, één URL. Anders zwerft er een link rond die
niemand beheert, op een gedeeld domein van Cloudflare dat veel in
phishingcampagnes opduikt.

**Elke merge naar `main` deployt.** Dat mag in Labs: er staat hier niets
dat een klant in productie gebruikt, en snel iets kunnen tonen is het punt.
Bouwen en aan een klant tonen lopen bij ons door elkaar, dus het adres
verandert nooit — de link die je op dag drie stuurt, werkt op dag dertig nog.

**Het token staat in GitHub, niet bij jou.** `CLOUDFLARE_API_TOKEN_LABS` is
een organization secret. Je hoeft niets aan te vragen of te plaatsen. Zie je
een deploy falen op dat token, laat het Olivier weten.

**De logica staat los van de fetch-handler.** Daardoor zijn je tests gewone
tests, zonder dat je een Worker moet starten. Zie `src/index.ts` en
`test/index.test.ts`.

## MCP-server en Odoo

Deze Worker is een **MCP-server** op `https://<naam>.lab.odum.cloud/mcp`
(Streamable HTTP, stateless). Een AI-client (Claude, Cursor, …) verbindt
daarmee en krijgt deze tools:

| Tool | Wat |
|---|---|
| `zeg_hallo`, `huidige_tijd` | Voorbeelden, om te testen of de verbinding werkt |
| `odoo_zoeken` | `search_read` op een Odoo-model, met domein, velden, limiet, sortering |
| `odoo_tellen` | `search_count` op een Odoo-model |
| `odoo_velden` | `fields_get`: welke velden een model heeft |
| `odoo_ouderdomsanalyse` | Openstaande facturen als aging-lijst per partner (niet vervallen / 1–30 / 31–60 / 61–90 / >90 dagen). `soort`: `AP` (leveranciers, standaard) of `AR` (klanten); optioneel `partner`, `peildatum`, `details` |

De Odoo-tools zijn **alleen-lezen**. Schrijven naar Odoo is een aparte
beslissing, met een eigen tool per handeling.

**Instellen**

1. In Odoo: maak (bij voorkeur) een aparte gebruiker met alleen leesrechten
   op wat nodig is, en maak voor die gebruiker een API-sleutel aan
   (Voorkeuren → Account-beveiliging → Nieuwe API-sleutel).
2. `wrangler.jsonc` → `vars`: vul `ODOO_URL`, `ODOO_DB` en `ODOO_USERNAME` in.
3. GitHub → Settings → Secrets → Actions, op deze repository:
   - `ODOO_API_KEY` — de API-sleutel uit stap 1
   - `MCP_TOKEN` — een lange willekeurige string (`openssl rand -hex 32`)
4. Push naar `main`. De deploy zet beide secrets op de Worker.

`/health` toont of Odoo geconfigureerd is. Zonder `MCP_TOKEN` blijft `/mcp`
dicht (401): het endpoint geeft toegang tot Odoo-data, dus het staat nooit
open. Clients sturen `Authorization: Bearer <MCP_TOKEN>` mee.

Lokaal: zet dezelfde waarden in `.dev.vars` (staat in `.gitignore`).

## Iets nodig hebben

Een database, sleutel-waardeopslag of bestandsopslag voeg je toe in
`wrangler.jsonc`; de plekken staan er al in als commentaar. Het token mag
D1, KV en R2 aanmaken, dus dat kan je zelf.

Moet een pagina achter authenticatie, zet dan Cloudflare Access **op de
Worker** in plaats van op een hostname. Dan zijn je eigen adres én de
preview-URL's in één handeling beschermd.

## Sleutels, en wat géén sleutel is

De regel is niet "nooit iets dat op een sleutel lijkt in code". Ze is preciezer,
en dat verschil bespaart je werk:

> Een waarde die de leverancier zelf in zijn eigen frontend publiceert, is geen
> sleutel. Al de rest wel.

De publishable key van Supabase — de `anon`-key — is daar het schoolvoorbeeld
van. Hij geeft op zichzelf geen enkel recht: wat iemand mag, bepalen zijn login
en de RLS-policies op de tabellen. Supabase zet hem in elke frontend, dus hij
staat sowieso in de browser van elke bezoeker. Hem als secret behandelen levert
geen bescherming op, alleen de schijn ervan — en die schijn is gevaarlijk, want
wie leert dat "Supabase-keys in secrets horen", zet op een dag de
`service_role`-key op dezelfde plek. Die omzeilt RLS volledig.

Dus: publiceerbare waarden mogen als gewone `vars` in `wrangler.jsonc`, met een
naam die geen twijfel laat (`SUPABASE_PUBLISHABLE_KEY`). Echte sleutels gaan
naar een GitHub-secret of de Secrets Store, nooit in een bestand.

`test/no-secrets-in-config.test.ts` bewaakt dat. Hij draait bij elke `npm test`
en in CI, en hij kent de patronen die er wél toe doen. Valt hij, dan is er een
uitzonderingslijst met een verplicht veld: de reden. Voeg daar niets aan toe om
van een rode test af te komen.

**En het punt waar je aandacht werkelijk heen moet.** De anon-key is veilig
*op voorwaarde dat* RLS op elke tabel aanstaat. Dat is de beveiliging, niet de
key — een tabel zonder policy is via die publieke key leesbaar voor de hele
wereld. Zet in je project een test die per tabel controleert dat RLS aanstaat en
dat er minstens één policy op zit. Dat het nog mock-data is, maakt dat niet
minder belangrijk: het maakt het het goede moment.

## Als het echt wordt

Wordt je project een dienst die een klant gaat gebruiken, dan verhuist het
naar productie. Dat regelt Olivier: de Worker komt in het productie-account
en je repository krijgt een token dat precies die ene Worker mag bijwerken
en deployen — en niet verwijderen.

Dat is de enige plek in dit hele verhaal waar wrijving zit, en die zit daar
met opzet.

## Eén ding dat alleen hier geldt

De deploy-workflow slaat zichzelf over in deze sjabloonrepository — anders zou
elke wijziging hier een Worker neerzetten op een adres dat van niemand is. In
jouw kopie verschilt de repositorynaam en draait hij gewoon. Je hoeft die regel
niet weg te halen.
