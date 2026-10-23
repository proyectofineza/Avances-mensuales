import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON, deleteKey } from '../lib/store.mjs';
import { UNIDADES, parseCorte, calcularReporte, fmtFecha, fmtPct } from '../../public/js/calc.js';

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  const user = await requireUser(req, ['admin']);
  const body = await readBody(req);

  const draft = (await getJSON('draft')) || (await getJSON('published'));
  if (!draft) throw new HttpError(400, 'No hay datos para publicar.');
  if (!draft.corte || !parseCorte(draft.corte)) throw new HttpError(400, 'Indicá la fecha de corte.');
  for (const u of UNIDADES) {
    if (!(draft.obj?.[u.id] > 0)) throw new HttpError(400, `Falta el objetivo mensual de ${u.nombre}.`);
  }

  const published = {
    corte: draft.corte,
    obj: draft.obj,
    real: draft.real,
    publicadoEn: new Date().toISOString(),
    por: user.nombre,
  };
  await setJSON('published', published);

  // Historial del mes: un punto por fecha de corte (se reemplaza si se republica).
  const key = `history/${published.corte.slice(0, 7)}`;
  const history = (await getJSON(key, [])).filter((h) => h.corte !== published.corte);
  history.push({ corte: published.corte, real: published.real, obj: published.obj });
  history.sort((a, b) => a.corte.localeCompare(b.corte));
  await setJSON(key, history);

  await deleteKey('draft');

  let teams = 'omitido';
  if (body.avisarTeams && process.env.TEAMS_WEBHOOK_URL) {
    teams = (await enviarTeams(published)) ? 'enviado' : 'error';
  }

  return json({ published, teams, canal: process.env.TEAMS_CANAL || '' });
});

async function enviarTeams(published) {
  const r = calcularReporte(published);
  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
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
    ],
    actions: process.env.PORTAL_URL
      ? [{ type: 'Action.OpenUrl', title: 'Abrir dashboard', url: process.env.PORTAL_URL }]
      : [],
  };

  try {
    const res = await fetch(process.env.TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error('Teams respondió', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (err) {
    console.error('Error enviando a Teams', err);
    return false;
  }
}

export const config = { path: '/api/publish' };
