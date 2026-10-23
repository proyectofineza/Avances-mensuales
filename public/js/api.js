// Cliente de /api/*. Lanza Error con .status y el mensaje del servidor.
export async function api(method, path, body) {
  const res = await fetch(`/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) {
    const err = new Error(data?.error || 'No se pudo conectar con el servidor.');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const login = (ci, pin) => api('POST', 'login', { ci, pin });
export const logout = () => api('POST', 'logout');
export const solicitarAcceso = (datos) => api('POST', 'solicitud', datos);
export const me = () => api('GET', 'me');
export const getDashboard = () => api('GET', 'dashboard');
export const getDraft = () => api('GET', 'draft');
export const saveDraft = (draft) => api('PUT', 'draft', draft);
export const publish = (avisarTeams) => api('POST', 'publish', { avisarTeams });
export const getClima = () => api('GET', 'clima');
export const getTeams = () => api('GET', 'teams');
export const testTeams = () => api('POST', 'teams');
export const getUsers = () => api('GET', 'users');
export const createUser = (user) => api('POST', 'users', user);
export const updateUser = (ci, changes) => api('PATCH', `users/${encodeURIComponent(ci)}`, changes);
export const eliminarUsuario = (ci) => api('DELETE', `users/${encodeURIComponent(ci)}`);
export const rechazarSolicitud = eliminarUsuario;
