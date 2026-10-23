import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON, deleteKey } from '../lib/store.mjs';
import { normalizarReporte, validarReporte } from '../../public/js/calc.js';
import { teamsConfigurado, enviarTeams } from '../lib/teams.mjs';

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
  await setJSON('published', published);

  // Historial del mes: un punto por fecha de corte (se reemplaza si se republica).
  const key = `history/${published.corte.slice(0, 7)}`;
  const history = (await getJSON(key, [])).filter((h) => h.corte !== published.corte);
  history.push({ corte: published.corte, real: published.real, obj: published.obj, dias: published.dias });
  history.sort((a, b) => a.corte.localeCompare(b.corte));
  await setJSON(key, history);

  await deleteKey('draft');

  let teams = 'omitido';
  if (body.avisarTeams && teamsConfigurado()) {
    teams = (await enviarTeams(published)).ok ? 'enviado' : 'error';
  }

  return json({ published, teams, canal: process.env.TEAMS_CANAL || '' });
});

export const config = { path: '/api/publish' };
