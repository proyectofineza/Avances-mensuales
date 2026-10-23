import { handler, json, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON } from '../lib/store.mjs';

export default handler(async (req) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido.');
  await requireUser(req);
  const published = await getJSON('published');
  const history = published ? await getJSON(`history/${published.corte.slice(0, 7)}`, []) : [];
  return json({ published, history });
});

export const config = { path: '/api/dashboard' };
