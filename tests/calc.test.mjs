// Pruebas de las reglas de cálculo: node tests/calc.test.mjs
import assert from 'node:assert/strict';
import {
  diasOperativos, calcUnidad, calcularReporte, estado, normalizarReporte, validarReporte,
  mesAnterior, mismoMesAnioAnterior, fmtVar, fmtMillones, fmtPct, fmtFecha, fmtCI, nombreMes,
} from '../public/js/calc.js';

// Octubre 2026: 31 días, 22 hábiles (lun a vie). El 1/10 es jueves.
assert.deepEqual(diasOperativos('2026-10-22', 'lun-dom'), { operados: 22, mes: 31 });
assert.deepEqual(diasOperativos('2026-10-22', 'lun-vie'), { operados: 16, mes: 22 });
assert.deepEqual(diasOperativos('2026-10-03', 'lun-vie'), { operados: 2, mes: 22 }); // sábado
assert.deepEqual(diasOperativos('2026-02-28', 'lun-dom'), { operados: 28, mes: 28 });

// Unidad lun a lun
const u = calcUnidad(1_100_000_000, 1_550_000_000, diasOperativos('2026-10-22', 'lun-dom'));
assert.equal(u.proyeccion, 1_100_000_000 / 22 * 31);
assert.equal(u.faltante, 450_000_000);
assert.equal(u.diasRestantes, 9);
assert.equal(u.necesarioDia, 50_000_000);
assert.equal(u.promedioDia, 50_000_000);

// Fineglass solo cuenta lun a vie
const fg = calcUnidad(320_000_000, 500_000_000, diasOperativos('2026-10-22', 'lun-vie'));
assert.equal(fg.proyeccion, 320_000_000 / 16 * 22);
assert.equal(fg.diasRestantes, 6);

// Último día: no quedan días
const fin = calcUnidad(100, 200, diasOperativos('2026-10-31', 'lun-dom'));
assert.equal(fin.necesarioDia, 0);
assert.equal(fin.proyeccion, 100);

// Totales: proyección total = suma de proyecciones
const base = {
  corte: '2026-10-22',
  obj: { may: 1_000e6, min: 550e6, fgl: 500e6, fbt: 300e6 },
  real: { may: 700e6, min: 400e6, fgl: 320e6, fbt: 230e6 },
};
const r = calcularReporte(base);
const suma = ['may', 'min', 'fgl', 'fbt'].reduce((s, id) => s + r.unidades[id].proyeccion, 0);
assert.equal(r.total.proyeccion, suma);
assert.equal(r.total.objetivo, 2_350e6);
assert.equal(r.baratote.real, 1_100e6);
assert.equal(r.total.ritmoIdeal, 22 / 31);
// Baratote = suma de canales, con su propio ritmo necesario
assert.equal(r.baratote.objetivo, 1_550e6);
assert.equal(r.baratote.faltante, 450e6);
assert.equal(r.baratote.necesarioDia, 50e6);
assert.equal(r.baratote.promedioDia, 50e6);
// Sin datos de comparación: variaciones nulas
assert.equal(r.total.varAnt, null);

// Días manuales: reemplazan al calendario
const man = calcularReporte({
  ...base,
  dias: { modo: 'manual', may: { mes: 26, curso: 20 }, min: { mes: 26, curso: 20 }, fgl: { mes: 20, curso: 15 }, fbt: { mes: 30, curso: 22 } },
});
assert.equal(man.unidades.may.proyeccion, 700e6 / 20 * 26);
assert.equal(man.unidades.fgl.proyeccion, 320e6 / 15 * 20);
assert.equal(man.unidades.fgl.diasRestantes, 5);
assert.equal(man.baratote.diasMes, 26);
const ponderado = (1_000e6 * 20 / 26 + 550e6 * 20 / 26 + 500e6 * 15 / 20 + 300e6 * 22 / 30) / 2_350e6;
assert.ok(Math.abs(man.total.ritmoIdeal - ponderado) < 1e-12);
// Modo automático ignora los días cargados
const auto = calcularReporte({ ...base, dias: { modo: 'auto', may: { mes: 5, curso: 1 } } });
assert.equal(auto.unidades.may.proyeccion, r.unidades.may.proyeccion);

// Comparativa: proyección vs mes anterior y año anterior
const cmp = calcularReporte({
  ...base,
  comp: { ant: { may: 900e6, min: 500e6, fgl: 400e6, fbt: 0 }, aa: { may: 800e6, min: 450e6, fgl: 380e6, fbt: 250e6 } },
});
assert.equal(cmp.unidades.may.varAnt, cmp.unidades.may.proyeccion / 900e6 - 1);
assert.equal(cmp.unidades.fbt.varAnt, null);
assert.equal(cmp.baratote.ant, 1_400e6);
assert.equal(cmp.total.aa, 1_880e6);
assert.equal(cmp.total.varAa, cmp.total.proyeccion / 1_880e6 - 1);

// Normalización y validación
const n = normalizarReporte({ corte: '2026-10-22', obj: { may: '5' }, dias: { modo: 'manual', fgl: { mes: 40, curso: -2 } } });
assert.equal(n.obj.may, 5);
assert.equal(n.obj.fgl, 0);
assert.deepEqual(n.dias.fgl, { mes: 31, curso: 0 });
assert.equal(validarReporte(normalizarReporte({ ...base, corte: '' })), 'Indicá la fecha de corte.');
assert.equal(validarReporte(normalizarReporte(base)), null);
const malDias = normalizarReporte({ ...base, dias: { modo: 'manual', may: { mes: 26, curso: 30 }, min: { mes: 26, curso: 20 }, fgl: { mes: 20, curso: 15 }, fbt: { mes: 30, curso: 22 } } });
assert.equal(validarReporte(malDias), 'Revisá el día en curso de Mayorista: tiene que estar entre 1 y 26.');

// Meses de comparación
assert.equal(mesAnterior('2026-10-22'), 'Septiembre 2026');
assert.equal(mesAnterior('2026-01-10'), 'Diciembre 2025');
assert.equal(mismoMesAnioAnterior('2026-10-22'), 'Octubre 2025');

// Estados
assert.equal(estado(1).texto, 'En camino');
assert.equal(estado(0.95).texto, 'Ajustado');
assert.equal(estado(0.9).texto, 'Ajustado');
assert.equal(estado(0.899).texto, 'En riesgo');

// Formato
assert.equal(fmtMillones(1_930_400_000), 'Gs. 1.930 M');
assert.equal(fmtPct(0.704), '70,4%');
assert.equal(fmtVar(0.052), '+5,2%');
assert.equal(fmtVar(-0.1), '−10,0%');
assert.equal(fmtVar(null), '—');
assert.equal(fmtFecha('2026-10-05'), '05/10/2026');
assert.equal(fmtCI('4567890'), '4.567.890');
assert.equal(nombreMes('2026-10-22'), 'Octubre 2026');

console.log('calc: todas las pruebas pasaron');
