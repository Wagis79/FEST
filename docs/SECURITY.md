# 🔐 FEST Säkerhetsdokumentation

## Översikt

Admin-panelen och produktdatabasen är skyddade med flera lager av säkerhet för att förhindra obehörig åtkomst.

---

## 1. Admin-autentisering

### Lösenordsbaserad åtkomstkontroll

Admin-panelen är skyddad med ett lösenord som du anger i `.env`-filen.

**Konfigurera lösenord:**
```bash
# I .env
ADMIN_PASSWORD=MySecurePassword123!
```

**Öppna admin-panelen:**
1. Gå till: http://localhost:3000/admin.html
2. Ange lösenordet
3. Lösenordet sparas i `sessionStorage` (försvinner när fliken stängs)

### API-skydd

Alla `/api/admin/*` endpoints kräver lösenord:
- Skickas som `X-Admin-Password` header
- Felaktigt lösenord ger `403 Forbidden`

**Publika endpoints (ingen autentisering):**
- `/` - Huvudapplikationen
- `/api/products` - Produktlista (read-only)
- `/api/crops` - Grödor
- `/api/recommend` - Rekommendationer

---

## 2. Åtkomstkontroll för Produktanalys

Produktanalys (`/analysis.html`) kräver inloggning via admin-panelen:

1. **Utan inloggning** → Felmeddelande med länk till admin.html
2. **Med giltig session** → Analysen laddas direkt
3. **Ogiltigt lösenord** → Session rensas, uppmaning att logga in igen

---

## 3. Supabase-säkerhet

### Row Level Security (RLS)

**Aktivera RLS på Produkter-tabellen:**
1. Gå till **Table Editor** i Supabase Dashboard
2. Välj tabellen `products`
3. Under **Row Level Security**, aktivera **Enable RLS**

**Skapa policies:**

```sql
-- Policy 1: Public Read Access
CREATE POLICY "Allow public read access"
ON public.products
FOR SELECT
TO public, anon
USING (true);

-- Policy 2: Service Role Full Access
CREATE POLICY "Service role full access"
ON public.products
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

### API-nycklar

| Nyckel | Användning | Säkerhet |
|--------|------------|----------|
| `anon public` | Används i `.env` som `SUPABASE_KEY` | ✅ Säker - följer RLS |
| `service_role` | **ANVÄNDS INTE** | ⚠️ Kan kringgå RLS |

---

## 4. Miljövariabler

### .env-filen (ALDRIG commita till git!)

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_anon_public_key

# Server Configuration
PORT=3000

# Admin Authentication
ADMIN_PASSWORD=change_this_to_a_strong_password_123!
```

### Tips för starkt lösenord:
- Minst 16 tecken
- Blandning av STORA och små bokstäver
- Siffror och specialtecken
- Använd en lösenordshanterare

---

## 5. Rate Limiting

Servern har inbyggd rate limiting för att skydda mot överbelastning:

| Endpoint | Gräns | Tidsfönster |
|----------|-------|-------------|
| `/api/*` (generell) | 100 requests | 15 minuter |
| `/api/recommend` | 10 requests | 1 minut |
| `/api/optimize-v7` | 10 requests | 1 minut |
| `/api/admin/*` | 30 requests | 15 minuter |
| `/health` | Obegränsat | - |

### Rate Limit Headers
Responses inkluderar standard rate limit headers:
- `RateLimit-Limit` - Max antal requests
- `RateLimit-Remaining` - Återstående requests
- `RateLimit-Reset` - Tid till reset (sekunder)

### Vid överskridning
HTTP 429 returneras med:
```json
{
  "success": false,
  "error": "För många förfrågningar. Försök igen om X minuter.",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

---

## 6. Produktions-checklist

### Före deployment:

- [x] `.env` är i `.gitignore`
- [x] Starkt lösenord i `ADMIN_PASSWORD`
- [x] Rate limiting aktiverat
- [x] Säkerhetsheaders (Helmet) aktiverat
- [ ] HTTPS aktiverat
- [ ] Supabase RLS aktiverat
- [ ] CORS origins konfigurerade
- [ ] Daily backups aktiverade

### Säkerhetsheaders (via Helmet):
- `X-Frame-Options: SAMEORIGIN` - Förhindrar clickjacking
- `X-Content-Type-Options: nosniff` - Förhindrar MIME-sniffing
- `Strict-Transport-Security` - HSTS för HTTPS
- `Content-Security-Policy` - CSP-policy
- `X-DNS-Prefetch-Control: off` - DNS prefetch avstängd
- `X-Download-Options: noopen` - IE download-skydd
- `X-Permitted-Cross-Domain-Policies: none` - Cross-domain policy

---

## 7. Vid säkerhetsincident

**Omedelbart:**
1. Ändra `ADMIN_PASSWORD` i `.env`
2. Rotera Supabase API-nycklar (Dashboard → Settings → API)
3. Starta om servern

**Kontrollera:**
- Granska Supabase logs
- Kontrollera server logs
- Verifiera att data inte modifierats

---

## 7. Felsökning

| Problem | Lösning |
|---------|---------|
| "Felaktigt lösenord" | Kontrollera `ADMIN_PASSWORD` i `.env` |
| "Kunde inte hämta produkter" | Kontrollera Supabase-credentials |
| Admin-panelen laddar inte | Verifiera att servern körs på port 3000 |
| 403 på API-anrop | Verifiera att `x-admin-password` header skickas |
| 429 Too Many Requests | Vänta tills rate limit reset eller kontakta admin |

---

**Version:** 2.7.3  
**Uppdaterad:** Januari 2026
