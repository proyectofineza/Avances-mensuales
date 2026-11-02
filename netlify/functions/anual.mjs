// Comparativo anual: ventas de todos los meses cerrados y el mes en curso.
// GET (todos) → { meses: { 'AAAA-MM': { min, may, fgl, fbt } }, fuentes: { 'AAAA-MM': 'planilla' | 'portal' | 'parcial' },
//                 enCurso: { mes, corte, real, proyeccion } | null }
// Meses cerrados: ver lib/meses.mjs (la misma fuente que la comparativa del dashboard).
import { handler, json, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON } from '../lib/store.mjs';
import { mesesCerrados, unidades } from '../lib/meses.mjs';
import { hoyAsuncion, calcularReporte, IDS } from '../../public/js/calc.js';

export default handler(async (req) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido.');
  await requireUser(req);
  const mesHoy = hoyAsuncion().slice(0, 7);
  const [{ meses, fuentes }, published] = await Promise.all([mesesCerrados(), getJSON('published')]);

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
  return json({ meses, fuentes, enCurso });
});

export const config = { path: '/api/anual' };
