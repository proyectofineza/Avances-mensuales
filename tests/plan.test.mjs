// Plan de lo que queda del mes: node tests/plan.test.mjs
import assert from 'node:assert/strict';
import { planRestante, calcularReporte, PESOS_MINORISTA } from '../public/js/calc.js';

const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

// Noviembre 2026 (30 días). Corte el sábado 28: quedan dom 29 y lun 30.
const data = {
  corte: '2026-11-28',
  obj: { may: 100, min: 1000, fgl: 220, fbt: 30 },
  real: { may: 60, min: 600, fgl: 230, fbt: 0 },
  pesos: PESOS_MINORISTA,
};
const p = planRestante(data);
assert.deepEqual(p.fechas, ['2026-11-29', '2026-11-30']);
// Mayorista: faltan 40 en 2 días → 20 y 20, y el acumulado llega a 100.
assert.deepEqual(p.unidades.may.dias.map((d) => d.monto), [20, 20]);
assert.deepEqual(p.unidades.may.dias.map((d) => d.acumulado), [80, 100]);
// Minorista: faltan 400, repartidos según el peso del domingo (24,2) y el lunes (1,4).
cerca(p.unidades.min.dias[0].monto, 400 * 24.2 / 25.6);
cerca(p.unidades.min.dias[1].monto, 400 * 1.4 / 25.6);
cerca(p.unidades.min.dias[1].acumulado, 1000);
// Fineglass ya superó el objetivo: no hace falta vender nada.
assert.equal(p.unidades.fgl.faltante, 0);
assert.deepEqual(p.unidades.fgl.dias.map((d) => d.monto), [0, 0]);
// Fineboats: 30 en partes iguales.
assert.deepEqual(p.unidades.fbt.dias.map((d) => d.monto), [15, 15]);
// Baratote suma Mayorista y Minorista día por día.
cerca(p.baratote.dias[0].monto, 20 + 400 * 24.2 / 25.6);
cerca(p.baratote.dias[1].acumulado, 1100);
assert.equal(p.baratote.faltante, 440);
// Total: suma lo que falta en cada unidad (lo que sobra en Fineglass no tapa a las otras).
assert.equal(p.total.faltante, 40 + 400 + 30);

// Fineglass solo vende de lunes a viernes: el domingo no lleva nada.
const p2 = planRestante({ ...data, real: { ...data.real, fgl: 200 } });
assert.deepEqual(p2.unidades.fgl.dias.map((d) => d.monto), [0, 20]);

// Si los días que quedan no tienen peso, Minorista reparte en partes iguales.
const p3 = planRestante({ ...data, pesos: { ...PESOS_MINORISTA, dom: 0, lun: 0 } });
assert.deepEqual(p3.unidades.min.dias.map((d) => d.monto), [200, 200]);

// Último día del mes: no queda nada. Modo manual: no hay plan por fecha.
assert.deepEqual(planRestante({ ...data, corte: '2026-11-30' }).fechas, []);
assert.equal(planRestante({ ...data, dias: { modo: 'manual' } }), null);

// Promedio ideal por día: objetivo / días del mes.
const r = calcularReporte({ ...data, corte: '2026-11-10' });
cerca(r.unidades.may.promedioIdeal, 100 / 30);
cerca(r.unidades.fgl.promedioIdeal, 220 / 21); // noviembre 2026 tiene 21 días hábiles
cerca(r.total.promedioIdeal, 1350 / 30);

console.log('plan: todas las pruebas pasaron');
