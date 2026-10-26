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

// Comparar un día contra otro (domingo 18 vs domingo 11), CENTRAL afuera
import { compararDias, mismoDiaSemana } from '../public/js/sucursales.js';
const filasC = [
  { sucursal: 'LUQUE 1', fecha: '2026-10-11', monto: 100 },
  { sucursal: 'LUQUE 1', fecha: '2026-10-18', monto: 150 },
  { sucursal: 'ABASTO', fecha: '2026-10-11', monto: 200 },
  { sucursal: 'COLON', fecha: '2026-10-18', monto: 50 },
  { sucursal: 'CENTRAL', fecha: '2026-10-18', monto: 9999 },
  { sucursal: 'LUQUE 1', fecha: '2026-10-04', monto: 80 },
  { sucursal: 'LUQUE 1', fecha: '2026-10-12', monto: 5 }, // lunes
];
const cd = compararDias(filasC, '2026-10-18', filasC, '2026-10-11');
assert.deepEqual(cd.total, { a: 200, b: 300, diferencia: -100, variacion: 200 / 300 - 1 });
assert.equal(cd.conVentaA, 2);
assert.equal(cd.conVentaB, 2);
const luque = cd.sucursales.find((s) => s.sucursal === 'LUQUE 1');
assert.equal(luque.variacion, 0.5);
assert.equal(cd.sucursales.find((s) => s.sucursal === 'ABASTO').variacion, -1); // dejó de vender
assert.equal(cd.sucursales.find((s) => s.sucursal === 'COLON').variacion, null); // no vendía antes
assert.ok(!cd.sucursales.some((s) => s.sucursal === 'CENTRAL'));
// Meses distintos: se pasan las filas de cada mes
const nov = [{ sucursal: 'LUQUE 1', fecha: '2026-11-01', monto: 300 }];
assert.equal(compararDias(nov, '2026-11-01', filasC, '2026-10-25').total.variacion, null);
assert.equal(compararDias(nov, '2026-11-01', filasC, '2026-10-18').sucursales[0].variacion, 1);

// Todos los domingos del mes
const dom = mismoDiaSemana(filasC, 0);
assert.deepEqual(dom.fechas, ['2026-10-04', '2026-10-11', '2026-10-18']);
assert.deepEqual(dom.totales, [80, 300, 200]);
assert.deepEqual(dom.sucursales.find((s) => s.sucursal === 'LUQUE 1').valores, [80, 100, 150]);
assert.equal(dom.sucursales.find((s) => s.sucursal === 'LUQUE 1').ultimaVariacion, 0.5);
assert.equal(dom.variaciones[0], null);

// Últimas 4 semanas (lunes a domingo), cruzando de mes. 2026-09-28 es lunes.
import { ultimasSemanas } from '../public/js/sucursales.js';
const filasS = [];
const agregar = (desde, hasta, suc, monto) => {
  for (let d = new Date(`${desde}T12:00:00Z`); d <= new Date(`${hasta}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    filasS.push({ sucursal: suc, fecha: d.toISOString().slice(0, 10), monto });
  }
};
agregar('2026-09-28', '2026-10-04', 'A', 10); // semana 1: 70
agregar('2026-10-05', '2026-10-11', 'A', 20); // semana 2: 140
agregar('2026-10-12', '2026-10-18', 'A', 10); // semana 3: 70
agregar('2026-10-19', '2026-10-21', 'A', 30); // semana 4 en curso (lun a mié): 90
agregar('2026-10-12', '2026-10-18', 'B', 5);
filasS.push({ sucursal: 'CENTRAL', fecha: '2026-10-20', monto: 999 });
const us = ultimasSemanas(filasS, '2026-10-21');
assert.deepEqual(us.semanas.map((s) => s.desde), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
assert.deepEqual(us.semanas.map((s) => s.hasta), ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
assert.deepEqual(us.semanas.map((s) => s.total), [70, 140, 105, 90]); // CENTRAL afuera
assert.equal(us.semanas[1].variacion, 1); // 140 vs 70
assert.equal(us.semanas[2].variacion, 105 / 140 - 1);
assert.equal(us.semanas[3].completa, false);
assert.equal(us.semanas[3].diasCargados, 3);
assert.equal(us.semanas[3].comparableAnterior, 45); // lun a mié de la semana anterior (A 30 + B 15)
assert.equal(us.semanas[3].variacion, 90 / 45 - 1);
assert.equal(us.semanas[0].variacion, null); // no hay semana anterior
assert.deepEqual(us.comparacionSucursales, { desde: '2026-10-12', contra: '2026-10-05' });
const a = us.sucursales.find((s) => s.sucursal === 'A');
assert.deepEqual(a.valores, [70, 140, 70, 90]);
assert.equal(a.variacion, -0.5);
assert.equal(us.sucursales.find((s) => s.sucursal === 'B').variacion, null); // no vendía la semana 2
// Un día cargado después de `hasta` (incompleto) no suma
const conParcial = ultimasSemanas([...filasS, { sucursal: 'A', fecha: '2026-10-22', monto: 1 }], '2026-10-21');
assert.equal(conParcial.semanas[3].total, 90);
assert.equal(conParcial.semanas[3].diasCargados, 3);

// Listado maestro, objetivos, zonas y control de la planilla
import { leerMaestro, leerObjetivos, zonaSugerida, avanceSucursales, resumenZonas, controlMaestro } from '../public/js/sucursales.js';
import { fraccionPonderada } from '../public/js/calc.js';
assert.equal(zonaSugerida('luque 2'), 'LUQUE');
assert.equal(zonaSugerida('SAN LORENZO 12'), 'SAN LORENZO');
assert.equal(zonaSugerida('MARIANO R. ALONSO N° 3'), 'MARIANO R. ALONSO');
assert.equal(zonaSugerida('LAS RESIDENTAS'), 'LAS RESIDENTAS');
assert.equal(zonaSugerida('KM 5'), 'KM'); // solo sugerencia: el admin la corrige

const m = leerMaestro('Sucursal;Zona;Encargado\nLuque 1;luque;María González\n;X;Y\nABASTO;Asunción;\nLuque 1;Luque Centro;Ana');
assert.deepEqual(m.filas, [{ sucursal: 'LUQUE 1', zona: 'LUQUE CENTRO', encargado: 'Ana' }, { sucursal: 'ABASTO', zona: 'ASUNCIÓN', encargado: '' }]);
assert.equal(m.errores.length, 1); assert.equal(m.errores[0].linea, 3);
assert.deepEqual(leerMaestro('LUQUE 1\tLUQUE\tMaría').filas, [{ sucursal: 'LUQUE 1', zona: 'LUQUE', encargado: 'María' }]); // sin títulos
assert.deepEqual(leerMaestro('Nombre;Otra\nA;B'), { filas: [{ sucursal: 'A', zona: '', encargado: '' }], errores: [] }); // zona y encargado son opcionales
assert.match(leerObjetivos('Sucursal;Cosa\nA;1').errores[0].motivo, /objetivo/);

const o = leerObjetivos('Sucursal;Objetivo\nLUQUE 1;95.000.000\nABASTO;\nCOLON;abc\nKM 5;Gs. 40.000.000');
assert.deepEqual(o.filas, [{ sucursal: 'LUQUE 1', objetivo: 95e6 }, { sucursal: 'KM 5', objetivo: 40e6 }]); // vacío se ignora
assert.equal(o.errores.length, 1); assert.match(o.errores[0].motivo, /Objetivo inválido/);

const resO = resumirMes([
  { sucursal: 'LUQUE 1', fecha: '2026-10-01', monto: 30e6 },
  { sucursal: 'LUQUE 1', fecha: '2026-10-10', monto: 20e6 },
  { sucursal: 'LUQUE 1', fecha: '2026-10-11', monto: 1e6 }, // después del último día completo: no cuenta
  { sucursal: 'ABASTO', fecha: '2026-10-05', monto: 10e6 },
  { sucursal: 'CENTRAL', fecha: '2026-10-05', monto: 99e6 },
]);
const av = avanceSucursales(resO, [{ sucursal: 'LUQUE 1', objetivo: 100e6 }, { sucursal: 'NUEVA', objetivo: 10e6 }], '2026-10-10');
const fr = fraccionPonderada('2026-10-10');
assert.equal(av.get('LUQUE 1').vendido, 50e6);
assert.equal(av.get('LUQUE 1').avance, 0.5);
assert.equal(av.get('LUQUE 1').proyeccion, 50e6 / fr);
assert.equal(av.get('LUQUE 1').proyeccionPct, 50e6 / fr / 100e6);
assert.equal(av.get('NUEVA').vendido, 0); // con objetivo pero sin ventas
assert.equal(av.has('ABASTO'), false);
assert.equal(avanceSucursales(resO, [], '2026-10-10').size, 0);

const zonas = resumenZonas(resO, [{ sucursal: 'LUQUE 1', zona: 'LUQUE' }]);
assert.deepEqual(zonas.map((z) => [z.zona, z.total, z.sucursales.length]), [['LUQUE', 51e6, 1], ['SIN ZONA', 10e6, 1]]);

const ctl = controlMaestro([{ sucursal: 'A' }, { sucursal: 'B' }, { sucursal: 'CENTRAL' }], ['A', 'C', 'CENTRAL']);
assert.deepEqual(ctl, { faltan: ['B'], nuevas: ['C'] });

console.log('sucursales: todas las pruebas pasaron');
