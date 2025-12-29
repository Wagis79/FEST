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

## 5. Produktions-checklist

### Före deployment:

- [ ] `.env` är i `.gitignore`
- [ ] Starkt lösenord i `ADMIN_PASSWORD`
- [ ] HTTPS aktiverat
- [ ] Supabase RLS aktiverat
- [ ] CORS origins konfigurerade
- [ ] Daily backups aktiverade

### Säkerhetsheaders (ingår automatiskt):
- `X-Frame-Options: DENY` - Förhindrar clickjacking
- `X-Content-Type-Options: nosniff` - Förhindrar MIME-sniffing
- `X-XSS-Protection: 1; mode=block` - XSS-filter

---

## 6. Vid säkerhetsincident

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

---

**Version:** 2.2.0  
**Uppdaterad:** December 2025
