import assert from 'node:assert/strict';
import { resumirMes, avanceSucursales } from '../public/js/sucursales.js';
import {
  resumenSupervisores, mejorasSucursales, matrizSucursales, coberturaMatriz, resumenSemanal, sumarDias, mesPrevio, mesAnioAnterior, SIN_SUPERVISOR,
} from '../public/js/reportes.js';
import { metaDiaria, vistaSucursal } from '../public/js/portal-sucursal.js';
import { fraccionPonderada } from '../public/js/calc.js';

assert.equal(sumarDias('2026-11-30', 1), '2026-12-01');
assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
assert.equal(mesPrevio('2026-01'), '2025-12');
assert.equal(mesAnioAnterior('2026-11'), '2025-11');

// Noviembre 2026, días 1 a 14: A vende parejo, B arranca flojo y repunta la segunda semana, C solo vende.
const filas = [];
for (let d = 1; d <= 14; d++) {
  const f = `2026-11-${String(d).padStart(2, '0')}`;
  filas.push({ sucursal: 'A', fecha: f, monto: 10e6 });
  filas.push({ sucursal: 'B', fecha: f, monto: d <= 7 ? 2e6 : 12e6 });
  filas.push({ sucursal: 'C', fecha: f, monto: 5e6 });
}
const res = resumirMes(filas);
const objetivos = [{ sucursal: 'A', objetivo: 250e6 }, { sucursal: 'B', objetivo: 250e6 }];
const avance = avanceSucursales(res, objetivos, '2026-11-14');

// ---- Supervisores ----
const maestro = [{ sucursal: 'A', supervisor: 'Juan' }, { sucursal: 'B', supervisor: 'Juan' }];
const sup = resumenSupervisores(res, avance, maestro);
assert.deepEqual(sup.map((g) => g.supervisor), ['Juan', SIN_SUPERVISOR]); // sin supervisor al final
assert.equal(sup[0].sucursales.length, 2);
assert.equal(sup[0].objetivo, 500e6);
assert.equal(sup[0].verdes + sup[0].amarillas + sup[0].rojas, 2);
assert.equal(sup[1].sinObjetivo, 1); // C no tiene objetivo
assert.equal(sup[1].pct, null);
assert.ok(Math.abs(sup[0].pct - (avance.get('A').proyeccion + avance.get('B').proyeccion) / 500e6) < 1e-12);
// La mejor sucursal del grupo va primero.
assert.equal(sup[0].sucursales[0].sucursal, avance.get('A').proyeccionPct >= avance.get('B').proyeccionPct ? 'A' : 'B');

// ---- Más mejoraron ----
const mej = mejorasSucursales(res, objetivos, { hasta: '2026-11-14' });
assert.equal(mej[0].sucursal, 'B'); // B repuntó
assert.ok(mej[0].cambio > 0);
assert.equal(mej[0].ventaPeriodo, 7 * 12e6);
assert.ok(Math.abs(mej[0].ahora - avance.get('B').proyeccionPct) < 1e-12);
// Sin una semana cargada en el mes no hay comparación.
assert.deepEqual(mejorasSucursales(res, objetivos, { hasta: '2026-11-05' }), []);
assert.deepEqual(mejorasSucursales(res, [], { hasta: '2026-11-14' }), []);

// ---- Matriz ----
const mensual = { '2025-11': { A: 200e6, B: 400e6 }, '2026-10': { A: 300e6 } };
const mz = new Map(matrizSucursales(avance, mensual, '2026-11', 'anio').map((p) => [p.sucursal, p]));
assert.ok(Math.abs(mz.get('A').crecimiento - (avance.get('A').proyeccion / 200e6 - 1)) < 1e-12);
assert.equal(mz.get('A').referencia, 200e6);
const cuadrante = (p) => (p.cumplimiento >= 1 ? (p.crecimiento >= 0 ? 'estrella' : 'facil') : (p.crecimiento >= 0 ? 'empuje' : 'atencion'));
for (const p of mz.values()) assert.equal(p.cuadrante, cuadrante(p));
const mzMes = new Map(matrizSucursales(avance, mensual, '2026-11', 'mes').map((p) => [p.sucursal, p]));
assert.equal(mzMes.get('B').crecimiento, null); // B no tiene octubre
assert.equal(mzMes.get('B').cuadrante, null);
assert.deepEqual(coberturaMatriz(avance, mensual, '2026-11'), { anio: 2, mes: 1, total: 2 });

// ---- Resumen semanal ----
const sem = resumenSemanal({ filas, objetivos, maestro, ayer: '2026-11-15' });
assert.equal(sem.hasta, '2026-11-14');
assert.equal(sem.desde, '2026-11-08');
assert.equal(sem.semana.venta, 7 * 10e6 + 7 * 12e6); // solo las que tienen objetivo
assert.equal(sem.semana.ventaTodas, 7 * 10e6 + 7 * 12e6 + 7 * 5e6);
const fSem = fraccionPonderada('2026-11-14') - fraccionPonderada('2026-11-07');
assert.ok(Math.abs(sem.semana.plan - 500e6 * fSem) < 1);
assert.equal(sem.mesActual.vendido, 14 * 10e6 + 7 * 2e6 + 7 * 12e6);
assert.equal(sem.cuenta.ok + sem.cuenta.warn + sem.cuenta.risk, 2);
assert.equal(sem.mejores.length, 2);
assert.equal(sem.mejoras[0].sucursal, 'B');
assert.equal(sem.supervisores[0].supervisor, 'Juan');
// "ayer" corta lo cargado después.
assert.equal(resumenSemanal({ filas, objetivos, ayer: '2026-11-10' }).hasta, '2026-11-10');
// Semana que empieza antes del mes: arranca el día 1.
assert.equal(resumenSemanal({ filas, objetivos, ayer: '2026-11-04' }).desde, '2026-11-01');
assert.equal(resumenSemanal({ filas: [], objetivos }), null);
// Cambio de estado: una que estaba en verde y cayó.
const caida = [];
for (let d = 1; d <= 14; d++) {
  const f = `2026-11-${String(d).padStart(2, '0')}`;
  caida.push({ sucursal: 'X', fecha: f, monto: d <= 7 ? 20e6 : 1e6 });
}
// Objetivo apenas por debajo de lo que proyectaba al día 7 (en verde); después casi no vende.
const objX = avanceSucursales(resumirMes(caida), [{ sucursal: 'X', objetivo: 1 }], '2026-11-07').get('X').proyeccion * 0.98;
const semX = resumenSemanal({ filas: caida, objetivos: [{ sucursal: 'X', objetivo: objX }], ayer: '2026-11-15' });
assert.deepEqual(semX.bajaron.map((x) => x.sucursal), ['X']);
assert.equal(semX.subieron.length, 0);

// ---- Meta diaria y racha (portal de la sucursal) ----
const dias = [
  { fecha: '2026-11-01', monto: 0 }, { fecha: '2026-11-02', monto: 50e6 }, { fecha: '2026-11-03', monto: 50e6 }, { fecha: '2026-11-04', monto: 50e6 },
];
const md = metaDiaria({ objetivo: 300e6, mes: '2026-11', dias, hasta: '2026-11-04' });
assert.equal(md.dias.length, 4);
assert.ok(Math.abs(md.dias[0].meta - 300e6 * fraccionPonderada('2026-11-01')) < 1);
assert.equal(md.dias[0].cumple, false);
assert.equal(md.racha, 3);
assert.equal(md.mejorRacha, 3);
assert.equal(md.cumplidos, 3);
// La suma de las metas de todo el mes da el objetivo.
const todo = Array.from({ length: 30 }, (_, i) => ({ fecha: `2026-11-${String(i + 1).padStart(2, '0')}`, monto: 0 }));
const mdTodo = metaDiaria({ objetivo: 300e6, mes: '2026-11', dias: todo, hasta: '2026-11-30' });
assert.ok(Math.abs(mdTodo.dias.reduce((s, d) => s + d.meta, 0) - 300e6) < 1);
assert.equal(mdTodo.racha, 0);
assert.deepEqual(metaDiaria({ objetivo: null, mes: '2026-11', dias, hasta: '2026-11-04' }).dias, []);

// Meta de hoy en la vista: el día del plan que coincide con hoy; si no, el próximo.
const v = vistaSucursal({ sucursal: 'A', mes: '2026-11', filasMes: filas, objetivos, hoy: '2026-11-15' });
assert.equal(v.avance.metaHoy.fecha, '2026-11-15');
assert.equal(v.avance.metaHoy.esHoy, true);
assert.ok(Math.abs(v.avance.metaHoy.monto - v.avance.plan[0].monto) < 1e-6);
assert.equal(v.avance.metaDiaria.dias.length, 14);
const v2 = vistaSucursal({ sucursal: 'A', mes: '2026-11', filasMes: filas, objetivos, hoy: '2026-11-14' });
assert.equal(v2.avance.metaHoy.esHoy, false); // hoy ya está cargado: muestra el próximo día
assert.equal(v2.avance.metaHoy.fecha, '2026-11-15');

console.log('reportes: todas las pruebas pasaron');
