// GET: estado de la configuración de Teams. POST: envía un aviso de prueba (admin).
import { handler, json, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON } from '../lib/store.mjs';
import { hoyAsuncion } from '../../public/js/calc.js';
import { teamsConfigurado, enviarTeams } from '../lib/teams.mjs';

export default handler(async (req) => {
  const user = await requireUser(req, ['admin']);
  const canal = process.env.TEAMS_CANAL || '';

  if (req.method === 'GET') {
    return json({ configurado: teamsConfigurado(), canal, portalUrl: Boolean(process.env.PORTAL_URL) });
  }

  if (req.method === 'POST') {
    if (!teamsConfigurado()) {
      throw new HttpError(400, 'Falta configurar TEAMS_WEBHOOK_URL en Netlify y volver a publicar el sitio.');
    }
    // Usa lo publicado; si todavía no hay nada, manda datos en cero.
    const published = (await getJSON('published')) || { corte: hoyAsuncion(), obj: {}, real: {} };
    const res = await enviarTeams({ ...published, por: user.nombre }, { prueba: true });
    if (!res.ok) throw new HttpError(502, res.detalle);
    return json({ ok: true, canal });
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/teams' };
