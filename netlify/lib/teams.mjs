// Aviso a un canal de Teams (Workflows → "solicitud de webhook") con una Adaptive Card.
import {
  calcularReporte, mesAnterior, mismoMesAnioAnterior, fmtFecha, fmtPct, fmtVar,
} from '../../public/js/calc.js';

export const teamsConfigurado = () => Boolean(process.env.TEAMS_WEBHOOK_URL);

export function armarTarjeta(published, { prueba = false } = {}) {
  const r = calcularReporte(published);
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      ...(prueba ? [{ type: 'TextBlock', text: 'AVISO DE PRUEBA', color: 'Attention', weight: 'Bolder', size: 'Small' }] : []),
      { type: 'TextBlock', text: 'Reporte de ventas actualizado', weight: 'Bolder', size: 'Large', wrap: true },
      { type: 'TextBlock', text: `Corte al ${fmtFecha(published.corte)} · publicado por ${published.por}`, isSubtle: true, spacing: 'None', wrap: true },
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
    ],
    actions: process.env.PORTAL_URL
      ? [{ type: 'Action.OpenUrl', title: 'Abrir dashboard', url: process.env.PORTAL_URL }]
      : [],
  };
}

// Alertas de sucursales tras cargar la planilla (alertas = alertasSucursales()).
export function tarjetaAlertasSucursales(mes, alertas, por) {
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
    ],
    actions: process.env.PORTAL_URL
      ? [{ type: 'Action.OpenUrl', title: 'Ver sucursales', url: new URL('/app#sucursales', process.env.PORTAL_URL).href }]
      : [],
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
