// Cierre de mes: el último reporte publicado de un mes y cómo evolucionó.
// GET ?mes=AAAA-MM (todos) → { mes, meses, reporte, history }
//   Sin mes: el mes anterior al actual (si tiene datos) o el último mes cerrado.
//   reporte: cierre/AAAA-MM; si no está (meses publicados antes de que existiera),
//   lo publicado si es de ese mes, o el último punto del historial (sin comparativa).
import { handler, json, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, store } from '../lib/store.mjs';
import { mesesCerrados, conComparativa } from '../lib/meses.mjs';
import { hoyAsuncion } from '../../public/js/calc.js';

const MES_RE = /^\d{4}-\d{2}$/;

export default handler(async (req) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido.');
  await requireUser(req);

  const { blobs } = await store().list({ prefix: 'history/' });
  const meses = blobs.map((b) => b.key.slice('history/'.length)).filter((m) => MES_RE.test(m)).sort();
  const hoy = hoyAsuncion().slice(0, 7);
  const pedido = new URL(req.url).searchParams.get('mes');
  const mes = pedido && MES_RE.test(pedido) ? pedido : meses.filter((m) => m < hoy).at(-1) || meses.at(-1) || null;
  if (!mes) return json({ mes: null, meses, reporte: null, history: [] });

  const [cierre, published, history, { meses: cerrados }] = await Promise.all([
    getJSON(`cierre/${mes}`),
    getJSON('published'),
    getJSON(`history/${mes}`, []),
    mesesCerrados(),
  ]);
  let reporte = cierre;
  if (!reporte && published?.corte?.startsWith(mes)) reporte = published;
  if (!reporte && history.length) reporte = { ...history.at(-1), sinComparativa: true };
  // Si después se republicó una fecha más alta del historial, gana esa (por las dudas).
  if (reporte && history.length && history.at(-1).corte > reporte.corte) reporte = { ...history.at(-1), comp: reporte.comp };
  // La comparativa sale de los mismos meses cerrados que el Comparativo anual.
  return json({ mes, meses, reporte: conComparativa(reporte, cerrados), history });
});

export const config = { path: '/api/cierre' };
