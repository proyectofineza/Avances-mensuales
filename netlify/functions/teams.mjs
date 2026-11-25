// GET: estado de la configuración de Teams y del aviso diario.
// PUT { avisoDiario: boolean } | { resumenSemanal: boolean }: activa o desactiva el aviso de cada mañana
//     o el resumen semanal de sucursales de los lunes (admin).
// POST: envía un aviso de prueba (admin); { tipo: 'plan' } la prueba del aviso diario, { tipo: 'semanal' } la del resumen semanal.
import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { hoyAsuncion } from '../../public/js/calc.js';
import { teamsConfigurado, enviarTeams } from '../lib/teams.mjs';
import { mesesCerrados, conComparativa } from '../lib/meses.mjs';
import { CLAVE_AVISO, enviarAvisoDiario } from '../lib/aviso-diario.mjs';
import { CLAVE_SEMANAL, enviarResumenSemanal } from '../lib/resumen-semanal.mjs';

export default handler(async (req) => {
  const user = await requireUser(req, ['admin']);
  const canal = process.env.TEAMS_CANAL || '';

  if (req.method === 'GET') {
    const [aviso, semanal] = await Promise.all([getJSON(CLAVE_AVISO, {}), getJSON(CLAVE_SEMANAL, {})]);
    return json({
      configurado: teamsConfigurado(), canal, portalUrl: Boolean(process.env.PORTAL_URL),
      avisoDiario: { activo: Boolean(aviso.activo), ultimo: aviso.ultimo || null, por: aviso.por || null },
      resumenSemanal: { activo: Boolean(semanal.activo), ultimo: semanal.ultimo || null, por: semanal.por || null },
    });
  }

  if (req.method === 'PUT') {
    const body = await readBody(req);
    if (body.resumenSemanal !== undefined) {
      const actual = await getJSON(CLAVE_SEMANAL, {});
      const r = { ...actual, activo: Boolean(body.resumenSemanal), actualizado: new Date().toISOString(), por: user.nombre };
      await setJSON(CLAVE_SEMANAL, r);
      return json({ resumenSemanal: { activo: r.activo, ultimo: r.ultimo || null, por: r.por } });
    }
    const actual = await getJSON(CLAVE_AVISO, {});
    const aviso = { ...actual, activo: Boolean(body.avisoDiario), actualizado: new Date().toISOString(), por: user.nombre };
    await setJSON(CLAVE_AVISO, aviso);
    return json({ avisoDiario: { activo: aviso.activo, ultimo: aviso.ultimo || null, por: aviso.por } });
  }

  if (req.method === 'POST') {
    if (!teamsConfigurado()) {
      throw new HttpError(400, 'Falta configurar TEAMS_WEBHOOK_URL en Netlify y volver a publicar el sitio.');
    }
    const body = await readBody(req).catch(() => ({}));
    if (body?.tipo === 'semanal') {
      const res = await enviarResumenSemanal({ prueba: true, origen: new URL(req.url).origin });
      if (!res.ok) throw new HttpError(res.detalle?.startsWith('Teams') || res.detalle?.startsWith('No se pudo conectar') ? 502 : 400, res.detalle);
      return json({ ok: true, canal, desde: res.desde, hasta: res.hasta });
    }
    if (body?.tipo === 'plan') {
      const res = await enviarAvisoDiario({ prueba: true, origen: new URL(req.url).origin });
      if (!res.ok) throw new HttpError(res.detalle?.startsWith('Teams') || res.detalle?.startsWith('No se pudo conectar') ? 502 : 400, res.detalle);
      return json({ ok: true, canal, fecha: res.fecha });
    }
    // Usa lo publicado; si todavía no hay nada, manda datos en cero.
    const published = (await getJSON('published')) || { corte: hoyAsuncion(), obj: {}, real: {} };
    const { meses } = await mesesCerrados();
    const res = await enviarTeams({ ...conComparativa(published, meses), por: user.nombre }, { prueba: true, origen: new URL(req.url).origin });
    if (!res.ok) throw new HttpError(502, res.detalle);
    return json({ ok: true, canal });
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/teams' };
