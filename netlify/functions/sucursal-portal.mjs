// Portal de cada sucursal (sucursal.html). Solo devuelve datos de la sucursal de la sesión.
// GET  /api/suc/estado              → { equipo: { sucursal, nombre } | null, sesion }
// POST /api/suc/autorizar { codigo, nombre, pos } → autoriza este equipo con el código que da el admin
// POST /api/suc/ingresar  { pin, pos }            → PIN + equipo autorizado + ubicación en el local
// POST /api/suc/salir
// GET  /api/suc/datos?mes=AAAA-MM   → vista de la sucursal (avance, puesto, historial)
import crypto from 'node:crypto';
import { handler, json, readBody, HttpError, verifyPin } from '../lib/auth.mjs';
import { getJSON, setJSON, deleteKey } from '../lib/store.mjs';
import {
  equipoDe, requireSucursal, getAcceso, setAcceso, nuevoId, cookieEquipo, cookieSesion, borrarSesion,
  registrarIntento, mensualDe,
} from '../lib/sucursal-acceso.mjs';
import { leerPosicion, revisarUbicacion, distanciaMetros, vistaSucursal, PRECISION_GPS } from '../../public/js/portal-sucursal.js';
import { normalizarPesos, normalizarEspeciales } from '../../public/js/calc.js';

const MES_RE = /^\d{4}-\d{2}$/;
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const MAX_CODIGOS_IP = 10;

// Límite de códigos equivocados por conexión, para que no se puedan probar códigos al azar.
async function controlarCodigos(ip, fallo) {
  const k = `suc-intentos/${crypto.createHash('sha256').update(String(ip || 'sin-ip')).digest('hex').slice(0, 24)}`;
  const a = await getJSON(k, { n: 0, desde: Date.now() });
  if (Date.now() - a.desde > BLOQUEO_MIN * 60e3) { a.n = 0; a.desde = Date.now(); }
  if (a.n >= MAX_CODIGOS_IP) throw new HttpError(429, `Demasiados códigos equivocados. Probá de nuevo en ${BLOQUEO_MIN} minutos.`);
  if (fallo) { a.n++; await setJSON(k, a); }
}

export default handler(async (req, context) => {
  const accion = context?.params?.accion || new URL(req.url).pathname.split('/').pop();

  if (req.method === 'GET' && accion === 'estado') {
    const e = await equipoDe(req);
    let sesion = false;
    try { await requireSucursal(req); sesion = true; } catch { /* sin sesión */ }
    return json({ equipo: e ? { sucursal: e.acceso.sucursal, nombre: e.equipo.nombre, exigeGps: e.equipo.exigeGps } : null, sesion });
  }

  if (req.method === 'POST' && accion === 'autorizar') {
    const body = await readBody(req);
    const codigo = String(body.codigo || '').replace(/\D/g, '');
    await controlarCodigos(context?.ip);
    const datos = /^\d{8}$/.test(codigo) ? await getJSON(`suc-codigo/${codigo}`) : null;
    if (!datos || datos.exp < Date.now()) {
      await controlarCodigos(context?.ip, true);
      throw new HttpError(400, 'El código no es válido o ya venció. Pedile uno nuevo al administrador.');
    }
    await deleteKey(`suc-codigo/${codigo}`); // un solo uso
    const acceso = await getAcceso(datos.sucursal);
    if (!acceso) throw new HttpError(400, 'La sucursal no tiene acceso configurado.');

    // La ubicación al autorizar: si es precisa, el equipo tiene GPS y se le exige al ingresar;
    // si la sucursal todavía no tenía ubicación, queda esta (el admin la revisa en el mapa).
    const pos = leerPosicion(body.pos);
    const precisa = Boolean(pos?.precision && pos.precision <= PRECISION_GPS);
    if (precisa && !acceso.ubicacion) {
      acceso.ubicacion = { lat: pos.lat, lng: pos.lng, precision: pos.precision, fuente: 'equipo', fecha: new Date().toISOString() };
    }
    const equipo = {
      id: nuevoId(),
      nombre: String(body.nombre || '').trim().slice(0, 40) || 'Equipo',
      creado: new Date().toISOString(),
      por: datos.por,
      exigeGps: precisa,
      precisionAlta: pos?.precision || null,
      distanciaAlta: pos && acceso.ubicacion ? Math.round(distanciaMetros(acceso.ubicacion, pos)) : null,
      ultimoIngreso: null,
    };
    acceso.equipos = [...(acceso.equipos || []), equipo];
    await setAcceso(acceso.sucursal, acceso);
    return json({ sucursal: acceso.sucursal, exigeGps: equipo.exigeGps }, 200, { 'set-cookie': cookieEquipo(acceso.sucursal, equipo.id) });
  }

  if (req.method === 'POST' && accion === 'ingresar') {
    const e = await equipoDe(req);
    if (!e) throw new HttpError(403, 'Este equipo no está autorizado. Pedile un código al administrador.');
    const { acceso, equipo } = e;
    const body = await readBody(req);
    const pin = String(body.pin || '');
    const ahora = Date.now();
    if (!acceso.activo) throw new HttpError(403, 'El acceso de esta sucursal está desactivado.');
    if (!acceso.pinHash) throw new HttpError(403, 'La sucursal todavía no tiene PIN. Avisá al administrador.');
    if (acceso.bloqueadoHasta && Date.parse(acceso.bloqueadoHasta) > ahora) {
      const min = Math.ceil((Date.parse(acceso.bloqueadoHasta) - ahora) / 60000);
      throw new HttpError(429, `Demasiados intentos fallidos. Probá de nuevo en ${min} minuto${min === 1 ? '' : 's'}.`);
    }
    const fallar = async (status, motivo, extra = {}) => {
      registrarIntento(acceso, { equipo: equipo.nombre, ok: false, motivo, ...extra });
      await setAcceso(acceso.sucursal, acceso);
      throw new HttpError(status, motivo);
    };

    if (!/^\d{4,6}$/.test(pin) || !(await verifyPin(pin, acceso.pinHash, acceso.pinSalt))) {
      acceso.intentosFallidos = (acceso.intentosFallidos || 0) + 1;
      if (acceso.intentosFallidos >= MAX_INTENTOS) {
        acceso.intentosFallidos = 0;
        acceso.bloqueadoHasta = new Date(ahora + BLOQUEO_MIN * 60e3).toISOString();
        await fallar(429, `Demasiados intentos fallidos. Probá de nuevo en ${BLOQUEO_MIN} minutos.`);
      }
      await fallar(401, 'PIN incorrecto.');
    }

    let distancia = null;
    if (equipo.exigeGps) {
      const r = revisarUbicacion(acceso.ubicacion, acceso.radio, leerPosicion(body.pos));
      distancia = r.distancia ?? null;
      if (!r.ok) await fallar(403, r.motivo, { distancia });
    }

    acceso.intentosFallidos = 0;
    acceso.bloqueadoHasta = null;
    equipo.ultimoIngreso = new Date().toISOString();
    registrarIntento(acceso, { equipo: equipo.nombre, ok: true, distancia });
    await setAcceso(acceso.sucursal, acceso);
    return json({ sucursal: acceso.sucursal }, 200, { 'set-cookie': cookieSesion(acceso.sucursal, equipo.id, acceso.pinVer) });
  }

  if (req.method === 'POST' && accion === 'salir') {
    return json({ ok: true }, 200, { 'set-cookie': borrarSesion() });
  }

  if (req.method === 'GET' && accion === 'datos') {
    const { sucursal } = await requireSucursal(req);
    const index = (await getJSON('sucursales/index', [])).sort();
    const pedido = new URL(req.url).searchParams.get('mes');
    const mes = pedido && MES_RE.test(pedido) && index.includes(pedido) ? pedido : index.at(-1);
    if (!mes) return json({ sucursal, mes: null, meses: [], vista: null });
    const [datos, objetivos, cerradas, mensual, published] = await Promise.all([
      getJSON(`sucursales/${mes}`, { filas: [] }),
      getJSON(`sucursales-objetivos/${mes}`, { filas: [] }),
      getJSON('sucursales-cerradas', { filas: [] }),
      mensualDe(sucursal),
      getJSON('published'),
    ]);
    // Peso de cada día y fechas especiales: los del reporte publicado (las fechas sirven para cualquier mes).
    const vista = vistaSucursal({
      sucursal, mes, filasMes: datos.filas, objetivos: objetivos?.filas || [], mensual,
      cerradas: cerradas.filas.map((c) => c.sucursal),
      pesos: normalizarPesos(published?.pesos), especiales: normalizarEspeciales(published?.especiales),
    });
    return json({ sucursal, mes, meses: index, actualizado: datos.actualizado || null, vista });
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/suc/:accion' };
