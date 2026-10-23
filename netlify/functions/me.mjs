import { handler, json, requireUser } from '../lib/auth.mjs';
import { registrarActividad } from '../lib/store.mjs';

export default handler(async (req) => {
  const user = await requireUser(req);
  await registrarActividad(user.ci);
  return json({ ci: user.ci, nombre: user.nombre, rol: user.rol });
});

export const config = { path: '/api/me' };
