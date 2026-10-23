import { handler, json, readBody, HttpError, verifyPin, createSessionCookie } from '../lib/auth.mjs';
import { getUsers, saveUsers } from '../lib/store.mjs';

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const ERROR_CRED = 'Cédula o PIN incorrectos.';

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  const body = await readBody(req);
  const ci = String(body.ci || '').replace(/\D/g, '');
  const pin = String(body.pin || '');
  if (!ci || !/^\d{4,6}$/.test(pin)) throw new HttpError(401, ERROR_CRED);

  const users = await getUsers();
  const user = users.find((u) => u.ci === ci);
  if (!user) throw new HttpError(401, ERROR_CRED);

  const ahora = Date.now();
  if (user.bloqueadoHasta && new Date(user.bloqueadoHasta).getTime() > ahora) {
    const min = Math.ceil((new Date(user.bloqueadoHasta).getTime() - ahora) / 60000);
    throw new HttpError(429, `Demasiados intentos fallidos. Probá de nuevo en ${min} minuto${min === 1 ? '' : 's'}.`);
  }

  const ok = await verifyPin(pin, user.pinHash, user.pinSalt);
  if (!ok) {
    user.intentosFallidos = (user.intentosFallidos || 0) + 1;
    if (user.intentosFallidos >= MAX_INTENTOS) {
      user.intentosFallidos = 0;
      user.bloqueadoHasta = new Date(ahora + BLOQUEO_MIN * 60000).toISOString();
      await saveUsers(users);
      throw new HttpError(429, `Demasiados intentos fallidos. Probá de nuevo en ${BLOQUEO_MIN} minutos.`);
    }
    await saveUsers(users);
    throw new HttpError(401, ERROR_CRED);
  }

  if (user.pendiente) throw new HttpError(403, 'Tu solicitud todavía está pendiente. Vas a poder ingresar cuando el administrador la apruebe.');
  if (!user.activo) throw new HttpError(403, 'Tu usuario está desactivado. Consultá con el administrador.');

  if (user.intentosFallidos || user.bloqueadoHasta) {
    user.intentosFallidos = 0;
    user.bloqueadoHasta = null;
    await saveUsers(users);
  }

  return json({ ci: user.ci, nombre: user.nombre, rol: user.rol }, 200, { 'set-cookie': createSessionCookie(user.ci) });
});

export const config = { path: '/api/login' };
