import { handler, json, requireUser } from '../lib/auth.mjs';
import { registrarActividad } from '../lib/store.mjs';

export default handler(async (req) => {
  const user = await requireUser(req);
  await registrarActividad(user.ci);
  // supervisor: si el usuario es supervisor de sucursales, el portal le muestra primero las suyas.
  return json({ ci: user.ci, nombre: user.nombre, rol: user.rol, supervisor: user.supervisor || '' });
});

export const config = { path: '/api/me' };
