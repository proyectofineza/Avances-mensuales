// Ventas por sucursal (Baratote Minorista), guardadas por mes en Blobs:
//   sucursales/AAAA-MM  → { mes, filas: [{ sucursal, fecha, monto }], comerciales, madrugada, actualizado, por }
//       fecha = día comercial cuando la planilla trajo la hora (ver public/js/dia-comercial.js);
//       comerciales: días cargados con hora; madrugada: { fecha: { SUC: monto } } sumado desde el archivo del día siguiente
//   sucursales-horas/AAAA-MM → { mes, horas: { fecha: { SUC: { franja: monto } } } } detalle por media hora (auditoría)
//   sucursales/index    → ['AAAA-MM', ...]
// GET  ?mes=AAAA-MM[&horas=1] (todos) → datos del mes (o del último cargado), meses disponibles y, si se pide, el detalle por hora
// POST { filas, avisarTeams?, horas?, anteriores?, ultimaFecha? } (admin) → reemplaza las fechas incluidas y deja el
//      resto del mes; los días de `anteriores` (solo la madrugada) se suman sin reemplazar el día.
//      Con avisarTeams manda las alertas del mes al canal de Teams.
// DELETE ?mes=AAAA-MM (admin) → borra el mes
import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON, deleteKey } from '../lib/store.mjs';
import { parseCorte } from '../../public/js/calc.js';
import { normalizarSucursal, MAX_FILAS, resumirMes, alertasSucursales } from '../../public/js/sucursales.js';
import { teamsConfigurado, enviarTarjeta, tarjetaAlertasSucursales } from '../lib/teams.mjs';
import { actualizarMensual } from '../lib/sucursal-acceso.mjs';
import { fusionarMes, validarHoras } from '../../public/js/dia-comercial.js';

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
    const [datos, detalle] = mes
      ? await Promise.all([getJSON(`sucursales/${mes}`), url.searchParams.get('horas') ? getJSON(`sucursales-horas/${mes}`) : null])
      : [null, null];
    return json({
      mes: mes || null, meses: disponibles, filas: datos?.filas || [], actualizado: datos?.actualizado || null, por: datos?.por || null,
      comerciales: datos?.comerciales || [], madrugada: datos?.madrugada || {}, ...(detalle !== null ? { horas: detalle?.horas || {} } : {}),
    });
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

    // Carga con hora (día comercial): detalle por media hora, días que vienen solo en parte y último día del archivo.
    const okHoras = validarHoras(body.horas);
    if (okHoras === false) throw new HttpError(400, 'El detalle por hora no es válido. Volvé a revisar la planilla.');
    const comercial = okHoras === true;
    const anteriores = Array.isArray(body.anteriores) ? body.anteriores.filter((f) => parseCorte(f)) : [];
    const ultimaFecha = parseCorte(body.ultimaFecha) ? body.ultimaFecha : null;
    const horasDe = (mes) => {
      if (!comercial) return null;
      const out = {};
      for (const [fecha, dia] of Object.entries(body.horas)) {
        if (!fecha.startsWith(mes)) continue;
        out[fecha] = Object.fromEntries(Object.entries(dia).map(([s, fr]) => [normalizarSucursal(s), fr]));
      }
      return out;
    };

    const ahora = new Date().toISOString();
    const resumen = [];
    for (const [mes, nuevas] of porMes) {
      const [actual, detalle] = await Promise.all([getJSON(`sucursales/${mes}`, { filas: [] }), getJSON(`sucursales-horas/${mes}`, { horas: {} })]);
      const r = fusionarMes({ ...actual, horas: detalle.horas }, nuevas, {
        anteriores: anteriores.filter((f) => f.startsWith(mes)), ultimaFecha, horas: horasDe(mes), comercial,
      });
      await setJSON(`sucursales/${mes}`, { mes, filas: r.filas, comerciales: r.comerciales, madrugada: r.madrugada, actualizado: ahora, por: user.nombre });
      if (comercial || Object.keys(detalle.horas).length) await setJSON(`sucursales-horas/${mes}`, { mes, horas: r.horas, actualizado: ahora });
      await actualizarMensual(mes, r.filas);
      resumen.push({ mes, dias: r.dias, parciales: r.parciales, filas: nuevas.length, reemplazadas: r.reemplazadas });
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
        teams = await enviarTarjeta(tarjetaAlertasSucursales(mes, alertasSucursales(resumirMes(filas), { cerradas }), user.nombre, url.origin));
      }
    }
    return json({ ok: true, resumen, teams });
  }

  if (req.method === 'DELETE') {
    const mes = url.searchParams.get('mes');
    if (!mes || !MES_RE.test(mes)) throw new HttpError(400, 'Indicá el mes a borrar.');
    await deleteKey(`sucursales/${mes}`);
    await deleteKey(`sucursales-horas/${mes}`);
    await actualizarMensual(mes, null);
    await setJSON('sucursales/index', (await meses()).filter((m) => m !== mes));
    return json({ ok: true });
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/sucursales' };
