// Datos fijos de las sucursales (Baratote Minorista):
//   sucursales-maestro          → { filas: [{ sucursal, zona, encargado }], actualizado, por }
//   sucursales-objetivos/AAAA-MM → { mes, filas: [{ sucursal, objetivo }], actualizado, por }
//   sucursales-cerradas          → { filas: [{ sucursal, fecha, por }] }
// GET  ?mes=AAAA-MM (todos)                → { maestro, objetivos, cerradas }
// POST { tipo: 'maestro', filas }  (admin) → reemplaza el listado maestro
// POST { tipo: 'objetivos', mes, filas } (admin) → reemplaza los objetivos del mes
// POST { tipo: 'cerrada', sucursal, fecha } (admin) → marca la sucursal como cerrada desde esa fecha;
//      con fecha null la vuelve a abrir
import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { normalizarSucursal } from '../../public/js/sucursales.js';
import { parseCorte } from '../../public/js/calc.js';

const MES_RE = /^\d{4}-\d{2}$/;
const MAX = 2000;
const texto = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);

export default handler(async (req) => {
  if (req.method === 'GET') {
    await requireUser(req);
    const mes = new URL(req.url).searchParams.get('mes');
    const [maestro, objetivos, cerradas] = await Promise.all([
      getJSON('sucursales-maestro'),
      mes && MES_RE.test(mes) ? getJSON(`sucursales-objetivos/${mes}`) : null,
      getJSON('sucursales-cerradas', { filas: [] }),
    ]);
    return json({ maestro, objetivos, cerradas: cerradas.filas });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  const user = await requireUser(req, ['admin']);
  const body = await readBody(req);

  if (body.tipo === 'cerrada') {
    const sucursal = normalizarSucursal(body.sucursal);
    if (!sucursal) throw new HttpError(400, 'Indicá la sucursal.');
    if (body.fecha !== null && !parseCorte(body.fecha)) throw new HttpError(400, 'Indicá la fecha de cierre.');
    const actual = await getJSON('sucursales-cerradas', { filas: [] });
    const filas = actual.filas.filter((f) => f.sucursal !== sucursal);
    if (body.fecha) filas.push({ sucursal, fecha: body.fecha, por: user.nombre });
    filas.sort((a, b) => a.sucursal.localeCompare(b.sucursal));
    await setJSON('sucursales-cerradas', { filas });
    return json({ ok: true, cerradas: filas });
  }

  if (!Array.isArray(body.filas)) throw new HttpError(400, 'No hay filas para guardar.');
  if (body.filas.length > MAX) throw new HttpError(400, `El máximo es ${MAX} sucursales.`);
  const ahora = new Date().toISOString();

  // Una fila por sucursal: si se repite, gana la última.
  const unicas = (filas) => [...new Map(filas.map((f) => [f.sucursal, f])).values()].sort((a, b) => a.sucursal.localeCompare(b.sucursal));

  if (body.tipo === 'maestro') {
    const filas = unicas(body.filas
      .map((f) => ({ sucursal: normalizarSucursal(f.sucursal), zona: texto(f.zona).toUpperCase(), encargado: texto(f.encargado) }))
      .filter((f) => f.sucursal));
    await setJSON('sucursales-maestro', { filas, actualizado: ahora, por: user.nombre });
    return json({ ok: true, cantidad: filas.length });
  }

  if (body.tipo === 'objetivos') {
    if (!body.mes || !MES_RE.test(body.mes)) throw new HttpError(400, 'Indicá el mes de los objetivos.');
    const filas = unicas(body.filas
      .map((f) => ({ sucursal: normalizarSucursal(f.sucursal), objetivo: Math.round(Number(f.objetivo)) }))
      .filter((f) => f.sucursal && Number.isFinite(f.objetivo) && f.objetivo > 0));
    await setJSON(`sucursales-objetivos/${body.mes}`, { mes: body.mes, filas, actualizado: ahora, por: user.nombre });
    return json({ ok: true, cantidad: filas.length });
  }

  throw new HttpError(400, 'Tipo de datos desconocido.');
});

export const config = { path: '/api/sucursales-config' };
