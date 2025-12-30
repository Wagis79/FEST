# API Korsreferensrapport

**Genererad:** 2025-12-30  
**Syfte:** Verifiera att faktisk serverkod matchar dokumentation

---

## Sammanfattning

| Kategori | Status |
|----------|--------|
| Externa endpoints | ✅ Överensstämmer |
| Interna endpoints | ✅ Överensstämmer |
| Admin endpoints | ⚠️ Delvis dokumenterade |
| Middleware | ✅ Överensstämmer |
| Felkoder | ✅ Överensstämmer |

---

## 1. Endpoint-korsreferens

### Externa endpoints (requireApiKey middleware)

| Endpoint | Metod | server.ts (rad) | openapi.yaml | API_EXTERNAL.md | API_DOCUMENTATION.md |
|----------|-------|-----------------|--------------|-----------------|---------------------|
| `/health` | GET | 645 (ingen middleware) | ✅ | ✅ | ✅ |
| `/api/products` | GET | 190 (requireApiKey) | ✅ | ✅ | ✅ |
| `/api/recommend` | POST | 219 (requireApiKey) | ✅ | ✅ | ✅ |
| `/api/crops` | GET | 537 (requireApiKey) | ✅ | ✅ | ✅ |
| `/api/calculate-need` | POST | 581 (requireApiKey) | ✅ | ✅ | ✅ |

### Interna endpoints (blockExternalAccess middleware)

| Endpoint | Metod | server.ts (rad) | openapi-internal.yaml | API_DOCUMENTATION.md |
|----------|-------|-----------------|----------------------|---------------------|
| `/api/optimize-v5` | POST | 328 (blockExternalAccess) | ✅ | ✅ |
| `/api/optimize-v7` | POST | 444 (blockExternalAccess) | ✅ | ✅ |

### Admin endpoints (requireAdminPassword middleware)

| Endpoint | Metod | server.ts (rad) | openapi-internal.yaml | API_DOCUMENTATION.md |
|----------|-------|-----------------|----------------------|---------------------|
| `/api/admin/products` | GET | 665 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/products` | POST | 697 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/products/:id` | PUT | 755 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/products/:id` | DELETE | 819 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/product-analysis` | GET | 861 (requireAdminPassword) | ❌ Saknas | ❌ Ej detaljerad |
| `/api/admin/crops` | GET | 966 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/crops` | POST | 985 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/crops/:id` | PUT | 1026 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/crops/:id` | DELETE | 1067 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/config` | GET | 1094 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/config/:key` | GET | 1118 (requireAdminPassword) | ❌ Saknas | ❌ Ej detaljerad |
| `/api/admin/config/:key` | PUT | 1149 (requireAdminPassword) | ✅ | ❌ Ej detaljerad |
| `/api/admin/config/batch` | POST | 1195 (requireAdminPassword) | ❌ Saknas | ❌ Ej detaljerad |
| `/api/admin/config/legacy-engine` | DELETE | 1246 (requireAdminPassword) | ❌ Saknas | ❌ Ej detaljerad |

---

## 2. Middleware-korsreferens

| Middleware | Funktion | Verifierad i server.ts |
|------------|----------|------------------------|
| `requireApiKey` | Kräver X-API-Key header om API_KEYS är konfigurerade | ✅ Rad 67-94 |
| `blockExternalAccess` | Blockerar anrop med API-nyckel (externa) | ✅ Rad 101-120 |
| `requireAdminPassword` | Kräver X-Admin-Password header | ✅ Rad 52-63 |

---

## 3. Felkoder-korsreferens

| HTTP Status | Kod | Dokumenterad | Faktisk implementation |
|-------------|-----|--------------|------------------------|
| 401 | `MISSING_API_KEY` | ✅ | ✅ server.ts rad 79-83 |
| 403 | `INVALID_API_KEY` | ✅ | ✅ server.ts rad 85-89 |
| 403 | `ENDPOINT_NOT_AVAILABLE` | ✅ | ✅ server.ts rad 112-116 |

---

## 4. Identifierade problem

### ✅ Åtgärdat

1. **Admin-produktendpoints har nu middleware** (fixat 2025-12-30)
   - `/api/admin/products` (GET, POST)
   - `/api/admin/products/:id` (PUT, DELETE)
   - Alla har nu `requireAdminPassword` middleware

### 🟡 Varningar

2. **Odokumenterade admin-endpoints i openapi-internal.yaml:**
   - `/api/admin/product-analysis`
   - `/api/admin/config/:key` (GET)
   - `/api/admin/config/batch`
   - `/api/admin/config/legacy-engine`

### 🟢 Rekommendationer

3. **API_DOCUMENTATION.md saknar detaljerad admin-dokumentation**
   - Överväg att lägga till separat admin-dokumentation eller utöka befintlig

---

## 5. Swagger-korsreferens

| Swagger URL | Fil | Endpoints inkluderade |
|-------------|-----|----------------------|
| `/api-docs` | openapi.yaml | health, recommend, products, crops, calculate-need |
| `/api-docs-internal` | openapi-internal.yaml | Alla ovan + optimize-v5, optimize-v7, admin/* |

---

## 6. Åtgärdsplan

### Prioritet 1 (Säkerhet)
- [x] ~~Lägg till `requireAdminPassword` på admin/products endpoints~~ ✅ Åtgärdat

### Prioritet 2 (Dokumentation)
- [ ] Lägg till saknade endpoints i openapi-internal.yaml
- [ ] Skapa detaljerad admin-dokumentation

### Prioritet 3 (Upprensning)
- [ ] Uppdatera API_DOCUMENTATION.md med admin-detaljer

---

*Denna rapport genererades genom automatisk korsreferering av server.ts mot dokumentationsfiler.*
