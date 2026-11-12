// Aviso diario por Teams con lo que hay que vender ese día (lo usan la tarea programada y la prueba).
// Configuración en el blob `teams-aviso-diario`: { activo, ultimo, actualizado, por }.
import { getJSON } from './store.mjs';
import { tarjetaPlanDiario, enviarTarjeta, teamsConfigurado } from './teams.mjs';
import { planRestante, hoyAsuncion, fmtFecha } from '../../public/js/calc.js';

export const CLAVE_AVISO = 'teams-aviso-diario';

// Arma y manda el aviso. En la prueba, si hoy no está en el plan, usa el primer día que queda.
// Devuelve { ok, detalle?, fecha? }.
export async function enviarAvisoDiario({ fecha = hoyAsuncion(), prueba = false, origen } = {}) {
  if (!teamsConfigurado()) return { ok: false, detalle: 'Teams no está configurado.' };
  const published = await getJSON('published');
  if (!published?.corte) return { ok: false, detalle: 'Todavía no hay nada publicado.' };
  const plan = planRestante(published);
  if (!plan) return { ok: false, detalle: 'Con los días cargados a mano no hay plan por fecha.' };
  let dia = fecha;
  if (!plan.fechas.includes(dia)) {
    if (!prueba || !plan.fechas.length) {
      return { ok: false, detalle: `El ${fmtFecha(fecha)} no está en el plan: lo publicado llega al ${fmtFecha(published.corte)}.` };
    }
    dia = plan.fechas[0];
  }
  const [history, clima] = await Promise.all([
    getJSON(`history/${published.corte.slice(0, 7)}`, []),
    getJSON('clima'),
  ]);
  const tarjeta = tarjetaPlanDiario(published, { fecha: dia, history, clima: clima?.dias || [], prueba, origen });
  if (!tarjeta) return { ok: false, detalle: 'No se pudo armar el aviso.' };
  const res = await enviarTarjeta(tarjeta);
  return { ...res, fecha: dia };
}
