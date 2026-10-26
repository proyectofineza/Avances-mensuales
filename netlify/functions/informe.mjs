// Informe de situación con IA por mes, guardado en Blobs:
//   informes/AAAA-MM → { mes, texto, generado, por, basadoEn, modelo, uso }
// GET  ?mes=AAAA-MM (todos) → informe guardado, si la IA está configurada y si los datos cambiaron
// POST { mes }      (admin) → genera (o regenera) el informe con los datos actuales
import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { armarContexto, generarInforme, configurado } from '../lib/informe.mjs';

const MES_RE = /^\d{4}-\d{2}$/;
const ESPERA_MS = 60e3; // evita generar dos veces seguidas por un doble clic

export default handler(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    await requireUser(req);
    const mes = url.searchParams.get('mes');
    if (!mes || !MES_RE.test(mes)) throw new HttpError(400, 'Indicá el mes.');
    const [informe, datos] = await Promise.all([getJSON(`informes/${mes}`), getJSON(`sucursales/${mes}`)]);
    return json({
      informe,
      configurado: configurado(),
      desactualizado: Boolean(informe && datos && informe.basadoEn !== datos.actualizado),
    });
  }

  if (req.method === 'POST') {
    const user = await requireUser(req, ['admin']);
    const body = await readBody(req);
    const mes = body.mes;
    if (!mes || !MES_RE.test(mes)) throw new HttpError(400, 'Indicá el mes.');
    const datos = await getJSON(`sucursales/${mes}`);
    if (!datos?.filas?.length) throw new HttpError(400, 'Todavía no hay ventas por sucursal cargadas para ese mes.');
    const previo = await getJSON(`informes/${mes}`);
    if (previo && previo.basadoEn === datos.actualizado && Date.now() - Date.parse(previo.generado) < ESPERA_MS) {
      return json({ informe: previo, configurado: true, desactualizado: false });
    }

    const published = await getJSON('published');
    let generado;
    try {
      generado = await generarInforme(armarContexto({ mes, filas: datos.filas, published }));
    } catch (err) {
      throw new HttpError(502, err.message);
    }
    const informe = {
      mes, texto: generado.texto, modelo: generado.modelo, uso: generado.uso,
      generado: new Date().toISOString(), por: user.nombre, basadoEn: datos.actualizado,
    };
    await setJSON(`informes/${mes}`, informe);
    return json({ informe, configurado: true, desactualizado: false });
  }

  throw new HttpError(405, 'Método no permitido.');
});

export const config = { path: '/api/informe' };
