import { handler, json, readBody, requireUser, HttpError, hashPin } from '../lib/auth.mjs';
import { getUsers, saveUsers, publicUser } from '../lib/store.mjs';

const ROL_TEXTO = { admin: 'Administrador', comercial: 'Comercial' };

export default handler(async (req, context) => {
  const me = await requireUser(req, ['admin']);
  const users = await getUsers();

  if (req.method === 'GET') {
    return json(users.map(publicUser));
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const ci = String(body.ci || '').replace(/\D/g, '');
    const nombre = String(body.nombre || '').trim();
    const pin = String(body.pin || '');
    const rol = body.rol === 'admin' ? 'admin' : 'comercial';
    if (ci.length < 5) throw new HttpError(400, 'La cédula debe tener al menos 5 dígitos.');
    if (users.some((u) => u.ci === ci)) throw new HttpError(400, 'Ya existe un usuario con esa cédula.');
    if (!nombre) throw new HttpError(400, 'Indicá el nombre y apellido.');
    if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'El PIN debe tener de 4 a 6 dígitos.');
    const { hash, salt } = await hashPin(pin);
    const user = {
      ci, nombre, rol, activo: true, pinHash: hash, pinSalt: salt,
      creado: new Date().toISOString(), intentosFallidos: 0, bloqueadoHasta: null,
    };
    users.push(user);
    await saveUsers(users);
    return json({ user: publicUser(user), mensaje: `${nombre} fue dado de alta como ${ROL_TEXTO[rol]}.` }, 201);
  }

  if (req.method === 'PATCH') {
    const ci = String(context?.params?.ci || new URL(req.url).pathname.split('/').pop() || '').replace(/\D/g, '');
    const user = users.find((u) => u.ci === ci);
    if (!user) throw new HttpError(404, 'Usuario no encontrado.');
    const body = await readBody(req);
    let mensaje = '';

    if (typeof body.activo === 'boolean') {
      if (!body.activo) {
        if (user.ci === me.ci) throw new HttpError(400, 'No podés desactivar tu propio usuario.');
        const adminsActivos = users.filter((u) => u.rol === 'admin' && u.activo && u.ci !== user.ci);
        if (user.rol === 'admin' && adminsActivos.length === 0) {
          throw new HttpError(400, 'Tiene que quedar al menos un administrador activo.');
        }
      }
      user.activo = body.activo;
      mensaje = `${user.nombre} fue ${body.activo ? 'activado' : 'desactivado'}.`;
    } else if (body.pin !== undefined) {
      const pin = String(body.pin);
      if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'El PIN debe tener de 4 a 6 dígitos.');
      const { hash, salt } = await hashPin(pin);
      user.pinHash = hash;
      user.pinSalt = salt;
      user.intentosFallidos = 0;
      user.bloqueadoHasta = null;
      mensaje = `Se restableció el PIN de ${user.nombre}.`;
    } else {
      throw new HttpError(400, 'Solicitud inválida.');
    }

    await saveUsers(users);
    return json({ user: publicUser(user), mensaje });
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: ['/api/users', '/api/users/:ci'] };
