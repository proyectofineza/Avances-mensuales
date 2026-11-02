// Comparativo anual: acumulado del año, brecha, proyección y tabla de variaciones.
import assert from 'node:assert/strict';
import { valorUnidad, resumenAnual, tablaVariaciones, faltaParaIgualar } from '../public/js/anual.js';

const k = (a, m) => `${a}-${String(m).padStart(2, '0')}`;
const meses = {};
for (let m = 1; m <= 12; m++) {
  meses[k(2024, m)] = { min: 90, may: 10, fgl: 20, fbt: 5 };           // 125 por mes
  meses[k(2025, m)] = { min: 100, may: 20, fgl: 20, fbt: 5 };          // 145 por mes
}
// 2026 hasta octubre: cada mes un poco mejor que el anterior contra 2025
for (let m = 1; m <= 10; m++) meses[k(2026, m)] = { min: 100 + m, may: 20, fgl: 20, fbt: 5 };
meses[k(2026, 2)] = { min: 90, may: 20, fgl: 20, fbt: 5 }; // febrero cae

assert.equal(valorUnidad(meses['2026-01'], 'total'), 146);
assert.equal(valorUnidad(meses['2026-01'], 'bar'), 121);
assert.equal(valorUnidad({ fgl: 3 }, 'bar'), null);
assert.equal(valorUnidad({ min: 0 }, 'min'), 0);

const enCurso = { mes: '2026-11', real: { min: 30 }, proyeccion: { min: 115, may: 20, fgl: 20, fbt: 5 } };
const r = resumenAnual(meses, enCurso, 'total');
assert.equal(r.anio, 2026); assert.equal(r.n, 10);
const ytd26 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].reduce((s, m) => s + (m === 2 ? 135 : 145 + m), 0);
assert.equal(r.ytd.y, ytd26); assert.equal(r.ytd.y1, 1450); assert.equal(r.ytd.y2, 1250);
assert.equal(r.ventaja, ytd26 - 1450);
assert.equal(r.varYtd1, ytd26 / 1450 - 1);
// La brecha creció de marzo a octubre: 8 meses seguidos
assert.deepEqual(r.racha, { sube: true, meses: 8 });
assert.equal(r.ultimoMes.mes, 10); assert.equal(r.ultimoMes.valor, 155);
assert.equal(r.ultimoMes.vsAnterior, 155 / 154 - 1);
assert.equal(r.ultimoMes.vsAnioAnterior, 155 / 145 - 1);
assert.deepEqual(r.mejor, { mes: 10, valor: 155 });
assert.equal(r.peor.mes, 2);
// Proyección: noviembre = lo publicado (160); diciembre = 145 × tendencia de ago–oct (153+154+155)/(3×145)
const t = (153 + 154 + 155) / 435;
assert.equal(r.proyeccion.enCurso, true);
assert.equal(r.proyeccion.serie[10], 160);
assert.ok(Math.abs(r.proyeccion.serie[11] - 145 * t) < 1e-9);
assert.ok(Math.abs(r.proyeccion.total - (ytd26 + 160 + 145 * t)) < 1e-9);
assert.equal(r.proyeccion.serie[9], null);

// Sin mes en curso publicado: noviembre también sale de la tendencia
assert.equal(resumenAnual(meses, null, 'total').proyeccion.enCurso, false);
// Mes en curso recién empezado (proyección en 0): también sale de la tendencia, no de un cero
const recien = resumenAnual(meses, { mes: '2026-11', real: {}, proyeccion: { min: 0, may: 0, fgl: 0, fbt: 0 } }, 'total');
assert.equal(recien.proyeccion.enCurso, false);
assert.ok(Math.abs(recien.proyeccion.serie[10] - 145 * t) < 1e-9);
// Fineboats: igual que 2025 → sin brecha que crezca
const fb = resumenAnual(meses, null, 'fbt');
assert.equal(fb.varYtd1, 0); assert.equal(fb.peor, null);
// Un año sin el anterior completo: no hay acumulado comparable ni proyección
const solo = resumenAnual({ '2026-01': { min: 5 } }, null, 'min');
assert.equal(solo.ytd.y1, null); assert.equal(solo.varYtd1, null); assert.equal(solo.proyeccion, null);
// Enero del año nuevo sin meses cerrados todavía
const enero = resumenAnual(meses, { mes: '2027-01', proyeccion: { min: 1 } }, 'total');
assert.equal(enero.anio, 2027); assert.equal(enero.n, 0); assert.equal(enero.ultimoMes, null);
assert.equal(resumenAnual({}, null), null);

// Tabla de variaciones por unidad
const tabla = tablaVariaciones(meses, 2026, 10);
const min = tabla.find((x) => x.id === 'min');
assert.equal(min.celdas[0].variacion, 101 / 100 - 1);
assert.equal(min.celdas[10].valor, null); assert.equal(min.celdas[10].variacion, null);
assert.equal(tabla.find((x) => x.id === 'fbt').acumulado, 0);
assert.equal(tabla.length, 6);
assert.equal(min.diferencia, (101 + 90 + 103 + 104 + 105 + 106 + 107 + 108 + 109 + 110) - 1000);
// Contra dos años antes, y un año pasado completo contra el suyo
const vs24 = tablaVariaciones(meses, 2026, 10, 2024).find((x) => x.id === 'min');
assert.equal(vs24.celdas[0].variacion, 101 / 90 - 1);
const t25 = tablaVariaciones(meses, 2025, 12).find((x) => x.id === 'total');
assert.equal(t25.acumulado, 145 / 125 - 1); assert.equal(t25.diferencia, 240);

// Cuánto falta para igualar 2025: total 1740, vendido ytd26; quedan nov y dic (290 en 2025)
const falta = faltaParaIgualar(meses, null).find((x) => x.id === 'total');
assert.equal(falta.totalAnterior, 1740); assert.equal(falta.vendido, ytd26);
assert.equal(falta.falta, 1740 - ytd26); assert.equal(falta.mesesQuedan, 2);
assert.equal(falta.crecimientoNecesario, (1740 - ytd26) / 290 - 1);
assert.equal(falta.alcanza, true);
assert.deepEqual(faltaParaIgualar({ '2026-01': { min: 5 } }, null), []);

console.log('anual: todas las pruebas pasaron');
