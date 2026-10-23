import { handler, json, requireUser } from '../lib/auth.mjs';

export default handler(async (req) => {
  const user = await requireUser(req);
  return json({ ci: user.ci, nombre: user.nombre, rol: user.rol });
});

export const config = { path: '/api/me' };
