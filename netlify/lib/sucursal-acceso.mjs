// Acceso de cada sucursal a su portal: PIN de la sucursal + equipo autorizado + ubicación.
//   suc-acceso/<SUCURSAL>  → { sucursal, activo, pinHash, pinSalt, pinVer, radio, ubicacion, equipos, ingresos, ... }
//     ubicacion: { lat, lng, precision, fuente: 'equipo' | 'manual', fecha }
//     equipos:   [{ id, nombre, creado, por, exigeGps, precisionAlta, distanciaAlta, ultimoIngreso }]
//     ingresos:  últimos intentos [{ fecha, equipo, ok, motivo, distancia }]
//   suc-codigo/<CÓDIGO>    → { sucursal, exp, por }   código de un solo uso para autorizar un equipo
//   suc-mensual            → { 'AAAA-MM': { SUCURSAL: monto } } totales de lo cargado en el portal
//   suc-historia           → { 'AAAA-MM': { SUCURSAL: monto } } planilla de meses anteriores (manda)
// Las sesiones de sucursal usan sus propias cookies y tokens firmados con otro tipo:
// no sirven para entrar al portal interno, y una sesión del portal no abre el de una sucursal.
import crypto from 'node:crypto';
import { getJSON, setJSON, store } from './store.mjs';
import { crearToken, leerToken, leerCookie, HttpError } from './auth.mjs';
import { totalesPorSucursal } from '../../public/js/portal-sucursal.js';

const C_SESION = 'pav_suc';
const C_EQUIPO = 'pav_equipo';
const SESION_HORAS = 10;
const EQUIPO_HORAS = 400 * 24;
const MAX_INGRESOS = 40;

const clave = (suc) => `suc-acceso/${encodeURIComponent(suc)}`;
export const getAcceso = (suc) => getJSON(clave(suc));
export const setAcceso = (suc, a) => setJSON(clave(suc), a);

export async function listarAccesos() {
  const { blobs } = await store().list({ prefix: 'suc-acceso/' });
  return (await Promise.all(blobs.map((b) => getJSON(b.key)))).filter(Boolean);
}

export const nuevoId = () => crypto.randomBytes(9).toString('base64url');
export const nuevoCodigo = () => String(crypto.randomInt(0, 1e8)).padStart(8, '0');

const cookie = (nombre, valor, horas) => `${nombre}=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.round(horas * 3600)}`;
export const cookieEquipo = (suc, id) => cookie(C_EQUIPO, crearToken('equipo', { suc, id }, EQUIPO_HORAS), EQUIPO_HORAS);
export const cookieSesion = (suc, id, pv) => cookie(C_SESION, crearToken('suc', { suc, id, pv }, SESION_HORAS), SESION_HORAS);
export const borrarSesion = () => `${C_SESION}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export const borrarEquipo = () => `${C_EQUIPO}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// Equipo autorizado de este navegador (si sigue registrado): { acceso, equipo } o null.
export async function equipoDe(req) {
  const t = leerToken('equipo', leerCookie(req, C_EQUIPO));
  if (!t) return null;
  const acceso = await getAcceso(t.suc);
  const equipo = acceso?.equipos?.find((e) => e.id === t.id);
  return equipo ? { acceso, equipo } : null;
}

// Sesión de sucursal válida: misma sucursal y mismo equipo que la cookie del equipo, equipo
// todavía autorizado, sucursal activa y PIN sin cambiar desde que se ingresó.
export async function requireSucursal(req) {
  const s = leerToken('suc', leerCookie(req, C_SESION));
  const e = leerToken('equipo', leerCookie(req, C_EQUIPO));
  const vencida = new HttpError(401, 'La sesión venció. Ingresá de nuevo.');
  if (!s || !e || s.suc !== e.suc || s.id !== e.id) throw vencida;
  const acceso = await getAcceso(s.suc);
  if (!acceso?.activo || acceso.pinVer !== s.pv || !acceso.equipos?.some((x) => x.id === s.id)) throw vencida;
  return { sucursal: s.suc, acceso };
}

export function registrarIntento(acceso, intento) {
  acceso.ingresos = [{ fecha: new Date().toISOString(), ...intento }, ...(acceso.ingresos || [])].slice(0, MAX_INGRESOS);
}

// Lo que ve el administrador (sin hashes).
export function accesoPublico(a) {
  return {
    sucursal: a.sucursal, activo: a.activo, conPin: Boolean(a.pinHash), radio: a.radio, ubicacion: a.ubicacion || null,
    equipos: a.equipos || [], ingresos: (a.ingresos || []).slice(0, 15), bloqueadoHasta: a.bloqueadoHasta || null,
  };
}

// ---- Totales mensuales por sucursal ----

// Se llama al guardar o borrar un mes de ventas por sucursal (filas null = mes borrado).
export async function actualizarMensual(mes, filas) {
  const cache = await getJSON('suc-mensual', {});
  if (filas) cache[mes] = totalesPorSucursal(filas);
  else delete cache[mes];
  await setJSON('suc-mensual', cache);
}

// { 'AAAA-MM': monto } de una sucursal: la planilla de meses anteriores manda; si un mes no está,
// lo cargado en el portal. Los meses del portal que todavía no tienen total se calculan y se guardan.
export async function mensualDe(sucursal) {
  const [cache, index, historia] = await Promise.all([
    getJSON('suc-mensual', {}), getJSON('sucursales/index', []), getJSON('suc-historia', {}),
  ]);
  const faltan = index.filter((m) => !cache[m]);
  if (faltan.length) {
    const datos = await Promise.all(faltan.map((m) => getJSON(`sucursales/${m}`)));
    faltan.forEach((m, i) => { if (datos[i]?.filas) cache[m] = totalesPorSucursal(datos[i].filas); });
    await setJSON('suc-mensual', cache);
  }
  const out = {};
  for (const m of new Set([...Object.keys(cache), ...Object.keys(historia)])) {
    const v = historia[m]?.[sucursal] ?? cache[m]?.[sucursal];
    if (v !== undefined) out[m] = v;
  }
  return out;
}
