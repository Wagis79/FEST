# M3 CE Webhook Integration

## Översikt

FEST (Fertilizer Expert System Tool) har en webhook-endpoint för att ta emot produktuppdateringar från M3 CE ERP-systemet. Webhook:en möjliggör automatisk synkronisering av produktpriser och tillgänglighetsstatus.

---

## Endpoint

| Parameter | Värde |
|-----------|-------|
| **URL** | `https://fest-production-d1bb.up.railway.app/api/webhook/m3-product` |
| **Metod** | `POST` |
| **Content-Type** | `application/json` |

---

## Autentisering

Webhook:en kräver en hemlig nyckel som skickas i HTTP-headern.

| Header | Värde |
|--------|-------|
| `X-Webhook-Secret` | `<delad hemlig nyckel>` |

> ⚠️ **Viktigt:** Den hemliga nyckeln delas separat via säker kanal. Lagra den aldrig i klartext i kod eller loggar.

---

## Request Body

```json
{
  "itemNumber": "301763",
  "salesPrice": 5500,
  "active": true
}
```

### Fält

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|--------------|-------------|
| `itemNumber` | `string` | ✅ Ja | Artikelnummer från M3. Matchar mot `Artikelnr` i FEST-databasen. |
| `salesPrice` | `number` | ❌ Nej | Pris per **ton** i SEK. Konverteras automatiskt till pris per kg (÷1000). |
| `active` | `boolean` | ❌ Nej | `true` = produkten är tillgänglig, `false` = produkten är ej tillgänglig och exkluderas från rekommendationer. |

> **OBS:** Minst ett av `salesPrice` eller `active` måste anges.

---

## Responses

### ✅ Lyckad uppdatering (200)

```json
{
  "success": true,
  "message": "Product updated successfully",
  "artikelnr": 301763,
  "updates": {
    "salesPrice": 5500,
    "active": true
  }
}
```

### ❌ Felmeddelanden

| HTTP Status | Kod | Beskrivning |
|-------------|-----|-------------|
| 401 | `UNAUTHORIZED` | Felaktig eller saknad `X-Webhook-Secret` |
| 400 | `MISSING_ITEM_NUMBER` | `itemNumber` saknas i request body |
| 400 | `NO_UPDATES` | Varken `salesPrice` eller `active` angavs |
| 404 | `PRODUCT_NOT_FOUND` | Inget artikelnummer matchade i databasen |
| 500 | `UPDATE_FAILED` | Databasfel vid uppdatering |
| 503 | `WEBHOOK_NOT_CONFIGURED` | Webhook är inte konfigurerad på servern |

#### Exempel felrespons:

```json
{
  "success": false,
  "error": "Product not found",
  "code": "PRODUCT_NOT_FOUND",
  "itemNumber": "999999"
}
```

---

## Användningsfall

### 1. Uppdatera pris

När en produkts pris ändras i M3:

```bash
curl -X POST "https://fest-production-d1bb.up.railway.app/api/webhook/m3-product" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <hemlig-nyckel>" \
  -d '{
    "itemNumber": "301763",
    "salesPrice": 5500
  }'
```

### 2. Markera produkt som ej tillgänglig

När en produkt tar slut på lager eller utgår:

```bash
curl -X POST "https://fest-production-d1bb.up.railway.app/api/webhook/m3-product" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <hemlig-nyckel>" \
  -d '{
    "itemNumber": "301763",
    "active": false
  }'
```

### 3. Återaktivera produkt

När en produkt blir tillgänglig igen:

```bash
curl -X POST "https://fest-production-d1bb.up.railway.app/api/webhook/m3-product" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <hemlig-nyckel>" \
  -d '{
    "itemNumber": "301763",
    "active": true
  }'
```

### 4. Uppdatera både pris och status

```bash
curl -X POST "https://fest-production-d1bb.up.railway.app/api/webhook/m3-product" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <hemlig-nyckel>" \
  -d '{
    "itemNumber": "301763",
    "salesPrice": 4800,
    "active": true
  }'
```

---

## Priskonvertering

M3 skickar priser per **ton**, men FEST lagrar priser per **kg**.

| M3 (per ton) | FEST (per kg) | Beräkning |
|--------------|---------------|-----------|
| 5000 SEK | 5.00 SEK | 5000 ÷ 1000 |
| 4200 SEK | 4.20 SEK | 4200 ÷ 1000 |
| 12500 SEK | 12.50 SEK | 12500 ÷ 1000 |

---

## Artikelnummer-mappning

Webhook:en matchar på `itemNumber` mot kolumnen `Artikelnr` i FEST-databasen.

### Exempel på artikelnummer i FEST:

| Artikelnr | Produktnamn |
|-----------|-------------|
| 301763 | NS 27-4 |
| 300095 | Achema Urea |
| 301799 | YaraMila Höst 8-10.5-20 |
| 301475 | Axan |

> **Tips:** Kontakta FEST-administratör för en komplett lista över artikelnummer.

---

## Effekt på FEST-systemet

### När `active: false` sätts:
- Produkten **exkluderas** från alla gödslingsrekommendationer
- Produkten visas **inte** i produktlistan för användare
- Admin kan fortfarande se och hantera produkten

### När `active: true` sätts:
- Produkten **inkluderas** i gödslingsrekommendationer igen
- Produkten visas i produktlistan

### När `salesPrice` uppdateras:
- Nytt pris används direkt i kostnadsberäkningar
- Påverkar rekommendationer baserade på ekonomisk optimering

---

## Säkerhet

| Säkerhetsåtgärd | Beskrivning |
|-----------------|-------------|
| **HTTPS** | All trafik är krypterad |
| **Hemlig nyckel** | 256-bit slumpmässig nyckel krävs i header |
| **Timing-safe jämförelse** | Skydd mot timing-attacker |
| **Loggning** | Alla webhook-anrop loggas (utan känslig data) |

---

## Testning

### Testa anslutningen

```bash
# Testa utan riktig uppdatering - ska ge 400 (ingen uppdatering angiven)
curl -X POST "https://fest-production-d1bb.up.railway.app/api/webhook/m3-product" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <hemlig-nyckel>" \
  -d '{"itemNumber": "301763"}'
```

Förväntad respons:
```json
{
  "success": false,
  "error": "No updates provided. Include salesPrice and/or active",
  "code": "NO_UPDATES"
}
```

Detta bekräftar att autentiseringen fungerar och endpoint:en är nåbar.

---

## Kontakt

| Roll | Kontakt |
|------|---------|
| **FEST Teknisk support** | [Kontaktuppgifter här] |
| **M3 Integration** | [Kontaktuppgifter här] |

---

## Ändringslogg

| Datum | Version | Beskrivning |
|-------|---------|-------------|
| 2024-12-30 | 1.0 | Initial webhook-implementation |

