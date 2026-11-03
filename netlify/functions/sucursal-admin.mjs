// Administración del portal de sucursales (admin).
// GET  → { accesos: [...], historia: { meses, sucursales } }
// POST { tipo: 'pin', sucursal, pin }                → crea el acceso o cambia el PIN (cierra las sesiones abiertas)
// POST { tipo: 'codigo', sucursal }                  → código de 8 dígitos, 30 minutos, para autorizar un equipo
// POST { tipo: 'equipo', sucursal, id, exigeGps }    → exigir o no la ubicación a ese equipo
// POST { tipo: 'equipo', sucursal, id, quitar: true } → quita el equipo (ya no puede ingresar)
// POST { tipo: 'ubicacion', sucursal, lat, lng, radio } → ubicación y radio del local
// POST { tipo: 'activo', sucursal, activo }
// POST { tipo: 'historial', registros: { 'AAAA-MM': { SUCURSAL: monto } } } → ventas mensuales de meses anteriores
import { handler, json, readBody, requireUser, HttpError, hashPin } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { listarAccesos, getAcceso, setAcceso, accesoPublico, nuevoCodigo } from '../lib/sucursal-acceso.mjs';
import { normalizarSucursal } from '../../public/js/sucursales.js';
import { leerPosicion, RADIO_DEFECTO } from '../../public/js/portal-sucursal.js';
import { hoyAsuncion } from '../../public/js/calc.js';

const MES_RE = /^\d{4}-\d{2}$/;
const CODIGO_MIN = 30;

export default handler(async (req) => {
  const user = await requireUser(req, ['admin']);

  if (req.method === 'GET') {
    const [accesos, historia] = await Promise.all([listarAccesos(), getJSON('suc-historia', {})]);
    const meses = Object.keys(historia).sort();
    const sucursales = new Set(meses.flatMap((m) => Object.keys(historia[m])));
    return json({
      accesos: accesos.map(accesoPublico).sort((a, b) => a.sucursal.localeCompare(b.sucursal)),
      historia: { meses, sucursales: sucursales.size },
    });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  const body = await readBody(req);

  if (body.tipo === 'historial') {
    const registros = Object.entries(body.registros || {}).filter(([m]) => MES_RE.test(m) && m < hoyAsuncion().slice(0, 7));
    if (!registros.length) throw new HttpError(400, 'La planilla no tiene meses anteriores al actual.');
    const historia = await getJSON('suc-historia', {});
    let celdas = 0;
    for (const [mes, porSuc] of registros) {
      const destino = historia[mes] || {};
      for (const [s, v] of Object.entries(porSuc || {})) {
        const suc = normalizarSucursal(s);
        const monto = Math.round(Number(v));
        if (!suc || !Number.isFinite(monto) || monto < 0) continue;
        destino[suc] = monto;
        celdas++;
      }
      historia[mes] = destino;
    }
    await setJSON('suc-historia', historia);
    return json({ ok: true, meses: registros.length, celdas });
  }

  const sucursal = normalizarSucursal(body.sucursal);
  if (!sucursal) throw new HttpError(400, 'Indicá la sucursal.');
  const actual = await getAcceso(sucursal);
  const ahora = new Date().toISOString();

  if (body.tipo === 'pin') {
    const pin = String(body.pin || '');
    if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'El PIN debe tener de 4 a 6 dígitos.');
    const { hash, salt } = await hashPin(pin);
    const acceso = {
      sucursal, activo: true, radio: RADIO_DEFECTO, ubicacion: null, equipos: [], ingresos: [], creado: ahora,
      ...actual,
      pinHash: hash, pinSalt: salt, pinVer: (actual?.pinVer || 0) + 1, pinCambiado: ahora, pinPor: user.nombre,
      intentosFallidos: 0, bloqueadoHasta: null,
    };
    await setAcceso(sucursal, acceso);
    return json({ acceso: accesoPublico(acceso), mensaje: actual ? `Se cambió el PIN de ${sucursal}. Las sesiones abiertas se cerraron.` : `${sucursal} ya tiene acceso. Ahora autorizá el equipo del local.` });
  }

  if (!actual) throw new HttpError(400, 'Primero asigná un PIN a la sucursal.');

  if (body.tipo === 'codigo') {
    const codigo = nuevoCodigo();
    const exp = Date.now() + CODIGO_MIN * 60e3;
    await setJSON(`suc-codigo/${codigo}`, { sucursal, exp, por: user.nombre });
    return json({ codigo, vence: new Date(exp).toISOString(), minutos: CODIGO_MIN });
  }

  if (body.tipo === 'equipo') {
    const equipo = actual.equipos?.find((e) => e.id === body.id);
    if (!equipo) throw new HttpError(404, 'Ese equipo ya no está autorizado.');
    let mensaje;
    if (body.quitar === true) {
      actual.equipos = actual.equipos.filter((e) => e.id !== body.id);
      mensaje = `Se quitó el equipo "${equipo.nombre}" de ${sucursal}.`;
    } else if (typeof body.exigeGps === 'boolean') {
      if (body.exigeGps && !actual.ubicacion) throw new HttpError(400, 'Primero cargá la ubicación de la sucursal.');
      equipo.exigeGps = body.exigeGps;
      mensaje = body.exigeGps ? `"${equipo.nombre}" solo va a poder ingresar desde el local.` : `"${equipo.nombre}" va a ingresar sin validar la ubicación (solo equipo autorizado).`;
    } else throw new HttpError(400, 'Solicitud inválida.');
    await setAcceso(sucursal, actual);
    return json({ acceso: accesoPublico(actual), mensaje });
  }

  if (body.tipo === 'ubicacion') {
    const pos = leerPosicion(body);
    if (!pos) throw new HttpError(400, 'La ubicación no es válida. Copiala de Google Maps (por ejemplo -25.2637, -57.5759).');
    const radio = Math.round(Number(body.radio) || RADIO_DEFECTO);
    if (radio < 50 || radio > 5000) throw new HttpError(400, 'El radio tiene que estar entre 50 y 5.000 metros.');
    actual.ubicacion = { lat: pos.lat, lng: pos.lng, precision: null, fuente: 'manual', fecha: ahora, por: user.nombre };
    actual.radio = radio;
    await setAcceso(sucursal, actual);
    return json({ acceso: accesoPublico(actual), mensaje: `Se guardó la ubicación de ${sucursal} (radio ${radio} m).` });
  }

  if (body.tipo === 'activo') {
    actual.activo = Boolean(body.activo);
    await setAcceso(sucursal, actual);
    return json({ acceso: accesoPublico(actual), mensaje: `El acceso de ${sucursal} quedó ${actual.activo ? 'activado' : 'desactivado'}.` });
  }

  throw new HttpError(400, 'Tipo de pedido desconocido.');
});

export const config = { path: '/api/suc-admin' };
