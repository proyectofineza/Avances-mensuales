// Tarea programada: los lunes a las 08:00 de Asunción (11:00 UTC) manda a Teams el resumen semanal de
// sucursales. Solo si el administrador lo activó y una vez por semana.
import { getJSON, setJSON } from '../lib/store.mjs';
import { CLAVE_SEMANAL, enviarResumenSemanal } from '../lib/resumen-semanal.mjs';
import { hoyAsuncion } from '../../public/js/calc.js';

export default async () => {
  try {
    const cfg = await getJSON(CLAVE_SEMANAL, {});
    if (!cfg.activo) return;
    const hoy = hoyAsuncion();
    if (cfg.ultimo === hoy) return;
    const res = await enviarResumenSemanal({ hoy });
    if (res.ok) await setJSON(CLAVE_SEMANAL, { ...cfg, ultimo: hoy });
    console.log('Resumen semanal', hoy, res.ok ? 'enviado' : `omitido: ${res.detalle}`);
  } catch (err) {
    console.error('No se pudo mandar el resumen semanal', err);
  }
};

export const config = { schedule: '0 11 * * 1' };
