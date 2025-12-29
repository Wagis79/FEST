# FEST - Arkitektur

## Översikt

FEST (Fertilizer Expert System Tool) är en webbaserad applikation för gödselrekommendationer. 
Systemet består av en Express/TypeScript backend med MILP-optimering och en modulär vanilla JavaScript frontend.

## Backend-struktur

### API (`src/api/`)
- **server.ts** - Express routes och endpoints (1150+ rader)
- **start.ts** - Serverstart
- **supabase.ts** - Databas-helpers för produkter, grödor och konfiguration

### Optimeringsmotorer (`src/engine/`)
- **optimize-v7.ts** - ⭐ Produktionsmotor (HiGHS MILP/ILP)
- **optimize-v6.ts** - Legacy: HiGHS-baserad
- **optimize-v5.ts** - Legacy: javascript-lp-solver
- **optimize-v4.ts** - Legacy: kombinatorisk grid-search
- **recommend.ts** - API-adapter som anropar V7
- **scoring.ts** - Strategy-typer

### Modeller (`src/models/`)
- **Product.ts** - Produkt med näringsinnehåll
- **NutrientNeed.ts** - Näringsbehov (N/P/K/S kg/ha)
- **Solution.ts** - Lösning med produktallokering
- **Tolerances.ts** - Tolerans-typer (legacy, V7 använder databas)

### Data (`src/data/`)
- **crops.ts** - Gröda-typer och beräkningsfunktioner

## Frontend-struktur

### Modulär JavaScript (`public/js/`)

```
Foundation
├── state.js          # Global AppState
└── utils.js          # Formatering

Services
├── storage.js        # localStorage
└── api.js            # Backend-kommunikation

UI Components
├── tabs.js           # Fliknavigering
├── balance.js        # Näringsbalans
├── forms.js          # Formulär & resultat
└── purchase-list.js  # Inköpslista

Admin
├── admin.js          # Produktadmin
├── admin-crops.js    # Gröda-admin
└── analysis.js       # Produktanalys

Bootstrap
└── app.js            # Applikationsstart
```

### HTML-sidor
- **index.html** - Huvudgränssnitt
- **admin.html** - Admin-inloggning
- **admin-products.html** - Produkthantering
- **admin-crops.html** - Gröda-hantering
- **admin-config.html** - Algoritmkonfiguration
- **analysis.html** - Produktanalys

## Dataflöde

```
Browser (forms.js)
    │
    ▼ POST /api/recommend
Server (server.ts)
    │
    ├─► getProductsForRecommendation() → Supabase
    ├─► getAlgorithmConfigMap() → Supabase
    │
    ▼
recommend.ts
    │
    ▼
optimize-v7.ts (HiGHS MILP)
    │
    ▼ Solution[]
Browser (forms.js → displayResults)
```

## Databas (Supabase)

### Tabeller
- **Produkter** - Gödselprodukter med näringsinnehåll
- **crops** - Grödor med behov per ton
- **algorithm_config** - Konfigureringsparametrar

## Designprinciper

- **Single Responsibility**: Varje modul har ett syfte
- **No Circular Dependencies**: Tydlig hierarki
- **Server-side Credentials**: API-nycklar aldrig i frontend
- **Cached Data**: Grödor och config cachas i minnet

## Status

**Produktionsredo** ✅  
**Motor**: V7 (HiGHS MILP)  
**Frontend**: 10 JavaScript-moduler (~1,500 rader)  
**Backend**: 12 TypeScript-filer (~4,000 rader)
