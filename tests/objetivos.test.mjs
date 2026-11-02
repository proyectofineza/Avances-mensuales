// Lectura de la planilla del objetivo sugerido.
import assert from 'node:assert/strict';
import { leerPlanillaObjetivos, registrosPorMes, totales, variacion, diferenciasTotales } from '../public/js/objetivos.js';

// La planilla tal como se pega de Excel (dos bloques; "MAYO" es un resto del encabezado).
const planilla = [
  'AÑO\t2024\t2025\t2026',
  'NEGOCIO\tOctubre\tMAYO\t',
  'BARATOTE\t19.121.623.329\t17.705.498.405\t19.172.410.146',
  'MINORISTA\t12.210.262.820\t12.248.525.596\t11.214.872.223',
  'MAYORISTA\t6.746.350.444\t5.456.972.809\t7.957.537.923',
  'EVENTO\t\t162.207.142\t',
  'FINEGLASS\t4.294.201.993\t4.445.830.656\t6.218.134.392',
  'FINEBOATS\t277.100.000\t226.325.000\t463.879.500',
  'GENERAL\t23.527.915.257\t22.539.861.203\t25.854.424.038',
  '\t\t\t',
  '\t\t\t',
  'AÑO\t2024\t2025\t2026',
  'NEGOCIO\tNoviembre\tMAYO\t',
  'BARATOTE\t21.744.266.658\t22.700.000.000\t22.700.000.000',
  'MINORISTA\t13.817.120.269\t14.128.920.265\t14.500.000.000',
  'MAYORISTA\t7.760.301.567\t5.109.550.641\t8.200.000.000',
  'EVENTO\t166.844.822\t113.836.368\t0',
  'PLASTICO\t0\t\t0',
  'FINEGLASS\t4.324.426.566\t4.324.426.566\t6.300.000.000',
  'FINEBOATS\t0\t182.576.500\t565.000.000',
  'GENERAL\t26.068.693.224\t27.207.003.066\t29.565.000.000',
].join('\r\n');

const r = leerPlanillaObjetivos(planilla);
assert.deepEqual(r.errores, []);
assert.equal(r.bloques.length, 2);
assert.equal(r.bloques[0].mes, 10); // "Octubre" (el "MAYO" de al lado se ignora)
assert.equal(r.bloques[1].mes, 11);
const reg = registrosPorMes(r.bloques);
assert.deepEqual(Object.keys(reg).sort(), ['2024-10', '2024-11', '2025-10', '2025-11', '2026-10', '2026-11']);
assert.deepEqual(reg['2026-11'], { min: 14500e6, may: 8200e6, evento: 0, plastico: 0, fgl: 6300e6, fbt: 565e6 });
assert.equal(reg['2025-10'].evento, 162207142);
assert.equal('evento' in reg['2024-10'], false); // celda vacía = sin dato
assert.equal('plastico' in reg['2025-11'], false);

// Los totales coinciden con los de la planilla (Baratote y General)
assert.deepEqual(totales(reg['2026-11']), { baratote: 22700e6, general: 29565e6 });
assert.deepEqual(totales(reg['2025-10']), { baratote: 17705498405, general: 22539861203 });
assert.deepEqual(totales(reg['2024-11']), { baratote: 21577421836, general: 26068693224 }); // la planilla dice 21.744 M de Baratote 2024: no cierra con Min + May
// Totales de la planilla que no cierran con la suma: Baratote oct y nov 2024, Baratote y General nov 2025
assert.deepEqual(diferenciasTotales(r.bloques).map((d) => `${d.mes}/${d.anio} ${d.campo}`), ['10/2024 baratote', '11/2024 baratote', '11/2025 baratote', '11/2025 general']);
assert.equal(diferenciasTotales(r.bloques)[2].calculado, 19238470906);
assert.equal(variacion(110, 100).toFixed(2), '0.10');
assert.equal(variacion(5, 0), null);

// Sin fila NEGOCIO: usa el mes elegido; sin mes, avisa
assert.equal(leerPlanillaObjetivos('AÑO\t2025\nMINORISTA\t10', 3).bloques[0].mes, 3);
assert.match(leerPlanillaObjetivos('AÑO\t2025\nMINORISTA\t10').errores[0].motivo, /sin mes/);
// Negocio desconocido y monto inválido
const mal = leerPlanillaObjetivos('AÑO\t2025\nNEGOCIO\tMarzo\nOTRA COSA\t5\nFINEGLASS\tabc');
assert.equal(mal.errores.length, 2);
// Separado por punto y coma (CSV de Excel)
assert.equal(registrosPorMes(leerPlanillaObjetivos('AÑO;2025\nNEGOCIO;Setiembre\nFINEBOATS;1.000').bloques)['2025-09'].fbt, 1000);

console.log('objetivos: todas las pruebas pasaron');
