# Portal de Avance de Ventas — FINEZA S.A.

Especificación completa: [PORTAL_AVANCE_VENTAS.md](PORTAL_AVANCE_VENTAS.md).

Sitio estático (`public/`, sin build) + Netlify Functions (`netlify/functions/`) + Netlify Blobs (store `ventas`).

## Primer deploy

1. En Netlify → Site settings → Environment variables, cargar:
   `SESSION_SECRET`, `ADMIN_CI`, `ADMIN_PIN`, `ADMIN_NOMBRE`, `PORTAL_URL`
   y, si se usa Teams, `TEAMS_WEBHOOK_URL` y `TEAMS_CANAL`.
2. Desde esta carpeta:

```bash
npm install
npm i -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

3. Ingresar con `ADMIN_CI` / `ADMIN_PIN`. El primer admin se crea solo, la primera vez que alguien intenta ingresar con la lista de usuarios vacía.

Para generar `SESSION_SECRET` en PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Probar localmente

```bash
netlify dev
```

Pruebas de las reglas de cálculo: `npm test`.

## Estructura

```
netlify/functions/   login, logout, me, dashboard, draft, publish, users (rutas /api/*)
netlify/lib/         auth.mjs (PIN scrypt, sesión HMAC, helpers) y store.mjs (Blobs, usuarios)
public/js/calc.js    reglas de cálculo, compartidas por el front y publish.mjs (aviso Teams)
public/js/app.js     vistas #ventas, #usuarios, #dashboard
tests/               pruebas de calc.js
```

## Decisiones no especificadas

- Bloqueo por PIN: mensaje "Demasiados intentos fallidos. Probá de nuevo en N minutos." (HTTP 429).
- Desactivar un usuario corta también su sesión abierta (cada función relee el usuario).
- Restablecer PIN también desbloquea al usuario.
- "Descartar cambios" sin ninguna publicación previa deja el formulario en cero con la fecha de hoy.
- El borrador se autoguarda 0,7 s después de cada cambio.
