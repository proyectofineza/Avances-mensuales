// Objetivo sugerido (admin): ventas del mismo mes de años anteriores, el sugerido del mes
// y su confirmación como objetivo del mes en curso.
//   historia-mensual   → { 'AAAA-MM': { min, may, evento, plastico, fgl, fbt } } (de la planilla)
//   sugerido/AAAA-MM   → { mes, valores, actualizado, por, confirmado, confirmadoPor }
// GET  ?mes=AAAA-MM                    → { mes, sugerido, historia: { AAAA: { valores, fuente } }, anterior }
// POST { tipo: 'planilla', registros } → meses ya terminados van a la historia; el mes en curso
//                                        y los que vienen, al sugerido de cada mes
// POST { tipo: 'sugerido', mes, valores } → guarda el sugerido editado
// POST { tipo: 'confirmar', mes }      → copia el sugerido como objetivo en Cargar ventas (borrador)
import { handler, json, readBody, requireUser, HttpError } from '../lib/auth.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { hoyAsuncion, normalizarReporte, IDS } from '../../public/js/calc.js';
import { NEGOCIOS, UNIDADES_OBJ } from '../../public/js/objetivos.js';

const MES_RE = /^\d{4}-\d{2}$/;
const IDS_NEG = NEGOCIOS.map((n) => n.id);

// Solo montos enteros ≥ 0 de negocios conocidos.
function limpiar(v = {}) {
  const out = {};
  for (const id of IDS_NEG) {
    if (v[id] === undefined || v[id] === null || v[id] === '') continue;
    const n = Math.round(Number(v[id]));
    if (Number.isFinite(n) && n >= 0) out[id] = n;
  }
  return out;
}

const mesDesplazado = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Ventas de un mes ya terminado: la planilla manda; si no está, el cierre publicado en el portal.
async function ventasDelMes(mes, historia) {
  if (historia[mes]) return { valores: historia[mes], fuente: 'planilla' };
  const cierre = await getJSON(`cierre/${mes}`);
  if (cierre?.real) return { valores: Object.fromEntries(IDS.map((id) => [id, cierre.real[id] || 0])), fuente: 'portal', corte: cierre.corte };
  return null;
}

export default handler(async (req) => {
  const user = await requireUser(req, ['admin']);
  const hoy = hoyAsuncion();
  const mesEnCurso = hoy.slice(0, 7);

  if (req.method === 'GET') {
    const pedido = new URL(req.url).searchParams.get('mes');
    const mes = pedido && MES_RE.test(pedido) ? pedido : mesEnCurso;
    const historia = await getJSON('historia-mensual', {});
    const [y] = mes.split('-').map(Number);
    const anios = {};
    for (const anio of [y - 2, y - 1]) {
      const v = await ventasDelMes(`${anio}${mes.slice(4)}`, historia);
      if (v) anios[anio] = v;
    }
    return json({
      mes, mesEnCurso,
      sugerido: await getJSON(`sugerido/${mes}`),
      historia: anios,
      anterior: await ventasDelMes(mesDesplazado(mes, -1), historia),
    });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
  const body = await readBody(req);
  const ahora = new Date().toISOString();

  if (body.tipo === 'planilla') {
    const registros = Object.entries(body.registros || {}).filter(([m]) => MES_RE.test(m));
    if (!registros.length) throw new HttpError(400, 'La planilla no tiene datos.');
    const historia = await getJSON('historia-mensual', {});
    const guardados = { historia: [], sugeridos: [] };
    for (const [mes, v] of registros) {
      const valores = limpiar(v);
      if (mes < mesEnCurso) {
        historia[mes] = valores;
        guardados.historia.push(mes);
      } else {
        const actual = await getJSON(`sugerido/${mes}`);
        await setJSON(`sugerido/${mes}`, { ...actual, mes, valores, actualizado: ahora, por: user.nombre, confirmado: null, confirmadoPor: null });
        guardados.sugeridos.push(mes);
      }
    }
    if (guardados.historia.length) await setJSON('historia-mensual', historia);
    return json({ ok: true, ...guardados });
  }

  const mes = body.mes;
  if (!mes || !MES_RE.test(mes)) throw new HttpError(400, 'Indicá el mes.');

  if (body.tipo === 'sugerido') {
    if (mes < mesEnCurso) throw new HttpError(400, 'Ese mes ya terminó: el sugerido es para el mes en curso o los que vienen.');
    const actual = await getJSON(`sugerido/${mes}`);
    const sugerido = { ...actual, mes, valores: limpiar(body.valores), actualizado: ahora, por: user.nombre, confirmado: null, confirmadoPor: null };
    await setJSON(`sugerido/${mes}`, sugerido);
    return json({ ok: true, sugerido });
  }

  if (body.tipo === 'confirmar') {
    if (mes !== mesEnCurso) throw new HttpError(400, 'Solo se puede confirmar como objetivo el sugerido del mes en curso.');
    const sugerido = await getJSON(`sugerido/${mes}`);
    const falta = NEGOCIOS.filter((n) => n.unidad && !(sugerido?.valores?.[n.id] > 0));
    if (falta.length) throw new HttpError(400, `Falta el sugerido de ${falta.map((n) => n.nombre).join(', ')}.`);

    const fuente = (await getJSON('draft')) || (await getJSON('published')) || { corte: hoy };
    let draft = normalizarReporte(fuente);
    const mesNuevo = draft.corte.slice(0, 7) !== mes;
    if (mesNuevo) {
      // Mes nuevo: ventas en cero, días automáticos y fecha de corte dentro del mes (ayer, o el 1.º).
      const ayer = new Date(`${hoy}T12:00:00Z`);
      ayer.setUTCDate(ayer.getUTCDate() - 1);
      const corteAyer = ayer.toISOString().slice(0, 10);
      draft = normalizarReporte({ corte: corteAyer.startsWith(mes) ? corteAyer : `${mes}-01`, pesos: draft.pesos, comp: draft.comp });
    }
    draft.obj = Object.fromEntries(UNIDADES_OBJ.map((id) => [id, sugerido.valores[id]]));

    // Comparativa: mes anterior y mismo mes del año anterior (en un mes nuevo se reemplaza;
    // si no, solo se completa lo que esté vacío).
    const historia = await getJSON('historia-mensual', {});
    const [ant, aa] = await Promise.all([
      ventasDelMes(mesDesplazado(mes, -1), historia),
      ventasDelMes(mesDesplazado(mes, -12), historia),
    ]);
    for (const [clave, datos] of [['ant', ant], ['aa', aa]]) {
      if (!datos) continue;
      for (const id of UNIDADES_OBJ) {
        if (mesNuevo || !draft.comp[clave][id]) draft.comp[clave][id] = Math.round(Number(datos.valores[id]) || 0);
      }
    }
    await setJSON('draft', { ...draft, actualizado: ahora, por: user.nombre });
    const confirmado = { ...sugerido, confirmado: ahora, confirmadoPor: user.nombre };
    await setJSON(`sugerido/${mes}`, confirmado);
    return json({ ok: true, sugerido: confirmado, draft, mesNuevo, comparativa: { ant: Boolean(ant), aa: Boolean(aa) } });
  }

  throw new HttpError(400, 'Tipo de pedido desconocido.');
});

export const config = { path: '/api/objetivos' };
