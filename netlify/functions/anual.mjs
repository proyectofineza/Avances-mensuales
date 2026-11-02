// Comparativo anual: ventas de todos los meses cerrados y el mes en curso.
// GET (todos) → { meses: { 'AAAA-MM': { min, may, fgl, fbt } }, fuentes: { 'AAAA-MM': 'planilla' | 'portal' | 'parcial' },
//                 enCurso: { mes, corte, real, proyeccion } | null }
// Meses cerrados: la planilla cargada (historia-mensual) manda; si un mes no está, el cierre del
// portal (cierre/AAAA-MM). Un cierre que no llega al último día se marca "parcial".
import { handler, json, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, store } from '../lib/store.mjs';
import { hoyAsuncion, calcularReporte, esUltimoDiaDelMes, IDS } from '../../public/js/calc.js';

const MES_RE = /^\d{4}-\d{2}$/;
const unidades = (o = {}) => Object.fromEntries(IDS.filter((id) => o[id] !== undefined && o[id] !== null).map((id) => [id, Math.round(Number(o[id]) || 0)]));

export default handler(async (req) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido.');
  await requireUser(req);
  const mesHoy = hoyAsuncion().slice(0, 7);

  const [historia, published, { blobs }] = await Promise.all([
    getJSON('historia-mensual', {}),
    getJSON('published'),
    store().list({ prefix: 'cierre/' }),
  ]);
  const meses = {}, fuentes = {};
  for (const [mes, v] of Object.entries(historia)) {
    if (!MES_RE.test(mes) || mes >= mesHoy) continue;
    const u = unidades(v);
    if (Object.keys(u).length) { meses[mes] = u; fuentes[mes] = 'planilla'; }
  }
  const delPortal = blobs.map((b) => b.key.slice('cierre/'.length)).filter((m) => MES_RE.test(m) && m < mesHoy && !meses[m]);
  const cierres = await Promise.all(delPortal.map((m) => getJSON(`cierre/${m}`)));
  cierres.forEach((c, i) => {
    if (!c?.real) return;
    meses[delPortal[i]] = unidades(c.real);
    fuentes[delPortal[i]] = esUltimoDiaDelMes(c.corte) ? 'portal' : 'parcial';
  });

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
