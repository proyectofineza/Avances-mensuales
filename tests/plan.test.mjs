// Plan de lo que queda del mes: node tests/plan.test.mjs
import assert from 'node:assert/strict';
import {
  planRestante, calcularReporte, PESOS_MINORISTA, AJUSTE_LLUVIA, normalizarEspeciales, hayEspeciales, cumplimientoPlan, repartirMinorista,
} from '../public/js/calc.js';

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

// ---- Meta alternativa ----
const p105 = planRestante(data, { meta: 1.05 });
cerca(p105.unidades.may.objetivo, 105);
assert.deepEqual(p105.unidades.may.dias.map((d) => Math.round(d.monto * 10) / 10), [22.5, 22.5]);

// ---- Clima: Minorista pesa menos el día con lluvia ----
const pc = planRestante(data, { pronostico: [{ fecha: '2026-11-29', lluvia: 12 }, { fecha: '2026-11-30', lluvia: 0 }] });
const wDom = 24.2 * AJUSTE_LLUVIA.factorLluvia, wLun = 1.4 * AJUSTE_LLUVIA.factorSeco;
cerca(pc.unidades.min.dias[0].monto, 400 * wDom / (wDom + wLun));
assert.equal(pc.unidades.min.dias[0].lluvia, true);
assert.equal(pc.unidades.may.dias[0].lluvia, undefined); // el clima solo ajusta Minorista
assert.deepEqual(pc.unidades.may.dias.map((d) => d.monto), [20, 20]);

// ---- Fechas especiales ----
assert.deepEqual(normalizarEspeciales([
  { fecha: '2026-12-24', factor: '1,8', nota: '  Nochebuena  ' }, { fecha: 'mal', factor: 2 }, { fecha: '2026-12-25', factor: 9 },
  { fecha: '2026-12-24', factor: 2 },
]), [{ fecha: '2026-12-24', factor: 2, nota: '' }, { fecha: '2026-12-25', factor: 5, nota: '' }]);
const dic = { corte: '2026-12-22', obj: { may: 100, min: 100, fgl: 100, fbt: 100 }, real: { may: 0, min: 0, fgl: 0, fbt: 0 }, pesos: PESOS_MINORISTA,
  especiales: [{ fecha: '2026-12-24', factor: 2 }, { fecha: '2026-12-25', factor: 0 }] };
assert.equal(hayEspeciales(dic.corte, dic.especiales), true);
assert.equal(hayEspeciales('2026-11-10', dic.especiales), false);
const pd = planRestante(dic);
// Mayorista: del 23 al 31 son 9 días; el 24 vale 2 y el 25 vale 0 → 9 puntos.
const may = Object.fromEntries(pd.unidades.may.dias.map((d) => [d.fecha.slice(8), d.monto]));
cerca(may['24'], 100 * 2 / 9); cerca(may['25'], 0); cerca(may['23'], 100 / 9);
// La proyección de Mayorista también usa las fechas especiales (deja de ser lineal).
const rd = calcularReporte({ ...dic, real: { may: 50, min: 50, fgl: 50, fbt: 50 } });
assert.equal(rd.unidades.may.ponderada, true);
assert.equal(rd.especiales, true);
cerca(rd.unidades.may.ritmoIdeal, 22 / (22 + 9)); // 22 días hechos de 31 puntos (24 = 2, 25 = 0)
assert.equal(calcularReporte(data).unidades.may.ponderada, false); // sin fechas especiales, como siempre

// ---- Plan contra lo vendido ----
const h = [
  { corte: '2026-11-27', obj: data.obj, real: { may: 50, min: 550, fgl: 210, fbt: 0 }, pesos: PESOS_MINORISTA },
  { corte: '2026-11-28', obj: data.obj, real: data.real, pesos: PESOS_MINORISTA },
  { corte: '2026-10-31', obj: data.obj, real: data.real, pesos: PESOS_MINORISTA }, // de otro mes: no cuenta
];
const cp = cumplimientoPlan(h);
assert.equal(cp.length, 1);
assert.deepEqual([cp[0].desde, cp[0].hasta, cp[0].dias], ['2026-11-28', '2026-11-28', 1]);
cerca(cp[0].unidades.may.plan, 50 / 3); // faltaban 50 en 3 días
assert.equal(cp[0].unidades.may.vendido, 10);
assert.equal(cp[0].total.vendido, 10 + 50 + 20 + 0);

// ---- Plan por sucursal ----
const rs = repartirMinorista('2026-11-28', 256, PESOS_MINORISTA);
assert.deepEqual(rs.map((x) => x.fecha), ['2026-11-29', '2026-11-30']);
cerca(rs[0].monto, 256 * 24.2 / 25.6);
assert.deepEqual(repartirMinorista('2026-11-30', 10), []);
assert.deepEqual(repartirMinorista('2026-11-28', 0), []);

console.log('plan: todas las pruebas pasaron');
