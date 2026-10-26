// Pruebas del armado del resumen y del formato del análisis: node tests/informe.test.mjs
import assert from 'node:assert/strict';
import { armarContexto, textoParaCopiar, informeAHtml } from '../public/js/informe.js';

// Resumen del mes: datos agregados, sin filas crudas
const filas = [];
for (let d = 1; d <= 14; d++) {
  const fecha = `2026-10-${String(d).padStart(2, '0')}`;
  filas.push({ sucursal: 'LUQUE 1', fecha, monto: 3_000_000 });
  filas.push({ sucursal: 'ABASTO', fecha, monto: d === 14 ? 100_000 : 2_000_000 });
  filas.push({ sucursal: 'CENTRAL', fecha, monto: 90_000_000 });
}
const ctx = armarContexto({ mes: '2026-10', filas });
assert.equal(ctx.mes, 'Octubre 2026');
assert.equal(ctx.sucursalesConVenta, 2); // CENTRAL afuera
assert.equal(ctx.totalMes, 68.1); // 14 × 3 M + 13 × 2 M + 0,1 M
assert.equal(ctx.ventaExcluidaMayorista, 1260);
assert.equal(ctx.ventaPorDia.length, 14);
assert.equal(ctx.ventaPorDia[0].dia, 'jueves');
assert.equal(ctx.top10[0].sucursal, 'LUQUE 1');
assert.ok(ctx.ultimoDiaVsSemanaAnterior);
assert.equal(ctx.objetivosPublicados, undefined); // sin publicado del mes

// Con un reporte publicado del mismo mes se suman objetivos y proyección
const published = { corte: '2026-10-14', obj: { may: 1e9, min: 2e8, fgl: 1e8, fbt: 1e8 }, real: { may: 5e8, min: 6.9e7, fgl: 5e7, fbt: 4e7 } };
const conObj = armarContexto({ mes: '2026-10', filas, published });
assert.equal(conObj.objetivosPublicados.minorista.objetivo, 200);
assert.equal(armarContexto({ mes: '2026-10', filas, published: { ...published, corte: '2026-09-30' } }).objetivosPublicados, undefined);

// Texto para copiar: instrucciones + datos
const copia = textoParaCopiar(ctx);
assert.match(copia, /## Resumen/);
assert.match(copia, /Datos de Octubre 2026:/);
assert.ok(!copia.includes('CENTRAL","fecha')); // no van filas crudas

// Formato del análisis pegado
const html = informeAHtml('## Resumen\nVa **bien**.\n\n## Lo que hay que mirar\n- Uno\n- Dos\n1. Primero\n---\nFin');
assert.equal(html, '<h3>Resumen</h3><p>Va <b>bien</b>.</p><h3>Lo que hay que mirar</h3><ul><li>Uno</li><li>Dos</li></ul><ol><li>Primero</li></ol><p>Fin</p>');
// Lo pegado nunca se interpreta como HTML
const peligroso = informeAHtml('<img src=x onerror=alert(1)>\n- <script>alert(1)</script>');
assert.ok(!peligroso.includes('<img') && !peligroso.includes('<script'));
assert.match(peligroso, /&lt;img/);

console.log('informe: todas las pruebas pasaron');
