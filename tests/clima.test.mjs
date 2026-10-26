// Pruebas del historial de clima propio: node tests/clima.test.mjs
import assert from 'node:assert/strict';
import { mezclarHistorial, hoyLocal } from '../netlify/lib/clima.mjs';

// 26/10/2026 23:00 en Asunción (02:00 UTC del 27)
const noche = new Date('2026-10-27T02:00:00Z');
assert.equal(hoyLocal(noche), '2026-10-26');

const pron = (fecha, lluvia) => ({ fecha, tmax: 30, tmin: 20, lluvia, simbolo: 'rain' });
// Primer registro: hoy queda como parcial (no se sabe el día completo); mañana se guarda
let h = mezclarHistorial({}, [pron('2026-10-26', 1), pron('2026-10-27', 12)], noche);
assert.equal(h['2026-10-26'].parcial, true);
assert.equal(h['2026-10-27'].lluvia, 12);
assert.equal(h['2026-10-27'].parcial, undefined);

// Al día siguiente el 27 ya es "hoy": no se pisa con el pronóstico de las horas que quedan
const mediodia27 = new Date('2026-10-27T14:00:00Z');
h = mezclarHistorial(h, [pron('2026-10-27', 0.5), pron('2026-10-28', 3)], mediodia27);
assert.equal(h['2026-10-27'].lluvia, 12);
assert.equal(h['2026-10-28'].lluvia, 3);
// Las fechas futuras sí se actualizan con cada pronóstico
h = mezclarHistorial(h, [pron('2026-10-28', 7)], mediodia27);
assert.equal(h['2026-10-28'].lluvia, 7);

console.log('clima: todas las pruebas pasaron');
