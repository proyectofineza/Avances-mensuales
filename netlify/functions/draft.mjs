import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { hoyAsuncion, normalizarReporte } from '../../public/js/calc.js';

export default handler(async (req) => {
  const user = await requireUser(req, ['admin']);

  if (req.method === 'GET') {
    const draft = await getJSON('draft');
    if (draft) return json({ ...normalizarReporte(draft), actualizado: draft.actualizado, por: draft.por });
    const published = await getJSON('published');
    if (published) return json({ ...normalizarReporte(published), actualizado: null, por: null });
    return json({ ...normalizarReporte({ corte: hoyAsuncion() }), actualizado: null, por: null });
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    const draft = { ...normalizarReporte(body), actualizado: new Date().toISOString(), por: user.nombre };
    await setJSON('draft', draft);
    return json(draft);
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/draft' };
