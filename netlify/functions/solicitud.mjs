// POST público: un comercial pide acceso con su cédula, nombre y PIN.
// Queda pendiente (sin poder ingresar) hasta que un administrador lo apruebe.
import { handler, json, readBody, HttpError, hashPin } from '../lib/auth.mjs';
import { getUsers, saveUsers, getJSON, setJSON } from '../lib/store.mjs';

const MAX_POR_HORA = 5; // por conexión (IP)
const MAX_PENDIENTES = 100;

export default handler(async (req, context) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  const body = await readBody(req);
  const ci = String(body.ci || '').replace(/\D/g, '');
  const nombre = String(body.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const pin = String(body.pin || '');
  if (ci.length < 5) throw new HttpError(400, 'La cédula debe tener al menos 5 dígitos.');
  if (!nombre) throw new HttpError(400, 'Indicá tu nombre y apellido.');
  if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'El PIN debe tener de 4 a 6 dígitos.');

  // Límite de solicitudes por conexión en la última hora.
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'desconocida';
  const ahora = Date.now();
  const registro = await getJSON('solicitudes-ip', {});
  for (const k of Object.keys(registro)) {
    registro[k] = registro[k].filter((t) => ahora - t < 3600e3);
    if (!registro[k].length) delete registro[k];
  }
  if ((registro[ip] || []).length >= MAX_POR_HORA) {
    throw new HttpError(429, 'Se enviaron demasiadas solicitudes desde esta conexión. Probá de nuevo en una hora.');
  }

  const users = await getUsers();
  const existente = users.find((u) => u.ci === ci);
  if (existente?.pendiente) throw new HttpError(400, 'Ya hay una solicitud pendiente con esa cédula. Esperá la aprobación del administrador.');
  if (existente) throw new HttpError(400, 'Esa cédula ya tiene usuario. Si no recordás el PIN, pedile al administrador que lo restablezca.');
  if (users.filter((u) => u.pendiente).length >= MAX_PENDIENTES) {
    throw new HttpError(429, 'Hay demasiadas solicitudes pendientes. Avisale al administrador.');
  }

  const { hash, salt } = await hashPin(pin);
  users.push({
    ci, nombre, rol: 'comercial', activo: false, pendiente: true, pinHash: hash, pinSalt: salt,
    creado: new Date().toISOString(), intentosFallidos: 0, bloqueadoHasta: null,
  });
  await saveUsers(users);
  registro[ip] = [...(registro[ip] || []), ahora];
  await setJSON('solicitudes-ip', registro);

  return json({ mensaje: 'Solicitud enviada. Vas a poder ingresar cuando el administrador la apruebe.' }, 201);
});

export const config = { path: '/api/solicitud' };
