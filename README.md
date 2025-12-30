# FEST – Gödseloptimering med MILP

> **Status:** Produktion med HiGHS-baserad V7-motor

FEST (Fertilizer Expert Sales Tool) är ett beslutsstöd för gödselförsäljare. Systemet beräknar kostnadsoptimala gödselkombinationer utifrån grödans näringsbehov, förfrukt och markkartering.

---

## Innehåll

1. [Snabbstart](#snabbstart)
2. [Arkitektur](#arkitektur)
3. [API-referens](#api-referens)
4. [Optimeringsmotorer](#optimeringsmotorer)
5. [Frontend](#frontend)
6. [Databas](#databas)
7. [Konfiguration](#konfiguration)
8. [Utveckling](#utveckling)

---

## Snabbstart

```bash
# Installera beroenden
npm install

# Starta server (port 3000)
npm run server

# Öppna i webbläsare
open http://localhost:3000
```

### Miljövariabler

Skapa `.env` i projektets rot:

```env
# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Server
PORT=3000

# Säkerhet (produktion)
ADMIN_PASSWORD=ditt-admin-lösenord
API_KEYS=nyckel1,nyckel2,nyckel3

# M3 ERP-integration
M3_WEBHOOK_SECRET=hemlig-webhook-nyckel
```

---

## API-säkerhet

### Åtkomstnivåer

| Endpoint | Autentisering | Beskrivning |
|----------|---------------|-------------|
| `/health` | Ingen | Hälsokontroll |
| `/api/recommend` | API-nyckel | Gödseloptimering |
| `/api/products` | API-nyckel | Läs produkter |
| `/api/crops` | API-nyckel | Läs grödor |
| `/api/calculate-need` | API-nyckel | Beräkna näringsbehov |
| `/api/admin/*` | Admin-lösenord | Databashantering |
| `/api/webhook/m3-product` | Webhook-secret | M3 ERP-integration |
| `/api/optimize-v*` | Blockerad externt | Interna optimerare |

### API-nyckel (extern åtkomst)

```bash
curl -H "X-API-Key: din-nyckel" http://localhost:3000/api/products
```

### Admin-lösenord (databasändringar)

```bash
curl -H "X-Admin-Password: ditt-lösenord" http://localhost:3000/api/admin/products
```

### M3 Webhook (ERP-integration)

```bash
curl -X POST http://localhost:3000/api/webhook/m3-product \
  -H "X-Webhook-Secret: din-hemliga-nyckel" \
  -H "Content-Type: application/json" \
  -d '{"itemNumber": "301763", "salesPrice": 5500, "active": true}'
```

Se `docs/M3_WEBHOOK_INTEGRATION.md` för fullständig dokumentation.

### Swagger UI

- **Extern dokumentation:** `/api-docs`
- **Intern dokumentation:** `/api-docs-internal`

### Produktion (Railway)

```
https://fest-production-d1bb.up.railway.app
```

---

## Arkitektur

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Vanilla JS)                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │  Forms  │ │ Balance │ │   API   │ │  State  │           │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │
└───────┼───────────┼───────────┼───────────┼─────────────────┘
        │           │           │           │
        └───────────┴─────┬─────┴───────────┘
                          │ HTTP
┌─────────────────────────┼───────────────────────────────────┐
│                    Express Server                           │
│  ┌──────────────────────┴──────────────────────┐           │
│  │              server.ts (~1150 rader)         │           │
│  │  • /api/recommend    → recommend.ts          │           │
│  │  • /api/products     → Supabase CRUD         │           │
│  │  • /api/crops        → Supabase + fallback   │           │
│  │  • /api/algorithm-config                     │           │
│  └──────────────────────┬──────────────────────┘           │
└─────────────────────────┼───────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                   Optimeringsmotor                          │
│  ┌──────────────────────┴──────────────────────┐           │
│  │           recommend.ts (orchestrator)        │           │
│  │                      │                       │           │
│  │           ┌──────────▼──────────┐           │           │
│  │           │   optimize-v7.ts    │           │           │
│  │           │   (HiGHS MILP)      │           │           │
│  │           │   ~1150 rader       │           │           │
│  │           └──────────┬──────────┘           │           │
│  │                      │                       │           │
│  │           ┌──────────▼──────────┐           │           │
│  │           │    scoring.ts       │           │           │
│  │           │  (lösningsutvärdering)          │           │
│  │           └─────────────────────┘           │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                     Supabase                                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │  products   │ │    crops    │ │  algorithm_config   │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Filstruktur

```
src/
├── api/
│   ├── server.ts       # Express-server, alla endpoints
│   ├── start.ts        # Serverstart
│   └── supabase.ts     # Supabase-klient
├── engine/
│   ├── recommend.ts    # Rekommendations-orchestrator
│   ├── optimize-v7.ts  # HiGHS MILP (produktion)
│   ├── optimize-v6.ts  # HiGHS legacy
│   ├── optimize-v5.ts  # javascript-lp-solver
│   ├── optimize-v4.ts  # Kombinatorisk sökning
│   └── scoring.ts      # Lösningsutvärdering
├── models/
│   ├── Product.ts      # Produkttyper
│   ├── Solution.ts     # Lösningstyper
│   ├── NutrientNeed.ts # Näringsbehovstyper
│   └── Tolerances.ts   # Toleranstyper
└── data/
    └── crops.ts        # Fallback-gröddata

public/
├── index.html          # Huvudapplikation
├── admin.html          # Produktadministration
├── admin-crops.html    # Grödadministration
├── analysis.html       # Analysverktyg
└── js/
    ├── app.js          # Applikationsstart
    ├── api.js          # API-kommunikation
    ├── state.js        # Global state
    ├── forms.js        # Formulärhantering
    ├── balance.js      # Näringsberäkningar
    ├── purchase-list.js # Inköpslista
    ├── storage.js      # localStorage
    ├── tabs.js         # Fliknavigering
    └── utils.js        # Hjälpfunktioner
```

---

## API-referens

### POST /api/recommend

Beräknar optimal gödselkombination.

**Request:**
```json
{
  "need": {
    "N": 150,
    "P": 30,
    "K": 50,
    "S": 20
  },
  "requiredNutrients": ["N", "P", "K", "S"],
  "maxProducts": 3,
  "excludeProducts": [123],
  "preferBulk": true
}
```

**Response:**
```json
{
  "solutions": [
    {
      "products": [
        {
          "id": 1,
          "name": "NS 27-4",
          "amountKgPerHa": 450,
          "costPerHa": 2025
        }
      ],
      "costPerHa": 2850,
      "supplied": {
        "N": 152,
        "P": 32,
        "K": 55,
        "S": 22
      },
      "score": 0.92
    }
  ],
  "metadata": {
    "engine": "v7",
    "solveTimeMs": 45,
    "productsConsidered": 89
  }
}
```

### GET /api/products

Hämtar alla aktiva produkter.

### POST /api/products

Skapar ny produkt.

### PUT /api/products/:id

Uppdaterar produkt.

### DELETE /api/products/:id

Tar bort produkt (soft delete).

### GET /api/crops

Hämtar alla grödor med näringsbehov.

### POST /api/crops

Skapar ny gröda.

### PUT /api/crops/:id

Uppdaterar gröda.

### DELETE /api/crops/:id

Tar bort gröda.

### GET /api/algorithm-config

Hämtar aktuell algoritm-konfiguration.

### PUT /api/algorithm-config

Uppdaterar algoritm-konfiguration.

---

## Optimeringsmotorer

### V7 – HiGHS MILP (Produktion)

Produktionsmotorn använder HiGHS för Mixed Integer Linear Programming.

**Mål:** Minimera total kostnad per hektar

**Villkor:**
- Näringsbehov uppfylls inom konfigurerade toleranser
- Max antal produkter (via binärvariabler)
- Bulk/säck-exklusivitet (samma produkt kan ej användas i båda former)
- Min/max-gränser per produkt

**Konfiguration** (från `algorithm_config`-tabellen):

| Parameter | Beskrivning | Default |
|-----------|-------------|---------|
| `max_products` | Max antal produkter | 3 |
| `n_tolerance_under` | N underskottstolerans (%) | 5 |
| `n_tolerance_over` | N överskottstolerans (%) | 15 |
| `p_tolerance_under` | P underskottstolerans (%) | 10 |
| `p_tolerance_over` | P överskottstolerans (%) | 50 |
| `k_tolerance_under` | K underskottstolerans (%) | 10 |
| `k_tolerance_over` | K överskottstolerans (%) | 50 |
| `s_tolerance_under` | S underskottstolerans (%) | 20 |
| `s_tolerance_over` | S överskottstolerans (%) | 100 |

### Legacy-motorer (bevarade för framtida behov)

- **V6** – Tidigare HiGHS-implementation
- **V5** – javascript-lp-solver (ren JavaScript)
- **V4** – Kombinatorisk sökning (brute force)

---

## Frontend

Modulär vanilla JavaScript-arkitektur.

### Moduler

| Modul | Ansvar |
|-------|--------|
| `state.js` | Global applikationsstate |
| `api.js` | Alla API-anrop |
| `forms.js` | Formulärlogik och validering |
| `balance.js` | Näringsberäkningar |
| `purchase-list.js` | Inköpslista-hantering |
| `storage.js` | localStorage-persistens |
| `tabs.js` | Fliknavigering |
| `utils.js` | Formatterare och hjälpfunktioner |
| `app.js` | Applikationsinitiering |

### Flöde

1. `app.js` laddar grödor och produkter via `api.js`
2. Användaren fyller i formulär (`forms.js`)
3. `balance.js` beräknar näringsbehov baserat på gröda, förfrukt, markkartering
4. API-anrop till `/api/recommend`
5. Resultat visas, kan läggas till i inköpslista (`purchase-list.js`)
6. Inköpslistan sparas i localStorage (`storage.js`)

---

## Databas

### products

```sql
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  n NUMERIC DEFAULT 0,
  p NUMERIC DEFAULT 0,
  k NUMERIC DEFAULT 0,
  s NUMERIC DEFAULT 0,
  ca NUMERIC DEFAULT 0,
  mg NUMERIC DEFAULT 0,
  price_per_ton NUMERIC NOT NULL,
  is_bulk BOOLEAN DEFAULT false,
  is_organic BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### crops

```sql
CREATE TABLE crops (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  n_need NUMERIC DEFAULT 0,
  p_need NUMERIC DEFAULT 0,
  k_need NUMERIC DEFAULT 0,
  s_need NUMERIC DEFAULT 0,
  yield_baseline NUMERIC,
  n_response NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### algorithm_config

```sql
CREATE TABLE algorithm_config (
  id SERIAL PRIMARY KEY,
  config_key TEXT UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Konfiguration

### Algoritm-parametrar

Administreras via `/admin-config.html` eller direkt i Supabase.

```json
{
  "max_products": 3,
  "tolerances": {
    "N": { "under": 5, "over": 15 },
    "P": { "under": 10, "over": 50 },
    "K": { "under": 10, "over": 50 },
    "S": { "under": 20, "over": 100 }
  },
  "prefer_bulk": true,
  "min_amount_kg": 50
}
```

---

## Utveckling

### Scripts

```bash
npm run server    # Starta utvecklingsserver med tsx
npm run build     # Kompilera TypeScript till dist/
npm run check     # Typkontroll utan kompilering
```

### Teknisk stack

- **Runtime:** Node.js
- **Språk:** TypeScript
- **Server:** Express
- **Optimering:** HiGHS (via highs-js)
- **Databas:** Supabase PostgreSQL
- **Frontend:** Vanilla JavaScript

### Lägga till ny motor

1. Skapa `src/engine/optimize-vX.ts`
2. Implementera `export async function optimizeVX(params): Promise<Solution[]>`
3. Uppdatera `recommend.ts` för att använda nya motorn

---

## Felsökning

### Server startar inte

```bash
# Kontrollera att port 3000 är ledig
lsof -i :3000

# Kontrollera miljövariabler
cat .env
```

### Inga lösningar returneras

1. Kontrollera att produkter finns: `GET /api/products`
2. Verifiera att näringsbehoven är rimliga
3. Öka toleranser i algorithm_config

### HiGHS-fel

```bash
# Verifiera att highs-js är installerat
npm ls highs
```
