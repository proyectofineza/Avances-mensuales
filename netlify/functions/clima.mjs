// GET: pronóstico diario del área central. Se guarda en Blobs y se renueva cada 3 h
// para no consultar a MET Norway en cada visita.
import { handler, json, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { obtenerPronostico } from '../lib/clima.mjs';

const VIGENCIA_MS = 3 * 3600e3;

export default handler(async (req) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido.');
  await requireUser(req);

  const cache = await getJSON('clima');
  if (cache && Date.now() - Date.parse(cache.actualizado) < VIGENCIA_MS) return json(cache);

  try {
    const clima = { actualizado: new Date().toISOString(), fuente: 'MET Norway', dias: await obtenerPronostico() };
    await setJSON('clima', clima);
    return json(clima);
  } catch (err) {
    console.error('Error obteniendo el pronóstico', err);
    // Si falla, se sirve el último pronóstico guardado aunque esté vencido.
    if (cache) return json({ ...cache, vencido: true });
    throw new HttpError(502, 'No se pudo obtener el pronóstico del clima.');
  }
});

export const config = { path: '/api/clima' };
