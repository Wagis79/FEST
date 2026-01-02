# FEST API Documentation

**Version:** 2.8.2  
**Produktion:** `https://fest-production-d1bb.up.railway.app`  
**Lokal utveckling:** `http://localhost:3000`  
**Content-Type:** `application/json`

---

## Översikt

FEST API är ett REST API för optimering av gödselblandningar. API:et tar emot näringsbehov och returnerar kostnadsoptimerade produktkombinationer baserat på MILP-optimering (Mixed Integer Linear Programming).

### Funktioner

- 🎯 **Behovsbaserad optimering** - Skicka in näringsbehov (N, P, K, S) och få optimerade produktförslag
- 💰 **Kostnadsminimering** - Hittar den billigaste produktkombinationen som täcker behoven
- 🌾 **Grödobaserad beräkning** - Beräkna näringsbehov från gröda och förväntad skörd
- 📊 **Flera lösningar** - Returnerar flera alternativa lösningar för jämförelse

### Nya funktioner v2.8

- 🔒 **Rate Limiting** - Skydd mot överbelastning (100 req/15 min, optimering 10 req/min)
- ✅ **Zod-validering** - Typsäker validering med detaljerade felmeddelanden
- 📊 **Strukturerad loggning** - Winston-baserad loggning
- ⚠️ **Varningar** - API:et returnerar varningar för potentiellt problematisk input

---

## Rate Limiting

API:et har följande begränsningar:

| Endpoint | Gräns | Period |
|----------|-------|--------|
| Generell API | 100 requests | 15 minuter |
| Optimering (`/api/recommend`) | 10 requests | 1 minut |
| Admin (`/api/admin/*`) | 30 requests | 15 minuter |

**Rate limit-headers i svar:**
```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 1704196800
```

**Vid överskriden gräns (429):**
```json
{
  "success": false,
  "error": "För många förfrågningar. Försök igen om 60 sekunder."
}
```

---

## Autentisering

### API-nyckel (för externa applikationer)

Externa applikationer har tillgång till läs- och optimeringsendpoints. Inga skrivoperationer är tillgängliga externt.

**Request med API-nyckel:**
```bash
curl -X POST "https://your-server.com/api/recommend" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: din-api-nyckel-här" \
  -d '{"need": {"N": 150, "P": 25, "K": 40, "S": 15}}'
```

**Tillgängliga endpoints för externa API-nycklar:**

| Endpoint | Metod | Tillgång | Beskrivning |
|----------|-------|----------|-------------|
| `/health` | GET | ✅ Öppen | Health check (ingen nyckel krävs) |
| `/api/recommend` | POST | ✅ Extern | Gödselrekommendationer |
| `/api/products` | GET | ✅ Extern | Hämta produkter |
| `/api/crops` | GET | ✅ Extern | Hämta grödor |
| `/api/calculate-need` | POST | ✅ Extern | Beräkna näringsbehov |
| `/api/optimize-v7` | POST | ❌ Intern | Blockerad för externa anrop |
| `/api/admin/*` | * | ❌ Admin | Kräver admin-lösenord |

**Felkoder vid autentisering:**

| HTTP Status | Kod | Beskrivning |
|-------------|-----|-------------|
| 401 | `MISSING_API_KEY` | API-nyckel saknas i headern |
| 403 | `INVALID_API_KEY` | API-nyckeln är ogiltig |
| 403 | `ENDPOINT_NOT_AVAILABLE` | Endpointen är inte tillgänglig för externa anrop |

**Felsvar exempel:**
```json
{
  "success": false,
  "error": "Denna endpoint är inte tillgänglig för externa API-anrop",
  "code": "ENDPOINT_NOT_AVAILABLE"
}
```

### Erhålla API-nyckel

Kontakta API-administratören för att erhålla en API-nyckel för din applikation.

> 📖 **För extern dokumentation:** Se `API_EXTERNAL.md` för en enklare guide anpassad för externa partners.

### Admin-lösenord (för administration)

**Admin endpoints** (`/api/admin/*`) kräver separat header:
```
X-Admin-Password: <password>
```

Dessa endpoints används för att hantera produkter, grödor och konfigurationer i databasen.

> 💡 **Lokalt utvecklingsläge:** Om inga API-nycklar är konfigurerade på servern (miljövariabeln `API_KEYS` saknas) är API:et öppet för alla anrop (för enklare utveckling).

---

## Swagger/OpenAPI

Interaktiv API-dokumentation finns på:
```
https://your-server.com/api-docs
```

OpenAPI-specifikation (YAML) för automatisk klientgenerering finns i projektets rot som `openapi.yaml`.

---

## Validering & Felhantering

### Zod-validering

Alla API-requests valideras med Zod-scheman. Vid valideringsfel returneras HTTP 400 med detaljerad felinformation:

```json
{
  "success": false,
  "error": "Valideringsfel",
  "details": [
    {
      "field": "need.N",
      "message": "Number must be at most 500",
      "code": "too_big"
    },
    {
      "field": "strategy",
      "message": "Invalid enum value. Expected 'economic' | 'optimized'",
      "code": "invalid_enum_value"
    }
  ]
}
```

### Valideringsgränser

| Fält | Min | Max | Beskrivning |
|------|-----|-----|-------------|
| `need.N` | 0 | 500 | Kvävebehov (kg/ha) |
| `need.P` | 0 | 200 | Fosforbehov (kg/ha) |
| `need.K` | 0 | 300 | Kaliumbehov (kg/ha) |
| `need.S` | 0 | 100 | Svavelbehov (kg/ha) |
| `maxProducts` | 1 | 5 | Max antal produkter |
| `topN` | 1 | 50 | Max antal lösningar |

### Varningar

API:et returnerar varningar för potentiellt problematisk input (utan att avbryta requesten):

```json
{
  "success": true,
  "warnings": [
    "Högt N-behov (450 kg/ha). Risk för längre beräkningstid.",
    "Alla produktslots är tvingade (3/3). Optimeraren har ingen flexibilitet."
  ],
  "solutions": [...]
}
```

### Felkoder

| HTTP | Kod | Beskrivning |
|------|-----|-------------|
| 400 | `Valideringsfel` | Zod-validering misslyckades |
| 401 | `MISSING_API_KEY` | API-nyckel saknas |
| 403 | `INVALID_API_KEY` | Ogiltig API-nyckel |
| 403 | `ENDPOINT_NOT_AVAILABLE` | Endpoint ej tillgänglig externt |
| 429 | - | Rate limit överskriden |
| 500 | - | Internt serverfel |

---

## Endpoints

### Health Check

```
GET /health
```

Kontrollerar att servern är igång.

**Response:**
```json
{
  "success": true,
  "status": "OK",
  "timestamp": "2025-12-30T10:00:00.000Z"
}
```

---

## Optimering & Rekommendationer

### POST /api/recommend

**Huvudendpoint för gödseloptimering.** Returnerar kostnadsoptimerade produktkombinationer.

#### Request

```http
POST /api/recommend
Content-Type: application/json

{
  "need": {
    "N": 150,
    "P": 25,
    "K": 40,
    "S": 15
  },
  "requiredNutrients": ["N", "P", "K", "S"],
  "maxProducts": 3,
  "topN": 5,
  "strategy": "economic",
  "excludedProductIds": ["prod-12345"],
  "requiredProductIds": ["prod-301234"]
}
```

#### Request Parameters

| Parameter | Typ | Obligatorisk | Beskrivning |
|-----------|-----|--------------|-------------|
| `need` | object | ✅ Ja | Näringsbehov i kg/ha |
| `need.N` | number | Nej | Kvävebehov (kg/ha) |
| `need.P` | number | Nej | Fosforbehov (kg/ha) |
| `need.K` | number | Nej | Kaliumbehov (kg/ha) |
| `need.S` | number | Nej | Svavelbehov (kg/ha) |
| `requiredNutrients` | array | Nej | Näringsämnen som MÅSTE täckas. Värden: `"N"`, `"P"`, `"K"`, `"S"` |
| `maxProducts` | number | Nej | Max antal produkter i lösningen (1-5). Default: 3 |
| `topN` | number | Nej | Antal lösningar att returnera. Default: 10 |
| `strategy` | string | Nej | Optimeringsstrategi: `"economic"` (billigast) eller `"optimized"` (precision). Default: `"economic"` |
| `excludedProductIds` | array | Nej | Lista med produkt-ID:n att exkludera från optimeringen |
| `requiredProductIds` | array | Nej | Lista med produkt-ID:n som MÅSTE inkluderas i lösningen |

> **Obs:** `requiredProductIds` och `excludedProductIds` får inte överlappa. Antal tvingade produkter får inte överstiga `maxProducts`.

#### Rekommenderade gränsvärden

Baserat på omfattande testning rekommenderas följande gränsvärden för optimal prestanda:

| Parameter | Minimum | Maximum | Rekommenderat | Kommentar |
|-----------|---------|---------|---------------|-----------|
| **Totalt näringsbehov** | 20 kg/ha | 600 kg/ha | 50-400 kg/ha | Under 20 kg/ha ger ofta inga lösningar |
| **N (kväve)** | 10 kg/ha | 400 kg/ha | 50-300 kg/ha | Över 400 kan ge minnesfel |
| **P (fosfor)** | 5 kg/ha | 100 kg/ha | 10-60 kg/ha | |
| **K (kalium)** | 5 kg/ha | 150 kg/ha | 20-100 kg/ha | |
| **S (svavel)** | 5 kg/ha | 60 kg/ha | 10-40 kg/ha | |
| **maxProducts** | 1 | 5 | 2-4 | |
| **requiredProductIds** | 0 | maxProducts | maxProducts - 1 | Lämna minst 1 slot för optimeraren |
| **excludedProductIds** | 0 | ∞ | Max 15 | Många exkluderade begränsar lösningar |

#### Varningar i respons

API:et returnerar automatiskt varningar om parametrarna närmar sig gränserna:

```json
{
  "success": true,
  "count": 3,
  "warnings": [
    "Lågt totalt näringsbehov (18 kg/ha). Rekommendation: minst 20 kg/ha.",
    "Alla produktslots är tvingade (3/3). Optimeraren har ingen flexibilitet."
  ],
  "limits": {
    "maxProducts": { "min": 1, "max": 5, "recommended": 3 },
    "requiredProductIds": { "max": 3, "recommended": 2 },
    "totalNeed": { "min": 20, "max": 600, "unit": "kg/ha" },
    "nitrogen": { "max": 400, "unit": "kg/ha" }
  },
  "solutions": [...]
}
```

#### Response

```json
{
  "success": true,
  "count": 5,
  "need": {
    "N": 150,
    "P": 25,
    "K": 40,
    "S": 15
  },
  "strategy": "economic",
  "requiredNutrients": ["N", "P", "K", "S"],
  "solutions": [
    {
      "products": [
        {
          "productId": "prod-301234",
          "name": "NS 27-4",
          "kgPerHa": 450
        },
        {
          "productId": "prod-301567",
          "name": "PK 11-21",
          "kgPerHa": 180
        }
      ],
      "supplied": {
        "N": 152.1,
        "P": 26.8,
        "K": 41.2,
        "S": 16.5
      },
      "deviation": {
        "N": { "kg": 2.1, "pct": 1.4 },
        "P": { "kg": 1.8, "pct": 7.2 },
        "K": { "kg": 1.2, "pct": 3.0 },
        "S": { "kg": 1.5, "pct": 10.0 }
      },
      "costPerHa": 2850.50,
      "score": 0.85,
      "notes": []
    }
  ]
}
```

#### Response Fields

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `success` | boolean | `true` om anropet lyckades |
| `count` | number | Antal returnerade lösningar |
| `need` | object | Det inskickade näringsbehovet |
| `strategy` | string | Använd strategi |
| `requiredNutrients` | array | Näringsämnen som krävdes |
| `solutions` | array | Lista med lösningar (sorterade efter kostnad) |

#### Solution Object

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `products` | array | Produkter i lösningen |
| `products[].productId` | string | Unikt produkt-ID |
| `products[].name` | string | Produktnamn |
| `products[].kgPerHa` | number | Giva i kg per hektar |
| `supplied` | object | Tillförd näring (kg/ha) |
| `deviation` | object | Avvikelse från behov per näringsämne |
| `deviation[].kg` | number | Avvikelse i kg (positivt = över, negativt = under) |
| `deviation[].pct` | number | Avvikelse i procent |
| `costPerHa` | number | Kostnad i SEK per hektar |
| `score` | number | Internt score (lägre = bättre) |
| `notes` | array | Varningar och kommentarer |

#### Felhantering

```json
{
  "success": false,
  "error": "Näringsbehov (need) krävs och måste vara ett objekt"
}
```

| HTTP Status | Beskrivning |
|-------------|-------------|
| 400 | Ogiltig input (saknat behov, felaktig strategi) |
| 500 | Serverfel eller inga produkter tillgängliga |

---

### POST /api/optimize-v7

**Avancerad MILP-optimering** med fler kontrollmöjligheter. Returnerar prispall med flera strategier.

#### Request

```http
POST /api/optimize-v7
Content-Type: application/json

{
  "targets": {
    "N": 150,
    "P": 25,
    "K": 40,
    "S": 15
  },
  "mustFlags": {
    "mustN": true,
    "mustP": true,
    "mustK": true,
    "mustS": false
  },
  "maxProducts": 3,
  "minDose": 100,
  "maxDose": 600
}
```

#### Request Parameters

| Parameter | Typ | Obligatorisk | Beskrivning |
|-----------|-----|--------------|-------------|
| `targets` | object | ✅ Ja | Målvärden för näring (kg/ha) |
| `targets.N` | number | Nej | Kvävemål |
| `targets.P` | number | Nej | Fosformål |
| `targets.K` | number | Nej | Kaliummål |
| `targets.S` | number | Nej | Svavelmål |
| `mustFlags` | object | Nej | Vilka ämnen som MÅSTE inkluderas |
| `mustFlags.mustN` | boolean | Nej | Kväve måste täckas |
| `mustFlags.mustP` | boolean | Nej | Fosfor måste täckas |
| `mustFlags.mustK` | boolean | Nej | Kalium måste täckas |
| `mustFlags.mustS` | boolean | Nej | Svavel måste täckas |
| `maxProducts` | number | Nej | Max antal produkter (1-4). Default: 2 |
| `minDose` | number | Nej | Minsta giva per produkt (kg/ha). Default: 100 |
| `maxDose` | number | Nej | Högsta giva per produkt (kg/ha). Default: 600 |

#### Response

```json
{
  "success": true,
  "status": "ok",
  "strategies": [
    {
      "rank": 1,
      "cost": 2850.50,
      "products": [
        {
          "id": "prod-301234",
          "name": "NS 27-4",
          "dose": 450,
          "costContribution": 1800.00
        }
      ],
      "supplied": {
        "N": 152.1,
        "P": 26.8,
        "K": 41.2,
        "S": 16.5
      }
    }
  ],
  "warnings": []
}
```

---

## Produkter

### GET /api/products

Hämta alla tillgängliga produkter.

#### Request

```http
GET /api/products
```

#### Response

```json
{
  "success": true,
  "count": 156,
  "products": [
    {
      "id": "prod-301234",
      "name": "NS 27-4",
      "pricePerKg": 4.25,
      "nutrients": {
        "N": 27,
        "P": 0,
        "K": 0,
        "S": 4
      },
      "description": "Kvävegödsel med svavel"
    }
  ]
}
```

#### Product Object

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `id` | string | Unikt produkt-ID |
| `name` | string | Produktnamn |
| `pricePerKg` | number | Pris i SEK per kg |
| `nutrients` | object | Näringsinnehåll i procent (0-100) |
| `nutrients.N` | number | Kväve % |
| `nutrients.P` | number | Fosfor % |
| `nutrients.K` | number | Kalium % |
| `nutrients.S` | number | Svavel % |
| `description` | string | Produktbeskrivning (valfritt) |

---

## Grödor & Behovsberäkning

### GET /api/crops

Hämta alla tillgängliga grödor.

#### Request

```http
GET /api/crops
GET /api/crops?category=cereals
```

#### Query Parameters

| Parameter | Typ | Beskrivning |
|-----------|-----|-------------|
| `category` | string | Filtrera på kategori (valfritt) |

#### Response

```json
{
  "success": true,
  "count": 25,
  "crops": [
    {
      "id": "wheat-winter",
      "name": "Höstvete",
      "category": "cereals",
      "nutrientRequirements": {
        "N": 22,
        "P": 3.5,
        "K": 4.5,
        "S": 2.5
      },
      "precropEffect": {
        "nEffect": 0,
        "yieldEffect": 0
      }
    }
  ]
}
```

---

### POST /api/calculate-need

Beräkna näringsbehov baserat på gröda och förväntad skörd.

#### Request

```http
POST /api/calculate-need
Content-Type: application/json

{
  "cropId": "wheat-winter",
  "yieldTonPerHa": 8.5,
  "precropId": "peas"
}
```

#### Request Parameters

| Parameter | Typ | Obligatorisk | Beskrivning |
|-----------|-----|--------------|-------------|
| `cropId` | string | ✅ Ja | ID för huvudgrödan |
| `yieldTonPerHa` | number | ✅ Ja | Förväntad skörd (ton/ha) |
| `precropId` | string | Nej | ID för förfrukt (påverkar N-behov) |

#### Response

```json
{
  "success": true,
  "crop": "Höstvete",
  "yieldTonPerHa": 8.5,
  "need": {
    "N": 187,
    "P": 29.75,
    "K": 38.25,
    "S": 21.25
  },
  "precrop": {
    "id": "peas",
    "name": "Ärter",
    "nEffect": -30,
    "yieldIncreaseKgHa": 500,
    "yieldIncreaseNRequirement": 11
  }
}
```

---

## Exempelkod

### cURL

```bash
# Enkel rekommendation
curl -X POST "https://your-server.com/api/recommend" \
  -H "Content-Type: application/json" \
  -d '{
    "need": {"N": 150, "P": 25, "K": 40, "S": 15},
    "requiredNutrients": ["N", "P", "K", "S"],
    "maxProducts": 3
  }'
```

### JavaScript/Node.js

```javascript
const response = await fetch('https://your-server.com/api/recommend', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    need: { N: 150, P: 25, K: 40, S: 15 },
    requiredNutrients: ['N', 'P', 'K', 'S'],
    maxProducts: 3,
    topN: 5,
  }),
});

const data = await response.json();

if (data.success) {
  console.log(`Bästa lösning: ${data.solutions[0].costPerHa} SEK/ha`);
  data.solutions[0].products.forEach(p => {
    console.log(`  - ${p.name}: ${p.kgPerHa} kg/ha`);
  });
}
```

### Python

```python
import requests

response = requests.post(
    'https://your-server.com/api/recommend',
    json={
        'need': {'N': 150, 'P': 25, 'K': 40, 'S': 15},
        'requiredNutrients': ['N', 'P', 'K', 'S'],
        'maxProducts': 3,
        'topN': 5,
    }
)

data = response.json()

if data['success']:
    solution = data['solutions'][0]
    print(f"Kostnad: {solution['costPerHa']} SEK/ha")
    for product in solution['products']:
        print(f"  - {product['name']}: {product['kgPerHa']} kg/ha")
```

### C# / .NET

```csharp
using var client = new HttpClient();

var request = new {
    need = new { N = 150, P = 25, K = 40, S = 15 },
    requiredNutrients = new[] { "N", "P", "K", "S" },
    maxProducts = 3,
    topN = 5
};

var response = await client.PostAsJsonAsync(
    "https://your-server.com/api/recommend", 
    request
);

var data = await response.Content.ReadFromJsonAsync<RecommendResponse>();
```

---

## Felkoder

| HTTP Status | Betydelse |
|-------------|-----------|
| 200 | OK - Anropet lyckades |
| 400 | Bad Request - Ogiltig input |
| 403 | Forbidden - Felaktigt admin-lösenord |
| 404 | Not Found - Resurs hittades inte |
| 429 | Too Many Requests - Rate limit överskridet |
| 500 | Internal Server Error - Serverfel |
| 503 | Service Unavailable - Databasen är otillgänglig |

---

## Rate Limiting

API:et har inbyggd rate limiting för att skydda mot överbelastning:

| Endpoint | Gräns | Tidsfönster |
|----------|-------|-------------|
| `/api/*` (generell) | 100 requests | 15 minuter |
| `/api/recommend` | 10 requests | 1 minut |
| `/api/optimize-v7` | 10 requests | 1 minut |
| `/api/admin/*` | 30 requests | 15 minuter |
| `/health` | Obegränsat | - |

### Rate Limit Headers

Responses inkluderar standard rate limit headers:

```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 892
```

### Vid överskridning (HTTP 429)

```json
{
  "success": false,
  "error": "För många förfrågningar. Försök igen om 15 minuter.",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

---

## Changelog

### Version 1.0 (2025-12-30)
- Initial API-dokumentation
- Stöd för `/api/recommend`, `/api/optimize-v7`, `/api/products`, `/api/crops`
- MILP-baserad optimering med HiGHS-solver

---

## OpenAPI / Swagger Specifikation

En komplett OpenAPI 3.0-specifikation finns tillgänglig i filen `openapi.yaml`. 

### 🚀 Interaktiv API-dokumentation (Swagger UI)

Swagger UI är inbyggt i servern! Öppna denna URL i webbläsaren:

```
http://localhost:3000/api-docs
```

Här kan du:
- 📖 Läsa dokumentation för alla endpoints
- 🧪 Testa API-anrop direkt i webbläsaren
- 📋 Se request/response-scheman
- 📝 Kopiera exempelkod

### Vad är OpenAPI?

OpenAPI (tidigare Swagger) är en standardiserad specifikation för att beskriva REST API:er. Med denna fil kan du:

1. **Generera klientkod automatiskt** för valfritt programmeringsspråk
2. **Importera till API-verktyg** som Postman, Insomnia, eller Bruno
3. **Generera dokumentationssidor** med Swagger UI eller ReDoc
4. **Validera API-anrop** automatiskt

### Använda OpenAPI-specifikationen

#### 1. Visualisera med Swagger UI

Kör lokalt med Docker:
```bash
docker run -p 8080:8080 -e SWAGGER_JSON=/openapi.yaml -v $(pwd)/openapi.yaml:/openapi.yaml swaggerapi/swagger-ui
```
Öppna sedan `http://localhost:8080` i webbläsaren.

#### 2. Generera klient med OpenAPI Generator

Installera OpenAPI Generator:
```bash
npm install -g @openapitools/openapi-generator-cli
```

**Generera TypeScript-klient:**
```bash
openapi-generator-cli generate -i openapi.yaml -g typescript-fetch -o ./generated/typescript-client
```

**Generera Python-klient:**
```bash
openapi-generator-cli generate -i openapi.yaml -g python -o ./generated/python-client
```

**Generera C#-klient:**
```bash
openapi-generator-cli generate -i openapi.yaml -g csharp -o ./generated/csharp-client
```

**Generera Java-klient:**
```bash
openapi-generator-cli generate -i openapi.yaml -g java -o ./generated/java-client
```

#### 3. Importera till Postman

1. Öppna Postman
2. Klicka **Import** → **File**
3. Välj `openapi.yaml`
4. Alla endpoints skapas automatiskt med exempeldata

#### 4. Använda med VS Code

Installera tillägget "OpenAPI (Swagger) Editor" för:
- Syntax highlighting
- Auto-complete
- Live preview
- Validering

### Genererad klient - Exempelanvändning

**TypeScript (efter generering):**
```typescript
import { RecommendApi, Configuration } from './generated/typescript-client';

const config = new Configuration({
  basePath: 'https://your-server.com',
});

const api = new RecommendApi(config);

const result = await api.getRecommendations({
  recommendRequest: {
    need: { N: 150, P: 25, K: 40, S: 15 },
    requiredNutrients: ['N', 'P', 'K', 'S'],
    maxProducts: 3,
  }
});

console.log(result.solutions[0].costPerHa);
```

**Python (efter generering):**
```python
from openapi_client import ApiClient, Configuration, RecommendApi

config = Configuration(host="https://your-server.com")

with ApiClient(config) as client:
    api = RecommendApi(client)
    
    result = api.get_recommendations({
        "need": {"N": 150, "P": 25, "K": 40, "S": 15},
        "required_nutrients": ["N", "P", "K", "S"],
        "max_products": 3
    })
    
    print(f"Kostnad: {result.solutions[0].cost_per_ha} SEK/ha")
```

---

## Kontakt

För frågor om API:et, kontakta projektägaren.
