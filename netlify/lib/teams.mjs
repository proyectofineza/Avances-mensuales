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

// Devuelve { ok, detalle } — detalle explica el fallo para mostrarlo al admin.
export async function enviarTeams(published, opciones) {
  try {
    const res = await fetch(process.env.TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: armarTarjeta(published, opciones) }],
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
