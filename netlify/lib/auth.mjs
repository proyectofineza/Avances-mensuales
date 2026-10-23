// PIN con scrypt, sesiones firmadas con HMAC-SHA256 y helpers HTTP.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'pav_session';
const SESSION_HOURS = 12;

export async function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const buf = await scrypt(String(pin), salt, 64);
  return { hash: buf.toString('hex'), salt };
}

export async function verifyPin(pin, hash, salt) {
  const buf = await scrypt(String(pin), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === buf.length && crypto.timingSafeEqual(buf, expected);
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new HttpError(500, 'Falta configurar SESSION_SECRET en Netlify.');
  return s;
}

function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

export function createSessionCookie(ci) {
  const payload = Buffer.from(JSON.stringify({ ci, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readSession(req) {
  const cookies = req.headers.get('cookie') || '';
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// Verifica la sesión contra el usuario guardado (rol y estado actuales).
// roles: lista de roles permitidos; vacío = cualquier usuario activo.
export async function requireUser(req, roles = []) {
  const { getUsers } = await import('./store.mjs');
  const session = readSession(req);
  if (!session) throw new HttpError(401, 'Sesión vencida. Ingresá de nuevo.');
  const users = await getUsers();
  const user = users.find((u) => u.ci === session.ci);
  if (!user || !user.activo) throw new HttpError(401, 'Sesión vencida. Ingresá de nuevo.');
  if (roles.length && !roles.includes(user.rol)) throw new HttpError(403, 'No tenés permiso para esta acción.');
  return user;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// Envuelve un handler para convertir HttpError en respuestas JSON.
export function handler(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Error interno del servidor.' }, 500);
    }
  };
}

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Solicitud inválida.');
  }
}
