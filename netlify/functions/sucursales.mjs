// Ventas por sucursal (Baratote Minorista), guardadas por mes en Blobs:
//   sucursales/AAAA-MM  → { mes, filas: [{ sucursal, fecha, monto }], actualizado, por }
//   sucursales/index    → ['AAAA-MM', ...]
// GET  ?mes=AAAA-MM  (todos)  → datos del mes (o del último cargado) y meses disponibles
// POST { filas, avisarTeams? } (admin) → reemplaza las fechas incluidas y deja el resto del mes;
//                    con avisarTeams manda las alertas del mes al canal de Teams
// DELETE ?mes=AAAA-MM (admin) → borra el mes
import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON, deleteKey } from '../lib/store.mjs';
import { parseCorte } from '../../public/js/calc.js';
import { normalizarSucursal, MAX_FILAS, resumirMes, alertasSucursales } from '../../public/js/sucursales.js';
import { teamsConfigurado, enviarTarjeta, tarjetaAlertasSucursales } from '../lib/teams.mjs';

const MES_RE = /^\d{4}-\d{2}$/;

async function meses() {
  return (await getJSON('sucursales/index', [])).sort();
}

export default handler(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    await requireUser(req);
    const disponibles = await meses();
    const pedido = url.searchParams.get('mes');
    const mes = pedido && MES_RE.test(pedido) ? pedido : disponibles.at(-1);
    const datos = mes ? await getJSON(`sucursales/${mes}`) : null;
    return json({ mes: mes || null, meses: disponibles, filas: datos?.filas || [], actualizado: datos?.actualizado || null, por: datos?.por || null });
  }

  const user = await requireUser(req, ['admin']);

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.filas) || !body.filas.length) throw new HttpError(400, 'No hay filas para guardar.');
    if (body.filas.length > MAX_FILAS) throw new HttpError(400, `El máximo por carga es ${MAX_FILAS} filas.`);

    // Validar y agrupar por mes.
    const porMes = new Map();
    for (const f of body.filas) {
      const sucursal = normalizarSucursal(f.sucursal);
      const monto = Math.round(Number(f.monto));
      if (!sucursal || !parseCorte(f.fecha) || !Number.isFinite(monto) || monto < 0) {
        throw new HttpError(400, 'Hay filas con datos inválidos. Revisá la planilla y volvé a intentar.');
      }
      const mes = f.fecha.slice(0, 7);
      if (!porMes.has(mes)) porMes.set(mes, []);
      porMes.get(mes).push({ sucursal, fecha: f.fecha, monto });
    }

    const ahora = new Date().toISOString();
    const resumen = [];
    for (const [mes, nuevas] of porMes) {
      const fechas = new Set(nuevas.map((f) => f.fecha));
      const actual = await getJSON(`sucursales/${mes}`, { filas: [] });
      const conservadas = actual.filas.filter((f) => !fechas.has(f.fecha));
      const filas = [...conservadas, ...nuevas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sucursal.localeCompare(b.sucursal));
      await setJSON(`sucursales/${mes}`, { mes, filas, actualizado: ahora, por: user.nombre });
      resumen.push({ mes, dias: fechas.size, filas: nuevas.length, reemplazadas: actual.filas.length - conservadas.length });
    }
    const index = new Set(await meses());
    porMes.forEach((_, mes) => index.add(mes));
    await setJSON('sucursales/index', [...index].sort());

    // Aviso opcional a Teams con las alertas del último mes cargado.
    let teams = null;
    if (body.avisarTeams) {
      if (!teamsConfigurado()) teams = { ok: false, detalle: 'Teams no está configurado.' };
      else {
        const mes = [...porMes.keys()].sort().at(-1);
        const { filas } = await getJSON(`sucursales/${mes}`, { filas: [] });
        const cerradas = (await getJSON('sucursales-cerradas', { filas: [] })).filas.map((f) => f.sucursal);
        teams = await enviarTarjeta(tarjetaAlertasSucursales(mes, alertasSucursales(resumirMes(filas), { cerradas }), user.nombre));
      }
    }
    return json({ ok: true, resumen, teams });
  }

  if (req.method === 'DELETE') {
    const mes = url.searchParams.get('mes');
    if (!mes || !MES_RE.test(mes)) throw new HttpError(400, 'Indicá el mes a borrar.');
    await deleteKey(`sucursales/${mes}`);
    await setJSON('sucursales/index', (await meses()).filter((m) => m !== mes));
    return json({ ok: true });
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/sucursales' };
