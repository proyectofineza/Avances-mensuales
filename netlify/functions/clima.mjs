// GET: pronóstico diario del área central. Se guarda en Blobs y se renueva cada 3 h
// para no consultar a MET Norway en cada visita.
// Con ?mes=AAAA-MM también devuelve el clima registrado de ese mes (historial propio).
import { handler, json, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { renovarClima } from '../lib/clima.mjs';

const VIGENCIA_MS = 3 * 3600e3;
const MES_RE = /^\d{4}-\d{2}$/;

export default handler(async (req) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido.');
  await requireUser(req);
  const mes = new URL(req.url).searchParams.get('mes');

  let clima = await getJSON('clima');
  if (!clima || Date.now() - Date.parse(clima.actualizado) >= VIGENCIA_MS) {
    try {
      clima = await renovarClima({ getJSON, setJSON });
    } catch (err) {
      console.error('Error obteniendo el pronóstico', err);
      // Si falla, se sirve el último pronóstico guardado aunque esté vencido.
      if (!clima) throw new HttpError(502, 'No se pudo obtener el pronóstico del clima.');
      clima = { ...clima, vencido: true };
    }
  }

  if (mes && MES_RE.test(mes)) {
    const hist = await getJSON('clima-historial', { dias: {} });
    clima = {
      ...clima,
      historial: Object.entries(hist.dias)
        .filter(([fecha]) => fecha.startsWith(mes))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fecha, d]) => ({ fecha, ...d })),
    };
  }
  return json(clima);
});

export const config = { path: '/api/clima' };
