// Tarea programada: cada mañana a las 08:00 de Asunción (11:00 UTC) manda a Teams lo que hay que
// vender ese día para llegar al objetivo. Solo si el administrador lo activó y una vez por día.
import { getJSON, setJSON } from '../lib/store.mjs';
import { CLAVE_AVISO, enviarAvisoDiario } from '../lib/aviso-diario.mjs';
import { hoyAsuncion } from '../../public/js/calc.js';

export default async () => {
  try {
    const cfg = await getJSON(CLAVE_AVISO, {});
    if (!cfg.activo) return;
    const hoy = hoyAsuncion();
    if (cfg.ultimo === hoy) return;
    const res = await enviarAvisoDiario({ fecha: hoy });
    if (res.ok) await setJSON(CLAVE_AVISO, { ...cfg, ultimo: hoy });
    console.log('Aviso diario', hoy, res.ok ? 'enviado' : `omitido: ${res.detalle}`);
  } catch (err) {
    console.error('No se pudo mandar el aviso diario', err);
  }
};

export const config = { schedule: '0 11 * * *' };
