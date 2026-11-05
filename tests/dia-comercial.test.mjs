// Día comercial: asignación de la madrugada al día anterior, lectura con hora y fusión al guardar.
import assert from 'node:assert/strict';
import {
  fechaComercial, horarioDe, normalizarHorario, leerPlanillaHoras, tieneHora, fusionarMes, validarHoras, etiquetaFranja, minutos,
} from '../public/js/dia-comercial.js';

const H = normalizarHorario(null);
const fc = (fecha, hora, suc = 'LUQUE 1', h = H) => fechaComercial(h, suc, fecha, minutos(hora));
// Noviembre 2026: 1 = domingo, 2 = lunes, 3 = martes, 5 = jueves, 6 = viernes, 7 = sábado.

// Lunes 16:00 → martes 00:30: el martes 00:29 es del lunes; 00:30 ya es del martes.
assert.equal(fc('2026-11-03', '00:29').fecha, '2026-11-02');
assert.equal(fc('2026-11-03', '00:30').fecha, '2026-11-03');
assert.equal(fc('2026-11-02', '16:00').fecha, '2026-11-02');
assert.equal(fc('2026-11-02', '23:59').fecha, '2026-11-02');
// Jueves cierra 01:30, viernes 02:30, sábado 04:00
assert.equal(fc('2026-11-06', '01:29').fecha, '2026-11-05');
assert.equal(fc('2026-11-06', '01:30').fecha, '2026-11-06');
assert.equal(fc('2026-11-07', '02:29').fecha, '2026-11-06');
assert.equal(fc('2026-11-08', '03:59').fecha, '2026-11-07');
assert.equal(fc('2026-11-08', '04:00').fecha, '2026-11-08');
// Domingo cierra 23:00 del mismo día: la madrugada del lunes es del lunes
assert.equal(fc('2026-11-02', '00:10').fecha, '2026-11-02');
// Cruce de mes: el domingo 1/11 a las 00:45 es del sábado 31/10
const c = fc('2026-11-01', '00:45');
assert.deepEqual([c.fecha, c.madrugada, c.franja, c.fueraHorario], ['2026-10-31', true, 49, false]);
// Fuera de horario: se asigna igual, solo se marca
const f = fc('2026-11-03', '11:15');
assert.deepEqual([f.fecha, f.fueraHorario], ['2026-11-03', true]);
assert.equal(fc('2026-11-08', '04:10').fueraHorario, true); // domingo antes de abrir
assert.equal(etiquetaFranja(49), '00:30 (+1)');
assert.equal(etiquetaFranja(32), '16:00');

// Horario propio de una sucursal (solo los días cargados; el resto, el general)
const H2 = normalizarHorario({ sucursales: { 'luque 1': { 1: { apertura: '10:00', cierre: '02:00' } } } });
assert.equal(horarioDe(H2, 'LUQUE 1', 1).cierre, '02:00');
assert.equal(horarioDe(H2, 'LUQUE 1', 2).cierre, '00:30');
assert.equal(fc('2026-11-03', '01:45', 'LUQUE 1', H2).fecha, '2026-11-02');
assert.equal(fc('2026-11-03', '01:45', 'LUQUE 2', H2).fecha, '2026-11-03');
assert.equal(fc('2026-11-02', '11:00', 'LUQUE 1', H2).fueraHorario, false);
// Horario inválido → se usa el general
assert.equal(normalizarHorario({ general: { 1: { apertura: '25:00', cierre: 'x' } } }).general[1].apertura, '16:00');

// Lectura del formato de data.csv (SUCURSAL, HORA, Día, Suma de MONTO)
const csv = [
  'SUCURSAL,HORA,Día,Suma de MONTO',
  'LUQUE 1,00:45:34,1,58000', // domingo 1 madrugada → sábado 31/10
  'LUQUE 1,03:59:59,1,1000', // → sábado
  'LUQUE 1,10:15:00,1,20000', // domingo
  'LUQUE 1,22:00:10,1,30000', // domingo
  'LUQUE 1,00:10:00,2,5000', // lunes madrugada: domingo cierra 23:00 → lunes (fuera de horario)
  'LUQUE 1,17:00:00,2,40000', // lunes
  'LUQUE 1,00:29:59,3,7000', // martes 00:29 → lunes
  'LUQUE 1,00:30:00,3,8000', // martes 00:30 → martes (fuera de horario)
  'ITA 1,18:00:00,3,9000',
  'ITA 1,xx,3,1',
].join('\n');
assert.equal(tieneHora(csv), true);
assert.equal(tieneHora('Sucursal,Fecha,Monto\nA,2026-11-01,5'), false);
assert.equal(tieneHora('Sucursal,Fecha,Monto\nA,2026-11-01 00:45:00,5'), true);
assert.equal(leerPlanillaHoras(csv, null, H).necesitaMes, true);
const r = leerPlanillaHoras(csv, '2026-11', H);
assert.equal(r.errores.length, 1);
assert.equal(r.registros, 9);
// Nada se pierde ni se duplica
assert.equal(r.filas.reduce((s, x) => s + x.monto, 0), r.total);
assert.equal(r.total, 58000 + 1000 + 20000 + 30000 + 5000 + 40000 + 7000 + 8000 + 9000);
const m = (fecha, suc = 'LUQUE 1') => r.filas.find((x) => x.fecha === fecha && x.sucursal === suc)?.monto;
assert.equal(m('2026-10-31'), 59000);
assert.equal(m('2026-11-01'), 50000);
assert.equal(m('2026-11-02'), 5000 + 40000 + 7000);
assert.equal(m('2026-11-03'), 8000);
assert.equal(m('2026-11-03', 'ITA 1'), 9000);
assert.deepEqual(r.anteriores, ['2026-10-31']);
assert.deepEqual([r.primeraFecha, r.ultimaFecha, r.precision], ['2026-11-01', '2026-11-03', 'segundos']);
assert.deepEqual(r.madrugada, { registros: 3, monto: 66000 });
assert.equal(r.fuera.registros, 2);
assert.deepEqual(r.horas['2026-11-02']['LUQUE 1'], { 34: 40000, 0: 5000, 48: 7000 });
assert.deepEqual(r.horas['2026-10-31']['LUQUE 1'], { 49: 58000, 55: 1000 });
// Fecha con la hora en la misma celda
const r2 = leerPlanillaHoras('Sucursal;Fecha;Monto\nA;2026-11-03 00:20;10\nA;03/11/2026 00:40:00;20', null, H);
assert.deepEqual(r2.filas, [{ sucursal: 'A', fecha: '2026-11-02', monto: 10 }, { sucursal: 'A', fecha: '2026-11-03', monto: 20 }]);
assert.equal(r2.precision, 'minutos');
// Agrupado por hora en punto: se avisa que la franja del cierre no se puede partir
assert.equal(leerPlanillaHoras('Sucursal,Hora,Fecha,Monto\nA,00:00,2026-11-03,10\nA,17:00,2026-11-03,5', null, H).precision, 'hora');

// ---- Fusión al guardar ----
// Octubre ya cargado: el 31 con 100 de base.
const octubre = { filas: [{ sucursal: 'LUQUE 1', fecha: '2026-10-30', monto: 80 }, { sucursal: 'LUQUE 1', fecha: '2026-10-31', monto: 100 }] };
// El archivo de noviembre trae la madrugada del 31: se suma, no reemplaza.
let o = fusionarMes(octubre, [{ sucursal: 'LUQUE 1', fecha: '2026-10-31', monto: 59 }, { sucursal: 'ITA 1', fecha: '2026-10-31', monto: 3 }],
  { anteriores: ['2026-10-31'], ultimaFecha: '2026-11-03', horas: { '2026-10-31': { 'LUQUE 1': { 49: 59 } } }, comercial: true });
const tot = (x, fecha, s = 'LUQUE 1') => x.filas.find((y) => y.fecha === fecha && y.sucursal === s)?.monto;
assert.equal(tot(o, '2026-10-31'), 159);
assert.equal(tot(o, '2026-10-31', 'ITA 1'), 3);
assert.equal(tot(o, '2026-10-30'), 80);
assert.deepEqual(o.madrugada['2026-10-31'], { 'LUQUE 1': 59, 'ITA 1': 3 });
// Volver a cargar noviembre con más ventas: reemplaza la madrugada anterior, no la duplica.
o = fusionarMes(o, [{ sucursal: 'LUQUE 1', fecha: '2026-10-31', monto: 70 }], { anteriores: ['2026-10-31'], ultimaFecha: '2026-11-04', horas: {}, comercial: true });
assert.equal(tot(o, '2026-10-31'), 170);
assert.equal(tot(o, '2026-10-31', 'ITA 1'), undefined);
// Recargar octubre (el 31 es su último día): la base se reemplaza y la madrugada de noviembre se mantiene.
o = fusionarMes(o, [{ sucursal: 'LUQUE 1', fecha: '2026-10-31', monto: 120 }], { ultimaFecha: '2026-10-31', horas: { '2026-10-31': { 'LUQUE 1': { 40: 120 } } }, comercial: true });
assert.equal(tot(o, '2026-10-31'), 190);
assert.deepEqual(o.horas['2026-10-31']['LUQUE 1'], { 40: 120 });
// Un archivo que cruza el mes (trae el 1/11) ya incluye la madrugada: la guardada se descarta.
o = fusionarMes(o, [{ sucursal: 'LUQUE 1', fecha: '2026-10-31', monto: 200 }], { ultimaFecha: '2026-11-01', horas: { '2026-10-31': {} }, comercial: true });
assert.equal(tot(o, '2026-10-31'), 200);
assert.equal(o.madrugada['2026-10-31'], undefined);
// Carga sin hora (planilla diaria): reemplaza como siempre y saca el día de los comerciales.
o = fusionarMes(o, [{ sucursal: 'LUQUE 1', fecha: '2026-10-31', monto: 210 }], {});
assert.equal(tot(o, '2026-10-31'), 210);
assert.ok(!o.comerciales.includes('2026-10-31'));
assert.equal(o.horas['2026-10-31'], undefined);

assert.equal(validarHoras(null), null);
assert.equal(validarHoras({ '2026-11-01': { A: { 49: 10 } } }), true);
assert.equal(validarHoras({ '2026-11-01': { A: { x: 10 } } }), false);
assert.equal(validarHoras({ 'mal': {} }), false);

console.log('dia-comercial: todas las pruebas pasaron');
