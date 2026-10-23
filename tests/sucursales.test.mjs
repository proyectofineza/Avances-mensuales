// Pruebas de la lectura de planillas de sucursales: node tests/sucursales.test.mjs
import assert from 'node:assert/strict';
import { leerPlanilla, parseMonto, parseFecha, resumirMes } from '../public/js/sucursales.js';

// Montos en guaraníes
assert.equal(parseMonto('1.234.567'), 1234567);
assert.equal(parseMonto('1234567'), 1234567);
assert.equal(parseMonto('Gs. 1.234.567'), 1234567);
assert.equal(parseMonto('1234567,50'), 1234567);
assert.equal(parseMonto('-5'), null);
assert.equal(parseMonto('abc'), null);
assert.equal(parseMonto(''), null);

// Fechas
assert.equal(parseFecha('2026-10-05'), '2026-10-05');
assert.equal(parseFecha('05/10/2026'), '2026-10-05');
assert.equal(parseFecha('5-10-26'), '2026-10-05');
assert.equal(parseFecha('7', '2026-10'), '2026-10-07');
assert.equal(parseFecha('46300'), '2026-10-05'); // serie de Excel (46296 = 01/10/2026)
assert.equal(parseFecha('31/02/2026'), null);
assert.equal(parseFecha('7'), null); // solo día sin mes

// Formato del archivo de octubre (SUCURSAL, Suma de MONTO, Día): pide el mes
const csvDia = 'SUCURSAL,Suma de MONTO,Día\nLUQUE 1,3033467,1\nCENTRAL,994514620,1\nLUQUE 1,5162157,2\n';
assert.equal(leerPlanilla(csvDia).necesitaMes, true);
const p1 = leerPlanilla(csvDia, '2026-10');
assert.equal(p1.errores.length, 0);
assert.deepEqual(p1.filas[0], { sucursal: 'LUQUE 1', fecha: '2026-10-01', monto: 3033467 });

// Pegado desde Excel (tabulado), con fecha completa y montos con puntos
const tab = 'Sucursal\tFecha\tMonto\nLuque 1\t02/10/2026\t1.000\nluque  1\t02/10/2026\t500\nAbasto\t03/10/2026\tGs. 2.000\nX\tmal\t10\n';
const p2 = leerPlanilla(tab);
assert.equal(p2.filas.length, 2);
assert.deepEqual(p2.filas[0], { sucursal: 'LUQUE 1', fecha: '2026-10-02', monto: 1500 }); // repetidos se suman
assert.equal(p2.errores.length, 1);
assert.equal(p2.errores[0].linea, 5);

// Sin encabezado, punto y coma
const p3 = leerPlanilla('ABASTO;2026-10-03;1500\nCOLON;2026-10-03;2500\n');
assert.equal(p3.filas.length, 2);

// Faltan columnas
assert.match(leerPlanilla('Nombre,Otra\nA,B').errores[0].motivo, /columnas/);

// Resumen: CENTRAL queda afuera de Minorista
const res = resumirMes([
  { sucursal: 'LUQUE 1', fecha: '2026-10-01', monto: 100 },
  { sucursal: 'LUQUE 1', fecha: '2026-10-02', monto: 50 },
  { sucursal: 'ABASTO', fecha: '2026-10-01', monto: 200 },
  { sucursal: 'CENTRAL', fecha: '2026-10-01', monto: 9999 },
]);
assert.equal(res.total, 350);
assert.equal(res.totalExcluido, 9999);
assert.equal(res.sucursales[0].sucursal, 'ABASTO');
assert.equal(res.sucursales[1].diasConVenta, 2);
assert.deepEqual(res.dias, [{ fecha: '2026-10-01', monto: 300 }, { fecha: '2026-10-02', monto: 50 }]);

// Alertas: 14 días de octubre 2026 (1 = jueves). A vende parejo, B se cae en la última
// semana, C crece, D deja de vender los dos últimos días hábiles.
import { alertasSucursales, pesoSemana } from '../public/js/sucursales.js';
const filasA = [];
for (let d = 1; d <= 14; d++) {
  const fecha = `2026-10-${String(d).padStart(2, '0')}`;
  const ultimaSemana = d > 7;
  filasA.push({ sucursal: 'A', fecha, monto: 100 });
  filasA.push({ sucursal: 'B', fecha, monto: ultimaSemana ? 40 : 100 });
  filasA.push({ sucursal: 'C', fecha, monto: ultimaSemana ? 200 : 100 });
  if (d < 13) filasA.push({ sucursal: 'D', fecha, monto: 100 });
}
const al = alertasSucursales(resumirMes(filasA));
assert.deepEqual(al.ultimas, ['2026-10-13', '2026-10-14']); // 12 es lunes
assert.deepEqual(al.sinVentaReciente.map((s) => s.sucursal), ['D']);
assert.equal(al.sinVentaReciente[0].ultimaVenta, '2026-10-12');
assert.deepEqual(al.caidas.map((s) => s.sucursal), ['B']);
assert.ok(al.caidas[0].variacion < -0.4);
assert.deepEqual(al.crecen.map((s) => s.sucursal), ['C']);
assert.deepEqual(al.reciente, { desde: '2026-10-08', hasta: '2026-10-14' });
assert.equal(al.conDiasSinVenta.length, 0);
// Pocos días: no compara tendencias
assert.equal(alertasSucursales(resumirMes(filasA.filter((f) => f.fecha <= '2026-10-05'))).caidas.length, 0);
// Peso por día de la semana suma 1
const ps = pesoSemana(resumirMes(filasA).dias);
assert.ok(Math.abs(ps.peso.reduce((a, b) => a + b, 0) - 1) < 1e-9);

console.log('sucursales: todas las pruebas pasaron');
