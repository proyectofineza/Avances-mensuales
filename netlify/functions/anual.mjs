// Comparativo anual: ventas de todos los meses cerrados y el mes en curso.
// GET (todos) → { meses: { 'AAAA-MM': { min, may, fgl, fbt } }, fuentes: { 'AAAA-MM': 'planilla' | 'portal' | 'parcial' },
//                 enCurso: { mes, corte, real, proyeccion } | null }
// Meses cerrados: ver lib/meses.mjs (la misma fuente que la comparativa del dashboard).
//                 metas: { 'AAAA': { crecimiento, actualizado, por } }  objetivo anual = año anterior × (1 + crecimiento)
// POST { anio, crecimiento } (admin) → guarda el crecimiento del objetivo anual de ese año (crecimiento: 0,10 = +10%)
import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { mesesCerrados, unidades } from '../lib/meses.mjs';
import { hoyAsuncion, calcularReporte, IDS } from '../../public/js/calc.js';

export default handler(async (req) => {
  if (req.method === 'POST') {
    const user = await requireUser(req, ['admin']);
    const body = await readBody(req);
    const anio = Number(body.anio);
    const crecimiento = Number(body.crecimiento);
    const anioHoy = Number(hoyAsuncion().slice(0, 4));
    if (!Number.isInteger(anio) || anio < anioHoy - 1 || anio > anioHoy + 1) throw new HttpError(400, 'Año inválido.');
    if (!Number.isFinite(crecimiento) || crecimiento < -0.5 || crecimiento > 1) throw new HttpError(400, 'El crecimiento tiene que estar entre −50% y +100%.');
    const metas = await getJSON('metas-anuales', {});
    metas[anio] = { crecimiento: Math.round(crecimiento * 10000) / 10000, actualizado: new Date().toISOString(), por: user.nombre };
    await setJSON('metas-anuales', metas);
    return json({ metas });
  }
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido.');
  await requireUser(req);
  const mesHoy = hoyAsuncion().slice(0, 7);
  const [{ meses, fuentes }, published, metas] = await Promise.all([mesesCerrados(), getJSON('published'), getJSON('metas-anuales', {})]);

  // Mes en curso: lo publicado, si es de este mes (venta a la fecha y proyección al cierre).
  let enCurso = null;
  if (published?.corte?.startsWith(mesHoy)) {
    const r = calcularReporte(published);
    enCurso = {
      mes: mesHoy,
      corte: published.corte,
      real: unidades(published.real),
      proyeccion: Object.fromEntries(IDS.map((id) => [id, Math.round(r.unidades[id].proyeccion)])),
    };
  }
  return json({ meses, fuentes, enCurso, metas });
});

export const config = { path: '/api/anual' };
