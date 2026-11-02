// Ventas de los meses cerrados: la misma fuente para el Comparativo anual y la comparativa del dashboard.
// La planilla cargada (historia-mensual) manda; si un mes no está, el cierre del portal (cierre/AAAA-MM).
// Un cierre que no llega al último día se marca "parcial".
import { getJSON, store } from './store.mjs';
import { hoyAsuncion, esUltimoDiaDelMes, IDS } from '../../public/js/calc.js';

const MES_RE = /^\d{4}-\d{2}$/;
export const unidades = (o = {}) => Object.fromEntries(IDS.filter((id) => o[id] !== undefined && o[id] !== null).map((id) => [id, Math.round(Number(o[id]) || 0)]));

// → { meses: { 'AAAA-MM': { min, may, fgl, fbt } }, fuentes: { 'AAAA-MM': 'planilla' | 'portal' | 'parcial' } }
export async function mesesCerrados() {
  const mesHoy = hoyAsuncion().slice(0, 7);
  const [historia, { blobs }] = await Promise.all([getJSON('historia-mensual', {}), store().list({ prefix: 'cierre/' })]);
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
  return { meses, fuentes };
}

const desplazar = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// El reporte con la comparativa (mes anterior y mismo mes del año anterior) tomada de los meses
// cerrados; lo cargado a mano queda solo para las unidades que esos meses no tienen.
export function conComparativa(rep, meses) {
  if (!rep?.corte) return rep;
  const mes = rep.corte.slice(0, 7);
  const comp = { ant: { ...rep.comp?.ant }, aa: { ...rep.comp?.aa } };
  let usados = 0;
  for (const [clave, m] of [['ant', desplazar(mes, -1)], ['aa', desplazar(mes, -12)]]) {
    for (const [id, v] of Object.entries(meses[m] || {})) { comp[clave][id] = v; usados++; }
  }
  if (!usados) return rep;
  const { sinComparativa, ...resto } = rep;
  return { ...resto, comp };
}
