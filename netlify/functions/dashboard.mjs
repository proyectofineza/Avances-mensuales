import { handler, json, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, registrarActividad } from '../lib/store.mjs';
import { mesesCerrados, conComparativa } from '../lib/meses.mjs';

export default handler(async (req) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido.');
  const user = await requireUser(req);
  await registrarActividad(user.ci);
  const published = await getJSON('published');
  if (!published) return json({ published, history: [] });
  // La comparativa sale de los mismos meses cerrados que el Comparativo anual.
  const [history, { meses }] = await Promise.all([getJSON(`history/${published.corte.slice(0, 7)}`, []), mesesCerrados()]);
  return json({ published: conComparativa(published, meses), history });
});

export const config = { path: '/api/dashboard' };
