import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON, deleteKey } from '../lib/store.mjs';
import { normalizarReporte, validarReporte } from '../../public/js/calc.js';
import { teamsConfigurado, enviarTeams } from '../lib/teams.mjs';
import { mesesCerrados, conComparativa } from '../lib/meses.mjs';

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  const user = await requireUser(req, ['admin']);
  const body = await readBody(req);

  const fuente = (await getJSON('draft')) || (await getJSON('published'));
  if (!fuente) throw new HttpError(400, 'No hay datos para publicar.');
  const draft = normalizarReporte(fuente);
  const error = validarReporte(draft);
  if (error) throw new HttpError(400, error);

  const published = {
    ...draft,
    publicadoEn: new Date().toISOString(),
    por: user.nombre,
  };
  const mes = published.corte.slice(0, 7);
  const anterior = await getJSON('published');
  const mesAnterior = anterior?.corte?.slice(0, 7);

  // Cierre de cada mes (cierre/AAAA-MM): el reporte completo con la fecha de corte más alta,
  // comparativa incluida. Antes de pasar a otro mes se guarda el último publicado del que termina.
  const guardarCierre = async (rep) => {
    const k = `cierre/${rep.corte.slice(0, 7)}`;
    const actual = await getJSON(k);
    if (!actual || actual.corte <= rep.corte) await setJSON(k, rep);
  };
  if (anterior && mesAnterior !== mes) await guardarCierre(anterior);
  await guardarCierre(published);

  // Publicar el cierre de un mes ya pasado no mueve el dashboard hacia atrás.
  const actualizaDashboard = !mesAnterior || mes >= mesAnterior;
  if (actualizaDashboard) await setJSON('published', published);

  // Historial del mes: un punto por fecha de corte (se reemplaza si se republica).
  const key = `history/${mes}`;
  const history = (await getJSON(key, [])).filter((h) => h.corte !== published.corte);
  history.push({
    corte: published.corte, real: published.real, obj: published.obj, dias: published.dias, pesos: published.pesos,
    publicadoEn: published.publicadoEn, por: published.por,
  });
  history.sort((a, b) => a.corte.localeCompare(b.corte));
  await setJSON(key, history);

  await deleteKey('draft');

  let teams = 'omitido';
  if (body.avisarTeams && teamsConfigurado()) {
    const { meses } = await mesesCerrados();
    teams = (await enviarTeams(conComparativa(published, meses), { origen: new URL(req.url).origin })).ok ? 'enviado' : 'error';
  }

  return json({ published, actualizaDashboard, teams, canal: process.env.TEAMS_CANAL || '' });
});

export const config = { path: '/api/publish' };
