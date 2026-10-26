// Análisis del mes que el administrador arma en su chat de IA y pega en el portal.
// Se guarda en Blobs: informes/AAAA-MM → { mes, texto, publicado, por, basadoEn }
// GET    ?mes=AAAA-MM (todos) → análisis publicado y si los datos cambiaron después
// POST   { mes, texto } (admin) → publica (o reemplaza) el análisis
// DELETE ?mes=AAAA-MM  (admin) → lo borra
import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON, deleteKey } from '../lib/store.mjs';
import { MAX_TEXTO } from '../../public/js/informe.js';

const MES_RE = /^\d{4}-\d{2}$/;

function mesValido(mes) {
  if (!mes || !MES_RE.test(mes)) throw new HttpError(400, 'Indicá el mes.');
  return mes;
}

export default handler(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    await requireUser(req);
    const mes = mesValido(url.searchParams.get('mes'));
    const [informe, datos] = await Promise.all([getJSON(`informes/${mes}`), getJSON(`sucursales/${mes}`)]);
    return json({ informe, desactualizado: Boolean(informe && datos && informe.basadoEn !== datos.actualizado) });
  }

  const user = await requireUser(req, ['admin']);

  if (req.method === 'POST') {
    const body = await readBody(req);
    const mes = mesValido(body.mes);
    const texto = String(body.texto ?? '').replace(/\r\n/g, '\n').trim();
    if (!texto) throw new HttpError(400, 'Pegá el análisis antes de publicarlo.');
    if (texto.length > MAX_TEXTO) throw new HttpError(400, `El análisis es muy largo (máximo ${MAX_TEXTO.toLocaleString('es-PY')} caracteres).`);
    const datos = await getJSON(`sucursales/${mes}`);
    const informe = { mes, texto, publicado: new Date().toISOString(), por: user.nombre, basadoEn: datos?.actualizado || null };
    await setJSON(`informes/${mes}`, informe);
    return json({ informe, desactualizado: false });
  }

  if (req.method === 'DELETE') {
    await deleteKey(`informes/${mesValido(url.searchParams.get('mes'))}`);
    return json({ ok: true });
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/informe' };
