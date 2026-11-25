// Resumen semanal de sucursales por Teams (lo usan la tarea programada de los lunes y la prueba).
// Configuración en el blob `teams-resumen-semanal`: { activo, ultimo, actualizado, por }.
import { getJSON } from './store.mjs';
import { tarjetaResumenSemanal, enviarTarjeta, teamsConfigurado } from './teams.mjs';
import { hoyAsuncion, normalizarPesos, normalizarEspeciales } from '../../public/js/calc.js';
import { resumenSemanal, sumarDias } from '../../public/js/reportes.js';

export const CLAVE_SEMANAL = 'teams-resumen-semanal';

// Arma el resumen con lo cargado hasta ayer. Devuelve { ok, detalle?, desde?, hasta? }.
export async function enviarResumenSemanal({ hoy = hoyAsuncion(), prueba = false, origen } = {}) {
  if (!teamsConfigurado()) return { ok: false, detalle: 'Teams no está configurado.' };
  const ayer = sumarDias(hoy, -1);
  const index = (await getJSON('sucursales/index', [])).sort();
  // El mes de ayer; si todavía no se cargó nada de ese mes (lunes 1.º), el último mes cargado.
  const mes = index.includes(ayer.slice(0, 7)) ? ayer.slice(0, 7) : index.filter((m) => m <= ayer.slice(0, 7)).at(-1);
  if (!mes) return { ok: false, detalle: 'Todavía no hay ventas por sucursal cargadas.' };
  const [datos, objetivos, maestro, cerradas, published] = await Promise.all([
    getJSON(`sucursales/${mes}`, { filas: [] }),
    getJSON(`sucursales-objetivos/${mes}`, { filas: [] }),
    getJSON('sucursales-maestro', { filas: [] }),
    getJSON('sucursales-cerradas', { filas: [] }),
    getJSON('published'),
  ]);
  const fuera = new Set((cerradas?.filas || []).map((c) => c.sucursal));
  const objs = (objetivos?.filas || []).filter((o) => !fuera.has(o.sucursal));
  if (!objs.length) return { ok: false, detalle: `No hay objetivos por sucursal cargados para ${mes}.` };
  // Peso de cada día: el del reporte publicado si es de ese mes (igual que el portal).
  const pesos = published?.corte?.startsWith(mes) && published.pesos ? normalizarPesos(published.pesos) : undefined;
  const r = resumenSemanal({
    filas: datos?.filas || [], objetivos: objs, maestro: maestro?.filas || [],
    pesos, especiales: normalizarEspeciales(published?.especiales), ayer,
  });
  if (!r) return { ok: false, detalle: 'No hay ventas cargadas hasta ayer.' };
  // Si lo último cargado tiene más de 3 días, la tarea programada no manda nada (datos viejos).
  if (!prueba && r.hasta < sumarDias(ayer, -3)) return { ok: false, detalle: `Las ventas por sucursal llegan al ${r.hasta}: no se manda un resumen con datos viejos.` };
  const res = await enviarTarjeta(tarjetaResumenSemanal(r, { prueba, origen }));
  return { ...res, desde: r.desde, hasta: r.hasta };
}
