# Changelog - FEST

Alla viktiga ändringar i projektet dokumenteras här.

## [2.8.4] - 2026-01-02

### 🔒 Säkerhet & Kodkvalitet

#### Säkerhetsfix
- **npm audit fix** - Åtgärdade high severity sårbarhet i `qs` (<6.14.1)

#### Strukturerad loggning (komplett)
- **Winston logger** ersätter nu alla `console.*` i:
  - `src/engine/optimize-v7.ts`
  - `src/engine/highs-pool.ts`
  - `src/engine/recommend.ts`
- Konsekvent JSON-format i produktion, färgade loggar i dev

#### ESLint & Prettier
- **eslint.config.mjs** - Modern flat config med TypeScript-stöd
- **.prettierrc** - Konsekvent kodformatering
- **Nya scripts**: `npm run lint`, `npm run lint:fix`, `npm run format`
- 0 errors, 67 warnings (mestadels `any`-typer att fixa gradvis)

#### Typförbättringar
- **AdminProduct** interface tillagt i `supabase.ts`
- **Product** returtyp för `dbProductToProduct()`, `getAllProductsForRecommendation()`
- Reducerat antal `any`-typer

#### Graceful Shutdown
- **SIGTERM/SIGINT handlers** i `start.ts`
- **HiGHS worker pool** stängs av korrekt
- **uncaughtException** loggas

#### Övriga förbättringar
- **.env.example** uppdaterad med `API_KEYS` och `M3_WEBHOOK_SECRET`
- **Version synkroniserad** till 2.8.3 i package.json och README.md

---

## [2.8.3] - 2026-01-02

### 📚 Dokumentationsuppdatering

#### OpenAPI (openapi.yaml)
- **Version uppdaterad** till 2.8.2
- **Rate Limiting** dokumenterat med alla gränser
- **Zod-validering** beskriven med exempel på felformat
- **ValidationError** och **RateLimitError** scheman tillagda
- **Näringsgränser** dokumenterade (N max 500, P max 200, etc.)

#### README.md
- **Nya funktioner v2.8** sektion tillagd
- **Filstruktur** uppdaterad med nya filer (validation.ts, logger.ts, error-handler.js)
- **Testning** sektion utökad med Playwright E2E-tester
- **Scripts** uppdaterade med test:e2e, test:e2e:ui, test:all

#### API_DOCUMENTATION.md
- **Version uppdaterad** till 2.8.2
- **Rate Limiting** sektion tillagd med headers och exempel
- **Validering & Felhantering** sektion tillagd
  - Zod-valideringsformat dokumenterat
  - Valideringsgränser tabell
  - Varningar förklarade
  - Felkoder tabell

---

## [2.8.2] - 2026-01-02

### 🛡️ Frontend Error Handler

#### Centraliserad felhantering
- **ErrorHandler** - Global felhantering för frontend
  - `public/js/error-handler.js` - Ny modul för felhantering
  - `window.onerror` och `unhandledrejection` fångas automatiskt
  - Användarvänliga felmeddelanden på svenska
  - Support för Zod-valideringsfel med `details`-array

#### Funktioner
- `ErrorHandler.handleError(error, context)` - Huvudmetod för felhantering
- `ErrorHandler.withErrorHandling(apiCall, options)` - Wrapper för API-anrop
- `ErrorHandler.showWarning(message)` - Visa varningar
- `ErrorHandler.showApiWarnings(response)` - Visa API-varningar

#### API.js förbättrad
- Alla API-metoder använder nu `ErrorHandler.withErrorHandling()`
- Automatisk visning av API-varningar (t.ex. högt näringsbehov)
- Fallback-värden vid fel (tom array för grödor/produkter)

---

## [2.8.1] - 2026-01-02

### ✅ Zod Input-validering

#### Typsäker API-validering
- **Zod-scheman** - Ersatt manuell validering med deklarativa scheman
  - `src/api/validation.ts` - Centraliserade valideringsscheman
  - `RecommendRequestSchema` - Validering av `/api/recommend`
  - `OptimizeV7RequestSchema` - Validering av `/api/optimize-v7`
  - `NutrientNeedRequestSchema` - Validering av näringsbehov
  - `M3WebhookSchema` - Validering av M3-webhook payload

#### Fördelar
- Automatisk TypeScript-typning från scheman
- Konsistenta felmeddelanden med `details`-array
- Max-/min-värden valideras (N max 500, P max 200, K max 300, S max 100)
- Refine-validering för komplexa regler (required/excluded overlap)

#### Ny middleware
- `validateBody(schema)` - Validerar request body
- `validateQuery(schema)` - Validerar query-parametrar
- `generateInputWarnings(data)` - Genererar varningar för gränsvärden

#### Ny dependency
- `zod` ^3.x

---

## [2.8.0] - 2026-01-02

### 📊 Strukturerad loggning

#### Winston Logger
- **Centraliserad loggning** - Ersatt 40+ console.log/warn/error med strukturerad logging
  - `src/utils/logger.ts` - Ny loggnings-modul med Winston
  - Färgkodade loggar i development
  - JSON-format i produktion
  - Domänspecifika metoder: `log.request()`, `log.optimize()`, `log.db()`, `log.security()`, `log.startup()`
  - Request-id stöd för spårbarhet

### 🏗️ Product-modell utökad

#### Nya fält i Product
- **isOptimizable** - `boolean` för att markera produkter som kan användas i optimering
- **active** - `boolean` för att aktivera/inaktivera produkter
- Optimeringsalgoritmen filtrerar nu på båda fälten

### 🧪 E2E-testning

#### Playwright Integration
- **12 E2E-tester** - Testar applikationen från användarens perspektiv
  - `e2e/basic.spec.ts` - Startsida, API-endpoints, admin-panel
  - `e2e/optimization-flow.spec.ts` - Optimeringsflöde och resultatvisning
  - `playwright.config.ts` - Konfiguration med automatisk serverstart

#### Nya npm-scripts
- `npm run test:e2e` - Kör E2E-tester
- `npm run test:e2e:ui` - Interaktiv testmiljö
- `npm run test:all` - Kör både unit- och E2E-tester

#### Nya dependencies
- `@playwright/test` ^1.x (dev)
- `winston` ^3.x

---

## [2.7.3] - 2026-01-02

### 🔒 Säkerhetsförbättringar

#### Rate Limiting
- **API Rate Limiting** - Skydd mot överbelastning (DoS)
  - Generell API: 100 requests/15 min per IP
  - Optimering (`/api/recommend`, `/api/optimize-v7`): 10 requests/min per IP
  - Admin (`/api/admin/*`): 30 requests/15 min per IP
  - Health-endpoint undantagen från rate limiting
  - Standard `RateLimit-*` headers inkluderade i responses

#### Säkerhetsheaders (Helmet)
- **Helmet middleware** - Automatiska säkerhetsheaders
  - `X-Content-Type-Options: nosniff` - Förhindrar MIME-sniffing
  - `X-Frame-Options: SAMEORIGIN` - Clickjacking-skydd
  - `X-XSS-Protection: 0` - Legacy XSS-filter (modern CSP istället)
  - `Strict-Transport-Security` - HSTS för HTTPS
  - `Content-Security-Policy` - CSP anpassad för Swagger UI

#### Nya dependencies
- `express-rate-limit` ^7.x
- `helmet` ^8.x

---

## [2.7.2] - 2026-01-02

### 🧪 Utökad testsvit + CI/CD

#### Ny funktionalitet
- **GitHub Actions CI** - Automatiserad testkörning vid push/PR
  - Workflow: `.github/workflows/test.yml`
  - Körs på `ubuntu-latest` med Node.js 20
  - Coverage-rapport sparas som artifact

- **M3 Webhook-tester** - 7 nya tester för `/api/webhook/m3-product`
  - Autentisering (saknad/ogiltig secret)
  - Validering (saknad itemNumber, inga uppdateringar)
  - Framgångsfall (pris, active-status, kombinerad)

#### Teststatistik
- **38 tester totalt** (12 motor + 26 API)
- Testtid: ~7.5 sekunder

---

## [2.7.1] - 2026-01-01

### 🧪 Automatiserat testramverk

#### Ny funktionalitet
- **Vitest testramverk** - Komplett testsvit för kvalitetssäkring
  - 31 tester totalt (12 motor + 19 API)
  - Täckningsrapportering med v8 coverage

#### Teststruktur
- `src/__tests__/engine/optimize-v7.test.ts` - MILP-motor tester
  - Multi-näringslösning (N, P, K, S)
  - Enskilda näringsämnen
  - N-toleranseskalering
  - PKS-krav och constraints
  - Kantfall (tomt behov, negativa värden)
  
- `src/__tests__/api/server.test.ts` - API integrationstester
  - Hälsokontroll (/health)
  - Gröddata (/api/crops)
  - Rekommendationer (/api/recommend)
  - Behovsberäkning (/api/calculate-need)
  - API-nyckel autentisering

#### Nya scripts
```bash
npm test              # Kör alla tester
npm run test:watch    # Tester i watch-läge
npm run test:coverage # Täckningsrapport
```

#### Nya devDependencies
- `vitest` ^4.0.16
- `@vitest/coverage-v8` ^4.0.16
- `supertest` ^7.1.4
- `@types/supertest` ^6.0.3

---

## [2.7.0] - 2026-01-01

### 🔒 Tvingade produkter (Required Products)

#### Ny funktionalitet
- **`requiredProductIds`** - Ny parameter i `/api/recommend` för att tvinga in specifika produkter i lösningen
  - Produkter som anges MÅSTE inkluderas i alla lösningar
  - Optimeraren hittar bästa kompletterande produkter för att täcka resterande behov
  - Användbart för:
    - Befintligt lager som måste användas
    - Leverantörsavtal med specifika produkter
    - Kundpreferenser för vissa gödselsorter

#### Valideringsregler
- `requiredProductIds` och `excludedProductIds` får inte överlappa (400-fel)
- Antal tvingade produkter får inte överstiga `maxProducts` (400-fel)
- Varning loggas om tvingad produkt inte finns bland tillgängliga produkter

#### Teknisk implementation
- LP-constraint `y[i] = 1` läggs till för tvingade produkter i MILP-modellen
- Constraint propageras genom alla strategier (prispall)

#### Dokumentation
- Uppdaterad `openapi.yaml` och `openapi-internal.yaml`
- Uppdaterad `docs/API_DOCUMENTATION.md`
- Uppdaterad `docs/API_EXTERNAL.md`

#### Exempel
```bash
curl -X POST "http://localhost:3000/api/recommend" \
  -H "Content-Type: application/json" \
  -d '{
    "need": {"N": 150, "P": 25, "K": 40, "S": 15},
    "requiredNutrients": ["N", "P", "K", "S"],
    "maxProducts": 3,
    "requiredProductIds": ["prod-301234"]
  }'
```

---

## [2.6.0] - 2025-12-30

### 🔗 M3 CE ERP-integration

#### Ny funktionalitet
- **M3 Webhook** - Endpoint för att ta emot produktuppdateringar från M3 CE ERP-system
  - `POST /api/webhook/m3-product` - Uppdatera pris och/eller active-status
  - Matchar på artikelnummer
  - Autentisering via `X-Webhook-Secret` header
- **Produkters active-status** - Ny `active` boolean-kolumn i databasen
  - Inaktiva produkter exkluderas automatiskt från rekommendationer
  - Default: `true` för alla befintliga produkter

#### Admin-gränssnitt
- **Status-kolumn** i produkttabellen med färgkodade badges
  - ✅ Grön badge för aktiva produkter
  - ❌ Röd badge för inaktiva produkter
- **Inaktiva produkter** visas med dämpad opacitet (60%)
- **Status-fält** i formulär för lägg till/redigera produkt
- **Statistik-kort** visar nu aktiva/inaktiva produkter

#### Dokumentation
- `docs/M3_WEBHOOK_INTEGRATION.md` - Komplett webhook-specifikation för M3-integration
- Inkluderar curl-exempel, felkoder och säkerhetsinformation

#### Nya miljövariabler
- `M3_WEBHOOK_SECRET` - Hemlig nyckel för webhook-autentisering

---

## [2.5.0] - 2025-12-30

### 🔐 API-säkerhet och extern åtkomst

#### Ny funktionalitet
- **API-nyckel-autentisering** - Externa partners kan använda API:et med `X-API-Key` header
- **Swagger UI** - Interaktiv API-dokumentation på `/api-docs` (extern) och `/api-docs-internal` (intern)
- **OpenAPI 3.0-specifikationer** - `openapi.yaml` (extern) och `openapi-internal.yaml` (intern)
- **Extern API-dokumentation** - `API_EXTERNAL.md` för partners

#### Säkerhetsförbättringar
- Alla admin-endpoints kräver nu `X-Admin-Password` header
- Interna optimerings-endpoints (`/api/optimize-v*`) blockerade för externa API-anrop
- Externa endpoints: `/api/recommend`, `/api/products`, `/api/crops`, `/api/calculate-need`

#### Nya filer
- `API_DOCUMENTATION.md` - Intern API-referens
- `API_EXTERNAL.md` - Partner-dokumentation
- `API_CROSSREF_REPORT.md` - Korsreferens kod ↔ dokumentation
- `openapi.yaml` - Extern OpenAPI-spec (5 endpoints)
- `openapi-internal.yaml` - Intern OpenAPI-spec (alla endpoints)

#### Miljövariabler
- `API_KEYS` - Kommaseparerad lista med giltiga API-nycklar
- `ADMIN_PASSWORD` - Lösenord för admin-endpoints

---

## [2.4.1] - 2025-12-29

### 🧹 Kodstädning och dokumentationsförenkling

#### Borttagna filer
- **docs/OPTIMIZE-V5-DEPENDENCIES.md** - Föråldrat tekniskt dokument
- **scripts/test-v7.ts** - Utvecklingstestskript (kan köras med `npx tsx` vid behov)
- **PRODUCT_ANALYSIS.md** - Feature-dokumentation (information finns i kod)

#### Förenklade filer
- **README.md** - Helt omskriven, fokuserad och aktuell (från 594 → ~150 rader)
- **ARCHITECTURE.md** - Omskriven med aktuell information
- **src/models/Tolerances.ts** - Borttagna oanvända konstanter (ECONOMIC_TOLERANCES, OPTIMIZED_TOLERANCES)

#### Borttagna endpoints
- **GET /api/strategies** - Oanvänd endpoint med föråldrad strategi-info

#### Tekniskt
- TypeScript kompilerar utan fel ✅
- Inga brytande ändringar

---

## [2.4.0] - 2025-12-27

### 🚀 Ny MILP-baserad optimeringsmotor (v5)

#### Ny optimeringslogik
- **ILP-solver**: Använder `javascript-lp-solver` för äkta heltalsoptimering
- **Globalt optimum**: Minimerar produktkostnad (SEK/ha) med matematisk garanti
- **Heltalsdoser**: Alla givor är exakta heltal (kg/ha)
- **Prispall**: Returnerar upp till 3 olika strategier (produktmixar)

#### Constraints (exakt enligt spec)
- **N**: MÅSTE nå target, max +1 kg/ha över (aldrig under)
- **P/K/S (om ikryssade)**: 85%-125% av target
- **Dos per produkt**: minDose-maxDose (default 100-600 kg/ha)
- **Max antal produkter**: 1-5 (autoökning vid infeasible)

#### Nytt API-endpoint
```
POST /api/optimize-v5
Body: {
  targets: { N: 150, P: 20, K: 50, S: 15 },
  mustFlags: { mustP: true, mustK: false, mustS: true },
  maxProducts: 2,
  minDose: 100,
  maxDose: 600
}
```

#### Returformat
```json
{
  "status": "ok",
  "usedMaxProducts": 2,
  "strategies": [
    {
      "rank": 1,
      "totalCostSekHa": 3220.08,
      "products": [...],
      "achieved": { "N": 150, "P": 17.08, "K": 29.28, "S": 16.8 },
      "percentOfTarget": { "N": 100, "P": 85.4, "K": 58.6, "S": 112 },
      "warnings": []
    }
  ]
}
```

#### Numerisk stabilitet
- Näringshalter skalas till tiondelsprocent (heltal)
- Priser skalas till öre (heltal)
- Alla constraints är heltal → inga flyttalsproblem

#### Nya filer
- `src/engine/optimize-v5.ts` - MILP-optimeringsmotor
- `src/types/javascript-lp-solver.d.ts` - TypeScript-typer för solver

#### Uppdaterade filer
- `src/engine/recommend.ts` - Integrerar V5-motor (legacy). *Runtime är numera låst till V7*.
- `src/api/server.ts` - Nytt endpoint `/api/optimize-v5`
- `package.json` - Ny dependency `javascript-lp-solver`

---

## [2.3.0] - 2025-12-27

### 🗄️ All data nu i Supabase - ingen hårdkodad data

#### Nya funktioner
- **Grödor i databas**: Alla 20 grödor nu i Supabase `crops`-tabell
- **Förfruktsvärden integrerade**: N-effekt och skördeeffekt direkt på varje gröda
- **API `/api/crops`**: Ny endpoint med kategorifilter (`?category=spannmal`)
- **API `/api/calculate-need`**: Stödjer nu `precropId` för förfruktsberäkning
- **Cache**: 5 minuters cache för grödor från Supabase
- **Ingen fallback**: Tydliga felmeddelanden om databas ej tillgänglig

#### Grödor med förfruktseffekt (N kg/ha)
| Gröda | N-effekt |
|-------|----------|
| Blandvall (slåtter) | +40 |
| Höstoljeväxter (raps) | +40 |
| Foderärter | +35 |
| Åkerböna | +25 |
| Sockerbetor | +25 |
| Våroljeväxter | +20 |
| Potatis | +10 |
| Gräsvall (slåtter) | +5 |

#### Borttagna filer (3 st, ~600 rader hårdkodad data)
- `src/data/products.ts` (516 rader) - Alla produkter från Supabase
- `src/data/precrop-values.ts` - Ersatt av `crops.precrop_n_effect` i databas
- `public/js/precrop-values.js` - Förfruktsvärde läses nu från crop-objekt

#### Tekniska förbättringar
- `supabase.ts`: Nya funktioner `getAllCrops()`, `getCropById()`, `getCropsByCategory()`
- `crops.ts`: Endast typer och beräkningsfunktioner (ingen data)
- `balance.js`: Läser precropEffect från crop-objekt istället för separat fil

#### Datastruktur
| Källa | Tabell | Antal |
|-------|--------|-------|
| Supabase | `Produkter` | 90+ produkter |
| Supabase | `crops` | 20 grödor |

#### Städning
- Borttagen `dist/` med gammal build (refererade borttagna filer)
- Borttagen `server.log` (loggfil)
- Rensat `package.json`: borttagna `main`, `dev`, `start` (oanvända scripts)

---

## [2.2.1] - 2025-12-26

### 🧹 Dokumentationsrensning

#### Borttagna filer (15 filer, ~3,300 rader)

**Oanvända kodfiler:**
- `public/admin-new.html` (570 rader) - Aldrig refererad, duplicate

**Gamla cleanup-loggar (inte längre relevanta):**
- `CLEANUP_ANALYSIS.md` (252 rader)
- `CLEANUP_REPORT.md` (256 rader)
- `CLEANUP_SUMMARY.md` (231 rader)
- `DEEP_ANALYSIS_ROUND2.md` (408 rader)
- `DEEP_CLEANUP_FINAL.md` (355 rader)
- `PASSWORD_FIX.md` (260 rader)

**Konsoliderade dokument:**
- `ADMIN_GUIDE.md` → SECURITY.md
- `ADMIN_SETUP.md` → README.md
- `ACCESS_CONTROL.md` → SECURITY.md
- `QUICK_START.md` → README.md
- `SUPABASE_SECURITY.md` → SECURITY.md
- `PRODUCT_ANALYSIS_QUICKSTART.md` → PRODUCT_ANALYSIS.md
- `PRODUCT_ANALYSIS_SUMMARY.md` → PRODUCT_ANALYSIS.md

#### Ny dokumentationsstruktur (5 filer)
- `README.md` - Översikt, installation, API-dokumentation
- `ARCHITECTURE.md` - Frontend-arkitektur
- `CHANGELOG.md` - Versionshistorik
- `PRODUCT_ANALYSIS.md` - Produktanalys-verktyget
- `SECURITY.md` - All säkerhetsdokumentation (konsoliderad)

---

## [2.2.0] - 2024-12-26

### 🎉 Ny Feature: Produktanalys-verktyg

#### Översikt
Nytt admin-verktyg för att analysera produktpriser och näringskostnader. Hjälper produktansvariga att förstå vad som driver prisoptimeringen i FEST:s rekommendationer.

#### Tillagda filer
- **Backend API:**
  - `src/api/server.ts` - Ny endpoint: `GET /api/admin/product-analysis` (+104 rader)
- **Frontend:**
  - `public/analysis.html` - Komplett analysverktyg (477 rader)
  - `public/js/analysis.js` - Datahantering och UI-logik (335 rader)
  - `public/admin.html` - Uppdaterad med navigationslänk till analysen

#### Funktioner
- **Näringskostnadsberäkning:**
  - Beräknar kr/kg för varje näringsämne (N, P, K, S) per produkt
  - Formel: `costPerNutrient = pricePerKg / (nutrientPercent / 100)`
  
- **Visualisering:**
  - Färgkodad tabell (Grön = billig, Orange = medel, Röd = dyr)
  - Sorterbar tabell (klicka på kolumnrubriker)
  - Statistiköversikt (antal produkter, genomsnittspris)
  
- **Billigaste källor:**
  - Top 5 billigaste produkter för varje näringsämne
  - Ranking med detaljerad kostnadsinformation
  - Jämförelsevyer per näringsämne

#### Användning
1. Logga in på admin-panelen (`/admin.html`)
2. Klicka på "📊 Produktanalys"
3. Utforska data via två flikar:
   - **Alla produkter** - Fullständig tabell med sortering
   - **Billigaste källor** - Top 5 för N, P, K, S

#### Teknisk implementation
- Backend: Express endpoint med admin-autentisering
- Databearbetning: Realtidsberäkning av näringskostnader
- Frontend: Vanilla JavaScript med dynamisk färgkodning
- Security: Kräver admin-lösenord (sessionStorage)

#### Verifiering
- ✅ TypeScript-kompilering: SUCCESS
- ✅ Server startar utan fel
- ✅ API returnerar korrekt data
- ✅ UI responsiv och funktionell
- ✅ Autentisering fungerar
- ✅ Zero breaking changes

#### Dokumentation
- `PRODUCT_ANALYSIS_FEATURE.md` - Komplett funktionsdokumentation

---

## [2.1.2] - 2024-12-26

### 🧹 Deep Cleanup - Round 2 (Function-Level Analysis)

#### Additional Dead Code Removed (2 files, 2 functions, ~281 lines)
- **Deleted unused TypeScript files:**
  - `src/index.ts` (175 lines) - CLI test file never used in production
  - `src/engine/math.ts` (83 lines) - Utility functions not imported by optimize-v4
- **Removed unused exports:**
  - `Solution.installationInstructions()` (8 lines) - Never called anywhere
  - `crops.getCropsByCategory()` (15 lines) - Exported but never imported

#### Analysis Details
- Performed deep function-level analysis of all exports
- Verified import chains for every active function
- Confirmed optimize-v4.ts has inline implementations (doesn't need math.ts)
- index.ts was development/testing code, start.ts is production entry point

#### Results
- TypeScript files: 16 → 14 (-2 files, -33% from original)
- Engine files: 4 → 3 (-1 file, -63% from original 8)
- Total dead code removed (both rounds): ~1,758 lines
- Clean compilation verified ✅
- Zero breaking changes ✅

#### Documentation
- Created `DEEP_ANALYSIS_ROUND2.md` - Detailed function-level analysis
- Created `DEEP_CLEANUP_FINAL.md` - Complete summary of both cleanup rounds

**Result:** Codebase now has ZERO dead code. Crystal-clear architecture with only active files.

## [2.1.1] - 2025-12-26

### 🧹 Code Cleanup - Removed Dead Code

#### Deleted Unused Files (5 files, ~1,477 lines)
- **Removed old engine optimization files:**
  - `src/engine/optimize-v2.ts` (744 lines) - Replaced by optimize-v4
  - `src/engine/optimize-v3.ts` (623 lines) - Experimental, never used
  - `src/engine/recommend-clean.ts` (80 lines) - Deprecated wrapper
  - `src/engine/scoring-minimal.ts` (12 lines) - Redundant type definition
- **Removed unused frontend file:**
  - `public/js/admin-config.js` (18 lines) - Never referenced

#### Code Quality Improvements
- Updated outdated comments in `recommend.ts`
- Clarified that **optimize-v4.ts** is the active algorithm
- Verified clean TypeScript compilation
- Zero breaking changes

#### Documentation
- Created `CLEANUP_ANALYSIS.md` - Detailed analysis of dead code
- Created `CLEANUP_REPORT.md` - Complete cleanup summary

**Result:** Cleaner codebase, faster compilation, reduced confusion about which optimizer is active.

## [2.1.0] - 2025-12-21

### 🏗️ Arkitektur - Modulär Frontend (SENASTE)

#### Migration till JavaScript-moduler
- **Skapade `public/js/` med 7 moduler (547 rader total)**
  - `state.js` - Global state management (AppState)
  - `storage.js` - localStorage wrapper
  - `api.js` - Backend API-kommunikation
  - `utils.js` - Formatering och helpers
  - `tabs.js` - Tab-navigering
  - `purchase-list.js` - Inköpslista-logik
  - `app.js` - Auto-initiering
- **Reducerade `index.html` från 2227 → 1250 rader**
  - Tog bort 1000+ rader inline JavaScript
  - Behöll endast HTML, CSS och minimal konfiguration
- **Frontend matchar nu backend-struktur**
  - Samma modularitet som `src/engine/`
  - Separation of concerns, testbarhet, underhållbarhet
- **Dokumentation**
  - `public/js/README.md` - Fullständig modulöversikt
  - `MIGRATION-GUIDE.md` - Migrationshistorik

### ✨ Nya Funktioner

#### Inköpslista/Shopping List
- Ny flik "Inköpslista" med badge-räknare
- Lägg till flera lösningar i en gemensam lista
- Produktsammanställning som summerar samma produkter
- Redigerbar hektar per lösning med realtidsuppdatering
- Totaler i ton med tusentalsavskiljare
- Toast-notifikationer vid sparning
- **Persistent lagring med localStorage** - listan sparas automatiskt
- Ta bort enskilda items från listan

#### Växtnäringsbalans Toggle
- Växla mellan "🌾 Förfrukt" och "📊 Växtnäringsbalans"
- Förfrukt-läge: Beräkna från föregående gröda
- Balans-läge: Direkt inmatning från jordprov
- Toggle-knapp med ikoner högerställd vid rubrik

#### Förbättrad Balansberäkning
- Tar hänsyn till förfruktsvärde (ärter +30 kg N/ha, etc.)
- Visuell feedback med grön info-box
- Automatisk justering av näringsbehov baserat på balans
- Stöd för förfrukt med negativa N-värden (extrabehov)

#### Formatering & UX
- `formatNumber()`: Tusentalsavskiljare (1234567 → "1 234 567")
- `formatWeight()`: Automatisk ton/kg-konvertering med 2 decimaler
- Smooth animations och transitions
- Förbättrad visuell hierarki

#### Resultathantering
- 4 sorteringslägen: optimal, cheapest, balanced, fewest
- Sortering utan ny API-call (client-side)
- Visa topp 5 resultat (topp 3 med medaljer)

### 🔧 Backend-förbättringar

#### Toleranser (Stora förändringar!)
**Ekonomisk strategi:**
- N och default: 0% till 999% (måste uppnås, kan övergödslas)

**Optimerad strategi (Kraftigt utökad):**
- N: -5% till +15% (från -5% till +10%)
- P: -20% till +50% (från -15% till +25%)
- K: -20% till +150% (från -15% till +25%)
- S: -25% till +150% (från -20% till +30%)

**Anledning:** Kombigödsel innehåller ofta överskott av K och S. Gamla toleranser var orealistiskt snäva.

#### Filter-logik (Totalomskriven!)
- **Ekonomisk:** Bara ikryssade näringsämnen måste vara ≥0%
- **Optimerad:** ALLA näringsämnen måste vara inom tolerans
- Tydlig separation mellan strategier
- Utförlig dokumentation i koden

#### Scoring (Uppdaterad)
- **Ekonomisk:** `cost × 0.95 + penalty × 0.05` (95% kostnadsfokus)
- **Optimerad:** `cost × 0.1 + penalty × 0.9` (90% precisionsfokus)
- Kväve (N) får 3x högre vikt i penalty-beräkning

#### Kapacitet
- Max kg/ha ökad från 1200 till **3000**
- Hanterar höga skördar (t.ex. HV 12 ton)
- DEFAULT_MAX_KG uppdaterad i generate.ts och recommend.ts

### 🐛 Buggfixar

1. **"Hittar inget på HV 12 ton"**
   - Problem: Optimerad strategi hittade 0 lösningar för höga skördar
   - Fix: Utökade toleranser för K och S till 150%

2. **Ekonomisk strategi hittar inga lösningar med 4 näringsämnen**
   - Problem: För snäva toleranser
   - Fix: Ekonomisk tillåter nu 0-999% för ikryssade näringsämnen

3. **Emoji-ikoner visas som �**
   - Problem: Character encoding issue
   - Fix: Använd HTML entities (&#128203;) istället för direkta emojis

4. **Inköpslista i fel position**
   - Problem: Visades i resultat-sektionen
   - Fix: Egen dedikerad tab med separat innehåll

### 📝 Dokumentation

- README.md fullständigt uppdaterad
- Alla nya funktioner dokumenterade
- API-endpoints korrekt dokumenterade
- Strategier och toleranser förklarade
- Användningsexempel för alla lägen
- Denna CHANGELOG.md skapad

### 🔄 Teknisk skuld (Kvar att göra)

- [ ] Refaktorera index.html (2226 rader - flytta JS till separat fil)
- [ ] Skapa modulstruktur för frontend
- [ ] Generalisera dubblerad kod (enkel vs avancerad)
- [ ] Lägg till enhetstester för engine
- [ ] Överväg state management istället för globala variabler

## [2.0.0] - 2025-12-15 (Före datorkrasch)

### Initial version med grundfunktionalitet
- Grundläggande rekommendationssystem
- Enkel och avancerad flik
- Traktor-animation med spreader
- Backend med TypeScript
- Express API
- Produktdatabas
- Grödor och näringsbehov

---

**Format:** [Semantic Versioning](https://semver.org/)
- MAJOR: Breaking changes
- MINOR: Nya funktioner (bakåtkompatibla)
- PATCH: Buggfixar (bakåtkompatibla)
