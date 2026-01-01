# FEST Extern API-dokumentation

## Översikt

FEST API:et tillhandahåller gödseloptimering baserad på näringsbehov. API:et använder MILP-optimering (Mixed Integer Linear Programming) för att hitta den mest kostnadseffektiva produktkombinationen.

**Produktion:** `https://fest-production-d1bb.up.railway.app`

**Swagger UI:** `https://fest-production-d1bb.up.railway.app/api-docs`

---

## Autentisering

Alla API-anrop kräver en giltig API-nyckel som skickas i HTTP-headern.

```
X-API-Key: din-api-nyckel
```

### Felkoder för autentisering

| HTTP Status | Kod | Beskrivning |
|-------------|-----|-------------|
| 401 | `MISSING_API_KEY` | API-nyckel saknas i requesten |
| 403 | `INVALID_API_KEY` | Ogiltig API-nyckel |

---

## Tillgängliga endpoints

| Endpoint | Metod | Beskrivning |
|----------|-------|-------------|
| `/health` | GET | Systemstatus (kräver ej API-nyckel) |
| `/api/recommend` | POST | Få gödselrekommendationer |
| `/api/products` | GET | Hämta alla produkter |
| `/api/crops` | GET | Hämta alla grödor |
| `/api/calculate-need` | POST | Beräkna näringsbehov från gröda |

---

## 1. Health Check

Kontrollerar att API:et är tillgängligt.

**Endpoint:** `GET /health`  
**Autentisering:** Ingen

### Exempel

```bash
curl https://your-production-server.com/health
```

### Response

```json
{
  "success": true,
  "status": "OK",
  "timestamp": "2025-12-30T10:00:00.000Z"
}
```

---

## 2. Få gödselrekommendationer

Huvudendpoint för optimering. Skicka in näringsbehov och få tillbaka kostnadsoptimerade produktkombinationer.

**Endpoint:** `POST /api/recommend`  
**Autentisering:** Krävs

### Request Body

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|--------------|-------------|
| `need` | object | Ja | Näringsbehov (N, P, K, S) i kg/ha |
| `requiredNutrients` | array | Nej | Vilka ämnen som MÅSTE täckas. Default: alla med värde > 0 |
| `maxProducts` | integer | Nej | Max antal produkter (1-5). Default: 3 |
| `topN` | integer | Nej | Antal lösningar att returnera (1-50). Default: 10 |
| `strategy` | string | Nej | `economic` eller `optimized`. Default: `economic` |
| `excludedProductIds` | array | Nej | Produkt-ID:n att exkludera |
| `requiredProductIds` | array | Nej | Produkt-ID:n som MÅSTE inkluderas i lösningen |

> **Obs:** `requiredProductIds` och `excludedProductIds` får inte överlappa. Antal tvingade produkter får inte överstiga `maxProducts`.

### Exempel

```bash
curl -X POST "https://your-production-server.com/api/recommend" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: din-api-nyckel" \
  -d '{
    "need": {
      "N": 150,
      "P": 25,
      "K": 40,
      "S": 15
    },
    "requiredNutrients": ["N", "P", "K", "S"],
    "maxProducts": 3,
    "topN": 5
  }'
```

### Response

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
          "name": "NPK 21-3-10",
          "kgPerHa": 200
        }
      ],
      "supplied": {
        "N": 152,
        "P": 26,
        "K": 42,
        "S": 18
      },
      "costPerHa": 2850.50,
      "notes": []
    }
  ]
}
```

---

## 3. Hämta produkter

Returnerar alla tillgängliga gödselprodukter.

**Endpoint:** `GET /api/products`  
**Autentisering:** Krävs

### Exempel

```bash
curl "https://your-production-server.com/api/products" \
  -H "X-API-Key: din-api-nyckel"
```

### Response

```json
{
  "success": true,
  "count": 45,
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
      }
    }
  ]
}
```

---

## 4. Hämta grödor

Returnerar alla tillgängliga grödor med näringskrav.

**Endpoint:** `GET /api/crops`  
**Autentisering:** Krävs

### Query Parameters

| Parameter | Typ | Beskrivning |
|-----------|-----|-------------|
| `category` | string | Filtrera på kategori: `cereals`, `oilseeds`, `legumes`, `root_crops`, `grass`, `other` |

### Exempel

```bash
curl "https://your-production-server.com/api/crops?category=cereals" \
  -H "X-API-Key: din-api-nyckel"
```

### Response

```json
{
  "success": true,
  "count": 12,
  "crops": [
    {
      "id": "wheat-winter",
      "name": "Höstvete",
      "category": "cereals",
      "nutrientRequirements": {
        "N": 22,
        "P": 3.5,
        "K": 5,
        "S": 2
      }
    }
  ]
}
```

---

## 5. Beräkna näringsbehov

Beräknar näringsbehov baserat på gröda och förväntad skörd.

**Endpoint:** `POST /api/calculate-need`  
**Autentisering:** Krävs

### Request Body

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|--------------|-------------|
| `cropId` | string | Ja | Grödans ID (från `/api/crops`) |
| `yieldTonPerHa` | number | Ja | Förväntad skörd i ton/ha |
| `precropId` | string | Nej | Förfruktens ID för kvävekorrigering |

### Exempel

```bash
curl -X POST "https://your-production-server.com/api/calculate-need" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: din-api-nyckel" \
  -d '{
    "cropId": "wheat-winter",
    "yieldTonPerHa": 8.5,
    "precropId": "peas"
  }'
```

### Response

```json
{
  "success": true,
  "crop": "Höstvete",
  "yieldTonPerHa": 8.5,
  "need": {
    "N": 157,
    "P": 30,
    "K": 43,
    "S": 17
  },
  "precrop": {
    "id": "peas",
    "name": "Ärter",
    "nEffect": 30
  }
}
```

---

## Komplett exempel: Från gröda till rekommendation

Här är ett komplett flöde som visar hur du går från grödval till optimerad gödselrekommendation:

```bash
# Steg 1: Beräkna näringsbehov för höstvete, 8.5 ton/ha, med ärter som förfrukt
NEED=$(curl -s -X POST "https://your-production-server.com/api/calculate-need" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: din-api-nyckel" \
  -d '{
    "cropId": "wheat-winter",
    "yieldTonPerHa": 8.5,
    "precropId": "peas"
  }')

# Extrahera näringsbehov
N=$(echo $NEED | jq '.need.N')
P=$(echo $NEED | jq '.need.P')
K=$(echo $NEED | jq '.need.K')
S=$(echo $NEED | jq '.need.S')

# Steg 2: Få gödselrekommendationer
curl -X POST "https://your-production-server.com/api/recommend" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: din-api-nyckel" \
  -d "{
    \"need\": {\"N\": $N, \"P\": $P, \"K\": $K, \"S\": $S},
    \"requiredNutrients\": [\"N\", \"P\", \"K\", \"S\"],
    \"maxProducts\": 3,
    \"topN\": 3
  }"
```

---

## Felhantering

Alla fel returneras med `success: false` och ett `error`-meddelande:

```json
{
  "success": false,
  "error": "Näringsbehov (need) krävs och måste vara ett objekt"
}
```

### Vanliga HTTP-statuskoder

| Status | Beskrivning |
|--------|-------------|
| 200 | Lyckad förfrågan |
| 400 | Ogiltig input (saknade fält, felaktiga värden) |
| 401 | API-nyckel saknas |
| 403 | Ogiltig API-nyckel |
| 404 | Resurs hittades inte |
| 500 | Internt serverfel |

---

## Rate Limiting

För närvarande finns inga hårda gränser, men vi ber dig att:
- Begränsa till max 60 anrop per minut
- Cacha produkter och grödor lokalt (de ändras sällan)
- Använd batch-förfrågningar om möjligt

---

## Swagger/OpenAPI

Interaktiv API-dokumentation finns på:

```
https://your-production-server.com/api-docs
```

OpenAPI-specifikation (YAML) för klientgenerering:

```
https://your-production-server.com/openapi.yaml
```

---

## Kontakt

För API-nycklar eller teknisk support, kontakta API-administratören.
