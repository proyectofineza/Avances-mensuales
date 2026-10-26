# Portal de Avance de Ventas — FINEZA S.A.

Especificación para construir la versión real a partir del prototipo aprobado en el canvas de diseño. Este documento es la fuente de verdad: si algo no está acá, preguntar antes de inventarlo.

---

## 1. Objetivo

Portal web interno donde:

- El **administrador** carga los objetivos mensuales y la venta acumulada de cada unidad de negocio, y pulsa **Publicar**.
- Al publicar, el **dashboard de los comerciales** se actualiza automáticamente y (opcional) se envía un **aviso a un canal de Microsoft Teams**.
- Los **comerciales** solo pueden ver el dashboard.

Ingreso con **cédula de identidad (CI) + PIN numérico**.

## 2. Restricciones del proyecto

- **Hosting: solo Netlify, plan gratis.** Nada de Supabase ni otra base externa.
- Cuidar minutos de build y créditos: **sin paso de build** (HTML + CSS + JS vanilla, sin React/Vite). Deploy con Netlify CLI desde la PC (`netlify deploy --prod`), que empaqueta las funciones localmente.
- Persistencia con **Netlify Blobs** (`@netlify/blobs`), lógica de servidor con **Netlify Functions** (Node 18+, ESM).
- Entregables de cada iteración: **un único zip** con todo lo que hay que subir.
- Todo el texto de la interfaz en **español (Paraguay)**, voseo ("Ingresá", "Usá", "Indicá").
- Moneda: guaraníes. Formato `Gs. 1.930 M` (millones, separador de miles con punto, `toLocaleString('es-PY')`). Porcentajes con coma decimal: `70,4%`.

## 3. Unidades de negocio

| id    | Nombre visible     | Grupo     | Días operativos        |
|-------|--------------------|-----------|------------------------|
| `may` | Mayorista          | Baratote  | Lunes a domingo        |
| `min` | Minorista          | Baratote  | Lunes a domingo        |
| `fgl` | Fineglass          | —         | Lunes a viernes        |
| `fbt` | Fineboats          | —         | Lunes a domingo        |

Baratote se muestra como **general** (suma de Mayorista + Minorista) y **por canal**. Cada canal tiene su propio objetivo; el objetivo general de Baratote es la suma de ambos.

En todas las tablas (Cargar ventas, Ritmo necesario) Baratote figura como **unidad de negocio** con sus totales, y Mayorista y Minorista debajo como **subcategorías**. La fila de Baratote es de solo lectura: se calcula sumando los canales.

## 4. Roles

| Rol           | Puede                                                                 |
|---------------|-----------------------------------------------------------------------|
| `admin`       | Cargar ventas y publicar; alta/activar/desactivar usuarios; ver dashboard |
| `comercial`   | Solo ver el dashboard                                                  |

- Un usuario **inactivo** no puede ingresar (mensaje: "Tu usuario está desactivado. Consultá con el administrador.").
- Un admin **no puede desactivarse a sí mismo** (en su fila se muestra "Sesión actual").
- Debe existir siempre al menos un admin activo (validar en servidor).

## 5. Reglas de cálculo

Para cada unidad, con `corte` = fecha de corte publicada (YYYY-MM-DD):

```
diasOperados  = días operativos del mes desde el 1 hasta 'corte' inclusive
diasMes       = días operativos totales del mes
avance        = real / objetivo
proyeccion    = real / diasOperados * diasMes
proyeccionPct = proyeccion / objetivo
ritmoIdeal    = diasOperados / diasMes
faltante      = max(objetivo - real, 0)
diasRestantes = diasMes - diasOperados
necesarioDia  = faltante / diasRestantes      (0 si no quedan días)
promedioDia   = real / diasOperados
```

"Días operativos" depende de la unidad (tabla de la sección 3). Fineglass solo cuenta lunes a viernes.

**Totales**: real total = suma de las 4 unidades; objetivo total = suma; proyección total = **suma de las proyecciones de cada unidad** (no recalcular con días, porque Fineglass tiene otro calendario). El "ritmo ideal a hoy" del KPI total usa calendario lunes a domingo.

**Estado** (según `proyeccionPct`):

| Condición      | Texto       | Fondo     | Texto color |
|----------------|-------------|-----------|-------------|
| ≥ 100%         | En camino   | `#E3EBFC` | `#1E3A8A`   |
| ≥ 90% y < 100% | Ajustado    | `#FDF0DC` | `#92400E`   |
| < 90%          | En riesgo   | `#FBE4E8` | `#9F1239`   |

En la tabla de ritmo, "Necesario/día" va en naranja `#92400E` si es mayor al promedio actual; si no, azul `#1E3A8A`.

## 6. Pantallas

Layout fluido, contenedor `max-width: 1280px`, padding 24px, todo usable en celular (los paneles laterales pasan abajo, las tablas anchas scrollean horizontalmente dentro de su caja).

### 6.1 Inicio de sesión
- Fondo blanco, centrado, ancho máx. 420px.
- Arriba: logo **Fineza** (200px de ancho) y debajo "Portal de avance de ventas".
- Tarjeta con: título "Ingresar", subtítulo "Usá tu número de cédula y tu PIN de acceso.", campo **Cédula de identidad** (solo dígitos), campo **PIN de acceso** (password, numérico, 4–6 dígitos), botón **Ingresar**.
- Error: "Cédula o PIN incorrectos." en caja rosa.
- Debajo: "NUESTRAS UNIDADES DE NEGOCIO" y los logos **Baratote** (alto 24px), **Fine Glass Solutions** (44px) y **Fine Boats** (48px), en fila, centrados, con wrap.
- Quitar la caja de "usuarios de prueba" del prototipo.

### 6.2 Encabezado (todas las pantallas internas)
- Fondo gris `#E4E7EC`, borde inferior `#CDD2DA`.
- Izquierda: **solo el logo Fineza** (alto 42px), sin texto al lado.
- Centro (solo admin): pestañas **Cargar ventas · Usuarios · Dashboard**. Activa: fondo `#0B3F86`, texto blanco. Inactiva: transparente, texto `#374151`. Alto 40px.
- Derecha: nombre del usuario, chip de rol (fondo blanco, texto `#0B3F86`), botón **Salir** (blanco, borde `#B4BBC6`).
- Debajo del encabezado, aviso azul descartable cuando se publica: "Reporte publicado con corte al DD/MM/AAAA. Aviso enviado al canal de Teams [nombre]." o "... Sin aviso a Teams."

### 6.3 Admin · Cargar ventas
- Panel principal: título "Cargar ventas", subtítulo "Actualizá la venta acumulada del mes y publicá. Los comerciales ven el cambio al instante."
- Chip de estado: "Cambios sin publicar" (naranja) / "Al día con lo publicado" (azul).
- Campo **Fecha de corte** (date).
- Tabla: Unidad (con grupo y "lun a lun" / "lun a vie") · Objetivo mensual (Gs.) · Venta acumulada (Gs.) · Avance (calculado en vivo). Inputs con separador de miles, solo dígitos.
- Checkbox **"Avisar en el canal de Teams al publicar"** (marcado por defecto).
- Botones **Descartar cambios** (vuelve a lo publicado) y **Publicar** (primario).
- Validación: fecha obligatoria; objetivo > 0 en todas las unidades. Mensaje: "Falta el objetivo mensual de X."
- Panel lateral "Última publicación": corte, fecha/hora de publicación, quién publicó, avance total, botón **Ver como comercial** (va al Dashboard).
- Panel lateral "Cómo se proyecta" con la fórmula en una línea y la aclaración de calendarios.
- El borrador se guarda en el servidor (para no perderlo si se cierra el navegador), separado de lo publicado. Los comerciales nunca ven el borrador.

### 6.4 Admin · Usuarios
- Formulario "Alta de usuario": Cédula, Nombre y apellido, PIN (4 a 6 dígitos), Rol (Comercial por defecto / Administrador), botón **Dar de alta**.
- Validaciones: cédula ≥ 5 dígitos y no repetida; nombre obligatorio; PIN 4–6 dígitos. Éxito: "X fue dado de alta como Comercial."
- Lista: Cédula (con puntos) · Nombre · Rol · Estado (chip Activo/Inactivo) · acción **Activar/Desactivar**. Encabezado con "N usuarios · M activos".
- Agregar (no estaba en el prototipo): acción **Restablecer PIN** por usuario.

### 6.5 Dashboard (comercial y admin)
1. Título "Avance de ventas · Octubre 2026" (mes del corte) + "Corte al DD/MM/AAAA · Publicado DD/MM/AAAA HH:MM por Nombre".
2. **4 KPIs** en grilla (`auto-fit, minmax(230px, 1fr)`):
   - Venta acumulada (al corte)
   - Objetivo del mes ("Faltan Gs. X M")
   - Avance sobre objetivo ("Ritmo ideal a hoy X%")
   - Proyección al cierre — tarjeta oscura `#111827`, texto blanco: monto, "% del objetivo · Estado"
3. **Tarjetas por unidad** (`auto-fit, minmax(340px, 1fr)`): Baratote, Fineglass, Fineboats.
   - Título, "Opera lunes a lunes · día X de Y", chip de estado.
   - % de avance grande (34px) + "de avance · proyecta X%".
   - **Barra de avance** (alto 14px, escala 0–120%): fondo `#EEF0F3`, proyección en `#BFD0F7`, real en `#1D4ED8` encima, línea vertical negra del objetivo (100%) en la posición 83,3%.
   - Fila Real · Proyección · Objetivo.
   - Baratote además muestra los canales Mayorista y Minorista con barra fina (8px) y "X% · proy. Y% · real de objetivo".
   - Leyenda debajo de las tarjetas: Venta real / Proyección al cierre / Objetivo (100%).
4. Fila inferior con dos paneles:
   - **Evolución del avance total**: columnas, una por publicación del mes (máx. 8 últimas), alto 200px, la última en `#1D4ED8` y las anteriores en `#93A9E8`, % arriba de cada columna, fecha DD/MM abajo, y una **línea naranja `#B45309`** en cada columna marcando el ritmo ideal a esa fecha. Escala: 100% del objetivo = 82% del alto.
   - **Ritmo necesario para llegar**: tabla Unidad · Faltante · Días · Prom./día · Necesario/día (montos en millones). Nota al pie explicando el color naranja.

Los gráficos se dibujan con HTML/CSS (divs con alto/ancho en %), sin librería de gráficos.

## 7. Sistema visual

- Tipografía: **IBM Plex Sans** (Google Fonts, 400/500/600/700), `font-variant-numeric: tabular-nums`.
- Colores:

| Uso                     | Color     |
|-------------------------|-----------|
| Fondo de página         | `#F3F4F6` |
| Superficie / tarjetas   | `#FFFFFF` |
| Bordes                  | `#E2E5EA` |
| Bordes de inputs        | `#C9CED6` |
| Texto principal         | `#111827` |
| Texto secundario        | `#5B6472` |
| Azul primario (botones, barras) | `#1D4ED8` |
| Azul Fineza (pestaña activa) | `#0B3F86` |
| Proyección (barra clara) | `#BFD0F7` |
| Ritmo ideal             | `#B45309` |
| Encabezado              | `#E4E7EC` |

- Radios: tarjetas 12px, inputs/botones 8px, chips 999px.
- Inputs y botones de 44–46px de alto (táctil).
- Sin emojis, sin degradados.

## 8. Logos

En la carpeta `logos/` de este paquete (PNG recortados, fondo transparente o blanco):

- `fineza.png` — encabezado y login
- `baratote.png`, `fineglass.png`, `fineboats.png` — fila de unidades del login

Copiarlos a `public/img/`.

## 9. Arquitectura

```
portal-avance-ventas/
├── netlify.toml
├── package.json            # dependencias: @netlify/blobs
├── public/                 # se publica tal cual, sin build
│   ├── index.html          # login
│   ├── app.html            # app (encabezado + vistas por hash: #ventas, #usuarios, #dashboard)
│   ├── css/styles.css
│   ├── js/api.js           # fetch a /api/*
│   ├── js/calc.js          # reglas de la sección 5 (reutilizable)
│   ├── js/app.js
│   └── img/                # logos
└── netlify/functions/
    ├── login.mjs
    ├── logout.mjs
    ├── me.mjs
    ├── dashboard.mjs       # GET datos publicados + historial del mes
    ├── draft.mjs           # GET/PUT borrador (admin)
    ├── publish.mjs         # POST publicar (admin) + aviso Teams
    └── users.mjs           # GET/POST/PATCH usuarios (admin)
```

`netlify.toml`:
```toml
[build]
  publish = "public"
  functions = "netlify/functions"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

### 9.1 Datos (Netlify Blobs, store `ventas`)

| Clave             | Contenido |
|-------------------|-----------|
| `users`           | `[{ ci, nombre, rol, activo, pinHash, pinSalt, creado, intentosFallidos, bloqueadoHasta }]` |
| `draft`           | `{ corte, obj: {may,min,fgl,fbt}, real: {...}, actualizado, por }` |
| `published`       | `{ corte, obj, real, publicadoEn, por }` |
| `history/AAAA-MM` | `[{ corte, real, obj }]` — una entrada por fecha de corte; si se republica el mismo corte, se reemplaza |

Montos como enteros en guaraníes.

### 9.2 API

| Método | Ruta              | Rol    | Descripción |
|--------|-------------------|--------|-------------|
| POST   | `/api/login`      | —      | `{ci, pin}` → cookie de sesión |
| POST   | `/api/logout`     | todos  | borra cookie |
| GET    | `/api/me`         | todos  | `{ci, nombre, rol}` |
| GET    | `/api/dashboard`  | todos  | `published` + `history` del mes del corte |
| GET    | `/api/draft`      | admin  | borrador (si no hay, copia de publicado) |
| PUT    | `/api/draft`      | admin  | guarda borrador |
| POST   | `/api/publish`    | admin  | `{avisarTeams}` → copia borrador a publicado, actualiza historial, envía aviso |
| GET    | `/api/users`      | admin  | lista (sin hashes) |
| POST   | `/api/users`      | admin  | alta |
| PATCH  | `/api/users/:ci`  | admin  | `{activo}` o `{pin}` |

El dashboard del comercial refresca solo cada 60 s (y al volver a la pestaña) para ver publicaciones nuevas sin recargar.

### 9.3 Seguridad
- PIN guardado con `crypto.scrypt` + salt aleatorio; comparación con `timingSafeEqual`.
- Sesión: cookie `HttpOnly; Secure; SameSite=Lax`, token firmado con HMAC-SHA256 (`SESSION_SECRET`), expira en 12 h. El rol se verifica en **cada** función, nunca solo en el front.
- Bloqueo tras 5 PIN fallidos durante 15 minutos.
- Primer admin: se crea desde variables de entorno si `users` está vacío.

### 9.4 Variables de entorno (Netlify → Site settings → Environment variables)

| Variable              | Uso |
|-----------------------|-----|
| `SESSION_SECRET`      | firma de sesiones (cadena larga aleatoria) |
| `ADMIN_CI`            | cédula del primer administrador |
| `ADMIN_PIN`           | PIN inicial del primer administrador |
| `ADMIN_NOMBRE`        | nombre del primer administrador |
| `TEAMS_WEBHOOK_URL`   | URL del flujo de Teams (si falta, no se envía aviso) |
| `TEAMS_CANAL`         | nombre del canal para el mensaje de confirmación |
| `PORTAL_URL`          | URL pública del sitio para el botón del aviso |
### 9.5 Aviso a Teams
- Crear en Teams, en el canal elegido: **Workflows → "Publicar en un canal cuando se recibe una solicitud de webhook"**, copiar la URL → `TEAMS_WEBHOOK_URL`. (Los conectores clásicos "Incoming Webhook" de Office 365 están siendo retirados; usar Workflows.)
- `publish.mjs` hace `POST` con una **Adaptive Card**:
  - Título: "Reporte de ventas actualizado"
  - "Corte al DD/MM/AAAA · publicado por Nombre"
  - Dos datos: Avance total X% · Proyección al cierre Y%
  - Línea: "Baratote X% · Fineglass Y% · Fineboats Z%"
  - Botón "Abrir dashboard" → `PORTAL_URL`
- Si el envío falla, la publicación igual queda hecha y el aviso de la app dice "Publicado, pero no se pudo enviar el aviso a Teams."

## 10. Criterios de aceptación

1. Un comercial no puede acceder a `/api/draft`, `/api/publish` ni `/api/users` (403), aunque manipule el front.
2. Al publicar, otro navegador con un comercial ve los datos nuevos en ≤ 60 s sin recargar.
3. La proyección de Fineglass usa solo lunes a viernes; Baratote y Fineboats, todos los días.
4. Republicar la misma fecha de corte reemplaza el punto del historial, no lo duplica.
5. Usuario inactivo o PIN incorrecto no ingresa; 5 fallos bloquean 15 min.
6. Todo funciona en celular (≥ 360px) sin scroll horizontal de la página.
7. Sin paso de build: `public/` se sirve tal cual.

## 11. Deploy

```bash
npm install
npm i -g netlify-cli
netlify login
netlify init            # o netlify link si el sitio ya existe
netlify deploy --prod
```

Cargar las variables de entorno antes del primer deploy. Probar localmente con `netlify dev`.

## 12. Agregados posteriores

### 12.1 Días para la proyección (automático o manual)
- En Cargar ventas, tarjeta "Días para la proyección" con selector **Automático / Manual**.
- Automático: días según calendario de cada unidad (sección 5).
- Manual: el admin carga por unidad **Días del mes** y **Día en curso** (días operados hasta el corte). Al pasar a manual se precargan los del calendario.
- Validación manual: días del mes ≥ 1 y día en curso entre 1 y los días del mes.
- En manual, Baratote y el total usan los días de la unidad con mayor objetivo, y el ritmo ideal total es el promedio de cada unidad ponderado por objetivo.
- Se guarda en `draft`/`published`/`history` como `dias: { modo, may: {mes, curso}, ... }`.

### 12.2 Comparativa
- El admin carga por unidad la venta de cierre del **mes anterior** y del **mismo mes del año anterior** (`comp: { ant: {...}, aa: {...} }`). Vacío = sin dato.
- El dashboard compara la **proyección al cierre** del mes actual contra ambos: variación % por unidad, Baratote (con sus canales) y total, con barras. La tarjeta de Proyección y el aviso de Teams muestran la variación total.

### 12.3 Colores y torta
- Color por unidad: Mayorista `#DC2626`, Minorista `#F59E0B`, Fineglass `#0D9488`, Fineboats `#1D4ED8` (Baratote usa el rojo). Tono claro para la proyección.
- Evolución: columnas apiladas por unidad.
- "Composición de la venta": torta (dona) con la venta acumulada por canal, hecha con CSS `conic-gradient`.

### 12.4 Proyección al cierre destacada
- Reemplaza la tarjeta oscura de KPIs por una sección oscura de ancho completo, arriba del dashboard: monto proyectado grande, estado, brecha contra el objetivo, venta necesaria por día vs promedio actual, medidor semicircular (0–120%, marca blanca en 100%) y variación vs mes anterior y año anterior.
- Debajo, una mini tarjeta por unidad (Baratote, sus canales, Fineglass, Fineboats) con proyección, % del objetivo y variación vs mes anterior.

### 12.5 Prueba del aviso a Teams
- `GET /api/teams` (admin): si `TEAMS_WEBHOOK_URL` está configurado y el canal.
- `POST /api/teams` (admin): envía la tarjeta con lo publicado, marcada "AVISO DE PRUEBA".
- Panel "Aviso a Teams" en Cargar ventas con el estado y el botón **Enviar aviso de prueba**.

### 12.6 Minorista ponderado por día de la semana
- La venta minorista se concentra de viernes a domingo, así que en modo automático su proyección es `real / fracción`, donde `fracción` = suma de pesos de los días ya transcurridos ÷ suma de pesos de todos los días del mes. El ritmo ideal de Minorista es esa misma fracción.
- Pesos iniciales (% de la semana), del análisis de ventas por sucursal de octubre 2026, sin CENTRAL: lun 1,4 · mar 9,3 · mié 9,8 · jue 8,8 · vie 18,8 · sáb 27,7 · dom 24,2 (viernes a domingo ≈ 70,7%).
- Prueba con esos datos (proyectar el acumulado al día 22 desde cada corte): error promedio lineal 10,6% vs ponderado 2,7%.
- El admin edita los pesos en Cargar ventas ("Peso por día de la semana · Minorista"); si no suman 100 se reparten en proporción. Se guardan como `pesos` en draft/published/history.
- En modo manual de días no se pondera: se usan los días cargados.

### 12.7 Fineboats referencial
- Fineboats mantiene la proyección lineal, pero marcada como **Referencial** en todo el dashboard, porque sus ventas no siguen un ritmo diario. Igual suma en la proyección total.

### 12.8 Clima y Minorista ajustada por lluvia (referencial)
- `GET /api/clima` (cualquier usuario): pronóstico diario del área central (Asunción, -25,30 / -57,60) desde **MET Norway** (`api.met.no`, gratuito también para uso comercial; pide User-Agent identificado). Se guarda en Blobs (`clima`) y se renueva cada 3 h; si falla, sirve el último guardado.
- Dashboard: tarjeta "Clima para lo que queda del mes" con un recuadro por día (máxima, lluvia, peso del día en el mes de Minorista), los viernes a domingo resaltados y los días con lluvia ≥ 5 mm en azul.
- Proyección de Minorista **ajustada por lluvia**, marcada **Referencial**: a lo que falta del mes (según la ponderación) se le aplica ×0,89 en días con lluvia ≥ 5 mm y ×1,08 en días secos; días sin pronóstico quedan igual. Factores del análisis de octubre 2026 (lluvia vs venta por sucursal, cada día contra el promedio de su día de la semana, 19 días sin lunes: r = −0,50). No reemplaza la proyección principal ni suma en el total. No aplica con días en manual.

### 12.9 Solicitud de acceso con aprobación
- En el ingreso, "¿No tenés usuario? Solicitá acceso": el comercial carga cédula, nombre y apellido y PIN (dos veces). `POST /api/solicitud` (público) crea el usuario con `pendiente: true`, `activo: false`, rol Comercial.
- Mientras está pendiente no puede ingresar: "Tu solicitud todavía está pendiente…".
- Admin · Usuarios: tarjeta "Solicitudes pendientes" con **Aprobar** (`PATCH /api/users/:ci {aprobar: true}`) y **Rechazar** (`DELETE /api/users/:ci`, solo para pendientes). La pestaña Usuarios muestra el número de pendientes.
- Protección: máximo 5 solicitudes por hora por conexión (IP) y 100 pendientes en total. Si la cédula ya tiene usuario o una solicitud, se avisa sin crear otra.

### 12.10 Auditoría de conexiones
- Por usuario, en Blobs `actividad/<ci>`: `ultimoIngreso` (login con PIN), `ultimaActividad` (abrir el portal o ver el dashboard; se registra como mucho cada 10 min) e `ingresos` (cantidad de logins).
- Clave separada por usuario para no reescribir la lista `users` en cada visita.
- Admin · Usuarios: columna **Última conexión** ("recién", "hace 3 h", "ayer 14:20" o fecha y hora; en naranja si pasaron más de 7 días; "Nunca ingresó"), con la cantidad de ingresos y el detalle al pasar el mouse.
- Al eliminar un usuario se borra también su registro de actividad.

### 12.11 Ventas por sucursal (Baratote Minorista)
- Menú **Sucursales** (admin y comerciales). Los comerciales ven las pestañas Dashboard · Sucursales.
- Carga (solo admin): archivo CSV o filas pegadas de Excel con **sucursal, fecha, monto**, con o sin títulos. Acepta tabulado, `;` o `,`; fechas `AAAA-MM-DD`, `DD/MM/AAAA`, `DD/MM/AA`, número de serie de Excel, o solo el día eligiendo el mes (formato `SUCURSAL, Suma de MONTO, Día`). Montos en guaraníes con o sin puntos. Se revisa antes de guardar y se listan las líneas con problemas.
- Guardado en Blobs por mes: `sucursales/AAAA-MM` → `{ mes, filas: [{ sucursal, fecha, monto }], actualizado, por }`, índice `sucursales/index`. Al cargar, se **reemplazan completas las fechas incluidas** y se conserva el resto del mes. El admin puede borrar un mes.
- Vista: venta Minorista del mes, sucursales con venta, promedio por día y mejor día; gráfico de venta por día (viernes a domingo resaltados); peso por día de la semana del mes; ranking de sucursales con buscador y detalle día por día al tocar una fila.
- **CENTRAL** (Mayorista) se muestra aparte y no suma en Minorista (`NO_MINORISTA` en `public/js/sucursales.js`).
- Organización de la vista (para no tener que bajar tanto):
  - La tarjeta de carga empieza **plegada** (se abre sola si no hay datos).
  - Pestañas internas **Resumen · Ranking · Mapa de calor · Alertas** (se recuerda la última elegida en el navegador).
  - Resumen: indicadores, venta por día, peso por día de la semana y las 5 que más venden.
  - Ranking: 10 que más venden / 10 que menos / todas; el buscador busca en todas.
  - Mapa de calor: sucursales × días, cada sucursal en su propia escala (más oscuro = su mejor día; gris = sin venta).
  - Alertas: sin venta en los 2 últimos días cargados sin contar lunes; caídas y subas de 20% o más comparando la participación en los últimos 7 días contra los días anteriores del mes (desde 10 días cargados); 3 o más días sin venta en el mes sin contar lunes. El número de alertas se muestra en la pestaña.
  - **Comparar días** (`compararDias` y `mismoDiaSemana` en `public/js/sucursales.js`), sin CENTRAL:
    - *Un día contra otro*: dos fechas cualesquiera (pueden ser de meses distintos; el otro mes se pide al servidor). Total de cada día, sucursales con venta, diferencia y variación; tabla por sucursal con las 10 que más cayeron, las 10 que más subieron o todas, y buscador. Por defecto compara el último día completo contra el mismo día de la semana anterior; si el último cargado vendió menos del 30% de lo normal para ese día de la semana, se lo toma como incompleto y se avisa.
    - *Mismo día de la semana*: todos los lunes, martes… del mes, con el total y la variación contra el anterior, y la tabla por sucursal con cada fecha y la variación entre los dos últimos.
  - El detalle de una sucursal se abre en un **panel lateral** (pantalla completa en celular): puesto, venta, % del total, promedio por día, días con venta, comparación con el promedio de sucursales, venta por día, peso por día de la semana y sus alertas.
- La forma de fila `{ sucursal, fecha, monto }` es la que se va a migrar a una tabla en Supabase (etapa 5), donde se sumarán artículo, proveedor y marca.

### 12.12 Análisis del mes con IA (sin costo de API)
- Pestaña **Informe IA** en Sucursales. El portal **no llama a ninguna IA**: el administrador usa su propia suscripción de chat.
- Paso 1 (admin): **Copiar para Claude** copia al portapapeles las instrucciones del informe y un resumen del mes en JSON (`public/js/informe.js` → `armarContexto` + `textoParaCopiar`): totales, venta por día, peso por día de la semana, top y últimas 10, alertas, último día contra la semana anterior, mismos días del mes y, si son del mismo mes, los objetivos y la proyección publicados. No incluye las planillas completas. Botón **Abrir Claude** (claude.ai).
- Paso 2 (admin): pega la respuesta, ve la vista previa y la **publica**; puede reemplazarla o borrarla.
- Comerciales: ven el análisis publicado con formato (títulos `#`, viñetas `-` o `1.`, **negrita**), quién y cuándo lo publicó, y un aviso si se cargaron datos después.
- `GET /api/informe?mes=AAAA-MM` (todos), `POST /api/informe { mes, texto }` y `DELETE /api/informe?mes=` (admin). Blobs `informes/AAAA-MM` → `{ mes, texto, publicado, por, basadoEn }`. Máximo 20.000 caracteres.

## 13. Fuera de alcance (por ahora)
- Integración automática con el sistema de ventas (la carga es manual).
- Objetivos por comercial individual.
- Historial de meses anteriores en el dashboard (se guarda, pero no se muestra).
