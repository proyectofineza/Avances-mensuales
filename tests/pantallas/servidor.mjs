// Servidor local para las pruebas de pantallas: sirve public/ y /api/* con las funciones reales,
// Blobs en memoria y datos inventados (sucursales, reporte publicado, usuarios). Nunca toca producción.
// Usuarios de prueba (solo existen acá): admin 1234567 / 1111 · comercial 7654321 / 2222 · una solicitud pendiente.
import { register } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register(new URL('./hooks.mjs', import.meta.url));

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const USUARIOS = { admin: { ci: '1234567', pin: '1111' }, comercial: { ci: '7654321', pin: '2222' } };

const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diasDelMes = (mes) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();

async function sembrar() {
  process.env.SESSION_SECRET = 'prueba-'.repeat(8);
  const { setJSON } = await imp('netlify/lib/store.mjs');
  const { hashPin } = await imp('netlify/lib/auth.mjs');
  const { hoyAsuncion, normalizarReporte } = await imp('public/js/calc.js');

  const hoy = hoyAsuncion();
  const mes = hoy.slice(0, 7);
  const previo = sumarDias(`${mes}-01`, -1).slice(0, 7);
  const anioPasado = `${Number(mes.slice(0, 4)) - 1}${mes.slice(4)}`;
  const diaHoy = Number(hoy.slice(8));
  const corte = diaHoy > 1 ? sumarDias(hoy, -1) : hoy;

  // Sucursales inventadas, con ciudades y supervisores.
  let semilla = 11;
  const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
  const CIUDADES = ['ASUNCIÓN', 'LUQUE', 'SAN LORENZO', 'CAPIATÁ', 'LAMBARÉ', 'ÑEMBY'];
  const SUPERVISORES = ['Supervisor Uno', 'Supervisor Dos', 'Supervisor Tres', 'Supervisor Cuatro'];
  const PESO = [24, 2, 9, 10, 9, 19, 27]; // domingo a sábado
  const sucursales = Array.from({ length: 36 }, (_, i) => ({
    sucursal: `${CIUDADES[i % CIUDADES.length]} ${Math.floor(i / CIUDADES.length) + 1}`,
    zona: CIUDADES[i % CIUDADES.length], encargado: '', supervisor: SUPERVISORES[i % SUPERVISORES.length],
    objetivo: Math.round((60 + azar() * 300) * 1e6),
  }));
  const ventasDelMes = (m, hasta) => {
    const total = Array.from({ length: diasDelMes(m) }, (_, d) => PESO[new Date(`${m}-${String(d + 1).padStart(2, '0')}T12:00:00Z`).getUTCDay()]).reduce((a, b) => a + b, 0);
    const filas = [];
    for (const s of sucursales) {
      const ritmo = 0.7 + azar() * 0.6;
      for (let d = 1; d <= hasta; d++) {
        const fecha = `${m}-${String(d).padStart(2, '0')}`;
        const wd = new Date(`${fecha}T12:00:00Z`).getUTCDay();
        filas.push({ sucursal: s.sucursal, fecha, monto: Math.round(s.objetivo * ritmo * PESO[wd] / total * (0.8 + azar() * 0.4)) });
      }
    }
    return filas;
  };
  const objetivos = sucursales.map(({ sucursal, objetivo }) => ({ sucursal, objetivo }));
  await setJSON('sucursales/index', [previo, mes]);
  await setJSON(`sucursales/${previo}`, { mes: previo, filas: ventasDelMes(previo, diasDelMes(previo)), actualizado: `${previo}-28T10:00:00.000Z`, por: 'Admin Prueba' });
  await setJSON(`sucursales/${mes}`, { mes, filas: ventasDelMes(mes, Number(corte.slice(8))), actualizado: new Date().toISOString(), por: 'Admin Prueba' });
  for (const m of [previo, mes]) await setJSON(`sucursales-objetivos/${m}`, { mes: m, filas: objetivos });
  await setJSON('sucursales-maestro', { filas: sucursales.map(({ sucursal, zona, encargado, supervisor }) => ({ sucursal, zona, encargado, supervisor })) });
  await setJSON('suc-historia', { [anioPasado]: Object.fromEntries(sucursales.map((s) => [s.sucursal, Math.round(s.objetivo * 0.9)])) });

  // Reporte publicado del mes en curso y cierre del mes anterior.
  const obj = { may: 9000e6, min: 6000e6, fgl: 3000e6, fbt: 1500e6 };
  const avance = (Number(corte.slice(8)) / diasDelMes(mes)) * 0.97;
  const reporte = (c, f) => normalizarReporte({ corte: c, obj, real: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v * f)])) });
  const publicado = { ...reporte(corte, avance), publicadoEn: new Date().toISOString(), por: 'Admin Prueba' };
  const ultimoPrevio = `${previo}-${String(diasDelMes(previo)).padStart(2, '0')}`;
  const cierrePrevio = { ...reporte(ultimoPrevio, 1.02), publicadoEn: `${ultimoPrevio}T22:00:00.000Z`, por: 'Admin Prueba' };
  // Meses cerrados de los dos años anteriores y del año en curso (planilla mensual), para el Comparativo anual.
  const historia = {};
  for (let m = `${Number(mes.slice(0, 4)) - 2}-01`; m < previo; m = sumarDias(`${m}-28`, 7).slice(0, 7)) {
    const f = 0.85 + azar() * 0.3;
    historia[m] = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v * f)]));
  }
  await setJSON('historia-mensual', historia);
  await setJSON('published', publicado);
  await setJSON(`history/${mes}`, [publicado]);
  await setJSON(`history/${previo}`, [cierrePrevio]);
  await setJSON(`cierre/${previo}`, cierrePrevio);

  // Pronóstico guardado (así no se consulta el servicio del clima).
  await setJSON('clima', { actualizado: new Date().toISOString(), dias: Array.from({ length: 7 }, (_, i) => ({ fecha: sumarDias(hoy, i), tmax: 32, tmin: 22, lluvia: i === 3 ? 12 : 0, simbolo: 'partlycloudy_day' })) });

  const usuario = async (ci, pin, nombre, rol, extra = {}) => ({ ci, nombre, rol, activo: true, ...(await hashPin(pin).then(({ hash, salt }) => ({ pinHash: hash, pinSalt: salt }))), creado: new Date().toISOString(), intentosFallidos: 0, bloqueadoHasta: null, ...extra });
  await setJSON('users', [
    await usuario(USUARIOS.admin.ci, USUARIOS.admin.pin, 'Admin Prueba', 'admin'),
    await usuario(USUARIOS.comercial.ci, USUARIOS.comercial.pin, 'Comercial Prueba', 'comercial'),
    await usuario('5555555', '3333', 'Solicitud Pendiente', 'comercial', { activo: false, pendiente: true }),
  ]);
  return { mes, previo, sucursales: sucursales.map((s) => s.sucursal) };
}

export async function arrancarServidor() {
  // Sin salida a internet: cualquier pedido externo falla al instante.
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(String(url))) return fetchReal(url, opts);
    throw new Error(`Pedido externo bloqueado en las pruebas: ${url}`);
  };
  const datos = await sembrar();

  const rutas = [];
  for (const f of fs.readdirSync(path.join(REPO, 'netlify/functions'))) {
    const m = await imp(`netlify/functions/${f}`);
    for (const p of [].concat(m.config?.path || [])) {
      const re = new RegExp(`^${p.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
      rutas.push({ re, fn: m.default });
    }
  }

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const ruta = rutas.find((r) => r.re.test(url.pathname));
        if (!ruta) { res.statusCode = 404; res.end('{}'); return; }
        const params = url.pathname.match(ruta.re).groups || {};
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
        const r = await ruta.fn(new Request(new URL(req.url, `http://${req.headers.host}`), { method: req.method, headers: req.headers, body }), { params, ip: '127.0.0.1' });
        res.statusCode = r.status;
        r.headers.forEach((v, k) => res.setHeader(k, k === 'set-cookie' ? v.replace(/; Secure/gi, '') : v));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      const publico = path.join(REPO, 'public');
      const archivo = path.join(publico, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      if (!archivo.startsWith(publico) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) { res.statusCode = 404; res.end('no'); return; }
      res.setHeader('content-type', TIPOS[path.extname(archivo)] || 'application/octet-stream');
      res.setHeader('cache-control', 'no-store');
      res.end(fs.readFileSync(archivo));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err?.stack || err));
    }
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  return { url, datos, cerrar: () => new Promise((ok) => servidor.close(ok)), restaurarFetch: () => { globalThis.fetch = fetchReal; } };
}

// Uso manual: node tests/pantallas/servidor.mjs  → deja el portal de prueba andando para mirarlo en el navegador.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await arrancarServidor();
  console.log(`Portal de prueba en ${url}/ (admin ${USUARIOS.admin.ci} / ${USUARIOS.admin.pin})`);
}
