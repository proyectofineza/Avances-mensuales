import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { IDS, hoyAsuncion, parseCorte } from '../../public/js/calc.js';

function montos(src = {}) {
  const out = {};
  for (const id of IDS) {
    const n = Math.round(Number(src[id]) || 0);
    out[id] = n > 0 ? n : 0;
  }
  return out;
}

export default handler(async (req) => {
  const user = await requireUser(req, ['admin']);

  if (req.method === 'GET') {
    const draft = await getJSON('draft');
    if (draft) return json(draft);
    const published = await getJSON('published');
    if (published) {
      return json({ corte: published.corte, obj: published.obj, real: published.real, actualizado: null, por: null });
    }
    return json({ corte: hoyAsuncion(), obj: montos(), real: montos(), actualizado: null, por: null });
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    const corte = body.corte && parseCorte(body.corte) ? body.corte : '';
    const draft = {
      corte,
      obj: montos(body.obj),
      real: montos(body.real),
      actualizado: new Date().toISOString(),
      por: user.nombre,
    };
    await setJSON('draft', draft);
    return json(draft);
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/draft' };
