// Aviso a un canal de Teams (Workflows → "solicitud de webhook") con una Adaptive Card.
import {
  calcularReporte, mesAnterior, mismoMesAnioAnterior, fmtFecha, fmtFechaHora, fmtPct, fmtVar,
} from '../../public/js/calc.js';

export const teamsConfigurado = () => Boolean(process.env.TEAMS_WEBHOOK_URL);

// Link a una sección del portal. Base: PORTAL_URL si está cargada; si no, la dirección
// principal del sitio que da Netlify (URL) o la de la solicitud (origen).
export function enlacePortal(seccion, origen) {
  const base = process.env.PORTAL_URL || process.env.URL || origen;
  if (!base) return null;
  try { return new URL(`/app.html#${seccion}`, base).href; } catch { return null; }
}

// Link visible en el texto (por si la app de Teams no muestra los botones) y botón.
const conEnlace = (url, titulo) => (url ? {
  body: [{ type: 'TextBlock', text: `[${titulo} →](${url})`, wrap: true, spacing: 'Medium' }],
  actions: [{ type: 'Action.OpenUrl', title: titulo, url }],
} : { body: [], actions: [] });

export function armarTarjeta(published, { prueba = false, origen } = {}) {
  const r = calcularReporte(published);
  const enlace = conEnlace(enlacePortal('dashboard', origen), 'Ver el reporte');
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      ...(prueba ? [{ type: 'TextBlock', text: 'AVISO DE PRUEBA', color: 'Attention', weight: 'Bolder', size: 'Small' }] : []),
      { type: 'TextBlock', text: 'Reporte de ventas actualizado', weight: 'Bolder', size: 'Large', wrap: true },
      {
        type: 'TextBlock',
        text: `Ventas hasta el ${fmtFecha(published.corte)} · publicado${published.publicadoEn ? ` el ${fmtFechaHora(published.publicadoEn)}` : ''} por ${published.por}`,
        isSubtle: true, spacing: 'None', wrap: true,
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Avance total', value: fmtPct(r.total.avance) },
          { title: 'Proyección al cierre', value: fmtPct(r.total.proyeccionPct) },
        ],
      },
      {
        type: 'TextBlock',
        text: `Baratote ${fmtPct(r.baratote.avance)} · Fineglass ${fmtPct(r.unidades.fgl.avance)} · Fineboats ${fmtPct(r.unidades.fbt.avance)}`,
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `Baratote por canal: Mayorista ${fmtPct(r.unidades.may.avance)} · Minorista ${fmtPct(r.unidades.min.avance)}`,
        isSubtle: true,
        spacing: 'None',
        wrap: true,
      },
      ...(r.total.varAnt !== null || r.total.varAa !== null ? [{
        type: 'TextBlock',
        text: `Proyección vs ${mesAnterior(published.corte)}: ${fmtVar(r.total.varAnt)} · vs ${mismoMesAnioAnterior(published.corte)}: ${fmtVar(r.total.varAa)}`,
        wrap: true,
      }] : []),
      ...enlace.body,
    ],
    actions: enlace.actions,
  };
}

// Alertas de sucursales tras cargar la planilla (alertas = alertasSucursales()).
export function tarjetaAlertasSucursales(mes, alertas, por, origen) {
  const enlace = conEnlace(enlacePortal('sucursales', origen), 'Ver sucursales');
  const lista = (arr, fmt) => arr.slice(0, 8).map(fmt).join(' · ') + (arr.length > 8 ? ` y ${arr.length - 8} más` : '');
  const bloque = (titulo, arr, fmt, color) => (arr.length ? [
    { type: 'TextBlock', text: `${titulo} (${arr.length})`, weight: 'Bolder', color, wrap: true, spacing: 'Medium' },
    { type: 'TextBlock', text: lista(arr, fmt), wrap: true, spacing: 'None' },
  ] : []);
  const [y, m] = mes.split('-');
  const sinNada = !alertas.sinVentaReciente.length && !alertas.caidas.length;
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: 'Ventas por sucursal actualizadas', weight: 'Bolder', size: 'Large', wrap: true },
      { type: 'TextBlock', text: `Baratote Minorista · ${m}/${y} · cargado por ${por}`, isSubtle: true, spacing: 'None', wrap: true },
      ...(sinNada ? [{ type: 'TextBlock', text: 'Sin alertas: todas las sucursales vendieron en los últimos días y ninguna viene cayendo.', wrap: true }] : []),
      ...bloque('Sin venta en los últimos días', alertas.sinVentaReciente, (s) => s.sucursal, 'Attention'),
      ...bloque('Vienen vendiendo menos', alertas.caidas, (s) => `${s.sucursal} ${fmtVar(s.variacion)}`, 'Warning'),
      ...bloque('Vienen creciendo', alertas.crecen, (s) => `${s.sucursal} ${fmtVar(s.variacion)}`, 'Good'),
      ...enlace.body,
    ],
    actions: enlace.actions,
  };
}

// Devuelve { ok, detalle } — detalle explica el fallo para mostrarlo al admin.
export function enviarTeams(published, opciones) {
  return enviarTarjeta(armarTarjeta(published, opciones));
}

export async function enviarTarjeta(tarjeta) {
  try {
    const res = await fetch(process.env.TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: tarjeta }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      console.error('Teams respondió', res.status, texto);
      return { ok: false, detalle: `Teams respondió con el código ${res.status}.` };
    }
    return { ok: true };
  } catch (err) {
    console.error('Error enviando a Teams', err);
    return { ok: false, detalle: 'No se pudo conectar con Teams. Revisá la URL del webhook.' };
  }
}
