// Portal de sucursales: ubicación, historial por sucursal y la vista de una sucursal.
import assert from 'node:assert/strict';
import {
  distanciaMetros, leerPosicion, revisarUbicacion, leerHistorialSucursales, totalesPorSucursal, vistaSucursal,
} from '../public/js/portal-sucursal.js';

// Distancias: Asunción centro → San Lorenzo ≈ 13 km; 0,001° de latitud ≈ 111 m
const asu = { lat: -25.2822, lng: -57.6351 }, slo = { lat: -25.3397, lng: -57.5089 };
assert.ok(Math.abs(distanciaMetros(asu, slo) - 14100) < 600);
assert.ok(Math.abs(distanciaMetros(asu, { lat: asu.lat + 0.001, lng: asu.lng }) - 111) < 2);

assert.equal(leerPosicion({ lat: 'x', lng: 1 }), null);
assert.equal(leerPosicion({ lat: 100, lng: 1 }), null);
assert.deepEqual(leerPosicion({ lat: -25.1, lng: -57.2, precision: 12.6 }), { lat: -25.1, lng: -57.2, precision: 13 });

// En el local, en la puerta (con la imprecisión), lejos, impreciso, sin ubicación
assert.equal(revisarUbicacion(asu, 300, { ...asu, precision: 10 }).ok, true);
const puerta = { lat: asu.lat + 0.0035, lng: asu.lng, precision: 100 }; // ≈ 390 m, menos 100 de margen
assert.equal(revisarUbicacion(asu, 300, puerta).ok, true);
const lejos = revisarUbicacion(asu, 300, { ...slo, precision: 20 });
assert.equal(lejos.ok, false); assert.match(lejos.motivo, /km de la sucursal/);
assert.equal(revisarUbicacion(asu, 300, { ...asu, precision: 3000 }).ok, false);
assert.equal(revisarUbicacion(asu, 300, null).ok, false);
assert.equal(revisarUbicacion(null, 300, { ...asu, precision: 5 }).ok, false);
// La imprecisión se descuenta hasta 150 m: a 600 m con precisión 900 no pasa
assert.equal(revisarUbicacion(asu, 300, { lat: asu.lat + 0.0054, lng: asu.lng, precision: 900 }).ok, false);

// Historial: formato largo
const largo = leerHistorialSucursales('Sucursal\tAño\tMes\tVenta\nAtyra\t2025\tEnero\t85.000.000\nATYRA\t2025\t2\t79.500.000\nSAN LORENZO 1\t2025\tsetiembre\t120.000.000\nX\t2025\tFoo\t1');
assert.equal(largo.formato, 'largo');
assert.deepEqual(largo.registros, { '2025-01': { ATYRA: 85000000 }, '2025-02': { ATYRA: 79500000 }, '2025-09': { 'SAN LORENZO 1': 120000000 } });
assert.equal(largo.errores.length, 1); assert.equal(largo.errores[0].linea, 5);
// Formato ancho, con y sin año
const ancho = 'Sucursal;Enero;Febrero;Marzo\nATYRA;10;;30\nLUQUE 1;5;6;7';
assert.equal(leerHistorialSucursales(ancho).necesitaAnio, true);
const a25 = leerHistorialSucursales(ancho, 2025);
assert.equal(a25.formato, 'ancho');
assert.deepEqual(a25.registros['2025-01'], { ATYRA: 10, 'LUQUE 1': 5 });
assert.deepEqual(a25.registros['2025-02'], { 'LUQUE 1': 6 });
const conAnio = leerHistorialSucursales('Sucursal\tAño\tEne\tDic\nATYRA\t2024\t1.000\t2.000');
assert.deepEqual(conAnio.registros, { '2024-01': { ATYRA: 1000 }, '2024-12': { ATYRA: 2000 } });
assert.equal(leerHistorialSucursales('Sucursal\tVenta\nA\t1').errores.length, 1);

assert.deepEqual(totalesPorSucursal([{ sucursal: 'A', monto: 1 }, { sucursal: 'A', monto: 2 }, { sucursal: 'B', monto: 5 }]), { A: 3, B: 5 });

// Vista de una sucursal: noviembre 2026 con 10 días cargados, tres sucursales
const filas = [];
for (let d = 1; d <= 10; d++) {
  const f = `2026-11-${String(d).padStart(2, '0')}`;
  filas.push({ sucursal: 'ATYRA', fecha: f, monto: 3e6 }, { sucursal: 'SAN LORENZO 1', fecha: f, monto: 5e6 }, { sucursal: 'LUQUE 1', fecha: f, monto: 1e6 });
}
const objetivos = [{ sucursal: 'ATYRA', objetivo: 80e6 }, { sucursal: 'SAN LORENZO 1', objetivo: 200e6 }, { sucursal: 'LUQUE 1', objetivo: 60e6 }];
const mensual = { '2025-10': 70e6, '2025-11': 75e6, '2026-10': 84e6, '2024-11': 60e6 };
const v = vistaSucursal({ sucursal: 'ATYRA', mes: '2026-11', filasMes: filas, objetivos, mensual, cerradas: [] });
assert.equal(v.conVentas, true);
assert.equal(v.avance.vendido, 30e6); assert.equal(v.avance.objetivo, 80e6);
assert.equal(v.avance.pct, 30e6 / 80e6);
assert.equal(v.avance.diasRestantes, 20); assert.equal(v.avance.falta, 50e6);
assert.equal(v.avance.necesarioDia, 50e6 / 20);
assert.equal(v.avance.promedioDia, 3e6);
assert.ok(v.avance.proyeccion > 30e6);
// Puesto: 2.º en venta (SL 50, ATYRA 30, LUQUE 10); en cumplimiento ATYRA 37,5% vs SL 25% y LUQUE 16,7% → 1.º
assert.deepEqual(v.ranking.venta, { puesto: 2, de: 3 });
assert.deepEqual(v.ranking.cumplimiento, { puesto: 1, de: 3 });
// Solo sus días: ningún monto de otra sucursal
assert.equal(v.dias.length, 10); assert.ok(v.dias.every((d) => d.monto === 3e6));
assert.equal(JSON.stringify(v).includes('SAN LORENZO'), false);
// Historial: oct 2026 vs oct 2025 = +20%; acumulado del año = solo octubre (meses cerrados con los dos años)
assert.equal(v.historial.series[2026][9], 84e6); assert.equal(v.historial.series[2026][10], 30e6);
assert.ok(Math.abs(v.historial.variaciones[9] - 0.2) < 1e-12);
assert.equal(v.historial.mesEnCurso, 11);
assert.deepEqual([v.historial.acumulado.meses, v.historial.acumulado.actual, v.historial.acumulado.anterior], [1, 84e6, 70e6]);
assert.equal(v.historial.series[2024][10], 60e6);
assert.equal(v.vsAnioAnterior.anterior, 75e6);
assert.ok(Math.abs(v.vsAnioAnterior.variacion - (v.avance.proyeccion / 75e6 - 1)) < 1e-12);
// Una sucursal cerrada no cuenta en el ranking
const sinSL = vistaSucursal({ sucursal: 'ATYRA', mes: '2026-11', filasMes: filas, objetivos, mensual, cerradas: ['SAN LORENZO 1'] });
assert.deepEqual(sinSL.ranking.venta, { puesto: 1, de: 2 });
// Sin objetivo: igual hay proyección y puesto en venta
const sinObj = vistaSucursal({ sucursal: 'ATYRA', mes: '2026-11', filasMes: filas, objetivos: [], mensual });
assert.equal(sinObj.avance.objetivo, null); assert.ok(sinObj.avance.proyeccion > 0); assert.equal(sinObj.ranking.cumplimiento, null);
// Sucursal sin ventas en el mes
assert.equal(vistaSucursal({ sucursal: 'NUEVA', mes: '2026-11', filasMes: filas, objetivos, mensual: {} }).conVentas, false);

console.log('portal-sucursal: todas las pruebas pasaron');
