// Informe de situación: el portal arma un resumen de los datos del mes para que el
// administrador lo consulte en su chat de IA, y después publica el análisis que pega.
// No se envían las filas crudas: solo totales, rankings, alertas y comparaciones.
import {
  resumirMes, alertasSucursales, pesoSemana, compararDias, mismoDiaSemana, ultimoDiaCompleto, ultimasSemanas, NO_MINORISTA,
} from './sucursales.js';
import { calcularReporte, nombreMes, mesAnterior, mismoMesAnioAnterior, DIAS_SEMANA } from './calc.js';

export const MAX_TEXTO = 20000;

const M = (v) => Math.round((Number(v) || 0) / 1e5) / 10; // millones con un decimal
const P = (v) => (v === null || v === undefined ? null : Math.round(v * 1000) / 10); // porcentaje con un decimal
const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaDe = (fecha) => DIA[new Date(`${fecha}T12:00:00Z`).getUTCDay()];

const climaDe = (d) => (d ? { maxC: Math.round(d.tmax), minC: Math.round(d.tmin), lluviaMm: Math.round(d.lluvia * 10) / 10, ...(d.parcial ? { parcial: true } : {}) } : null);

// Datos del mes ya resumidos.
//   filas: ventas por sucursal del mes · published: reporte publicado (opcional)
//   clima: { historial: [{ fecha, tmax, tmin, lluvia }], dias: pronóstico } (opcional)
//   filasSemanas: filas que cubren las últimas 4 semanas, aunque sean de dos meses (opcional)
export function armarContexto({ mes, filas, published, clima, filasSemanas }) {
  const res = resumirMes(filas);
  const alertas = alertasSucursales(res);
  const { fecha: ultimo, incompleto } = ultimoDiaCompleto(res.dias);
  const { peso } = pesoSemana(res.dias);
  const climaPorFecha = new Map((clima?.historial || []).map((d) => [d.fecha, d]));
  const ctx = {
    mes: nombreMes(`${mes}-01`),
    unidad: `Baratote Minorista (venta de bebidas, sucursales del área central de Paraguay). Montos en millones de guaraníes. ${NO_MINORISTA.join(', ')} es Mayorista y no está incluida.`,
    diasCargados: res.dias.length,
    ultimoDiaCargado: res.dias.at(-1) ? { fecha: res.dias.at(-1).fecha, dia: diaDe(res.dias.at(-1).fecha) } : null,
    ultimoDiaIncompleto: incompleto ? { fecha: incompleto.fecha, venta: M(incompleto.monto), nota: 'vendió mucho menos que lo normal para ese día: probablemente faltan datos' } : null,
    totalMes: M(res.total),
    ventaExcluidaMayorista: M(res.totalExcluido),
    sucursalesConVenta: res.sucursales.length,
    promedioPorDia: M(res.total / Math.max(res.dias.length, 1)),
    ventaPorDia: res.dias.map((d) => ({ fecha: d.fecha, dia: diaDe(d.fecha), venta: M(d.monto), clima: climaDe(climaPorFecha.get(d.fecha)) })),
    pesoPorDiaDeLaSemana: Object.fromEntries(DIAS_SEMANA.map((d) => [d.nombre.toLowerCase(), P(peso[d.wd])])),
    top10: res.sucursales.slice(0, 10).map((s) => ({ sucursal: s.sucursal, venta: M(s.total), pctDelTotal: P(s.total / (res.total || 1)) })),
    ultimas10: res.sucursales.slice(-10).map((s) => ({ sucursal: s.sucursal, venta: M(s.total), diasConVenta: s.diasConVenta })),
    alertas: {
      sinVentaEnLosUltimosDias: { dias: alertas.ultimas, sucursales: alertas.sinVentaReciente.map((s) => ({ sucursal: s.sucursal, ultimaVenta: s.ultimaVenta })) },
      tendencia: alertas.reciente ? `participación en la venta del ${alertas.reciente.desde} al ${alertas.reciente.hasta} contra la del ${alertas.previo.desde} al ${alertas.previo.hasta}` : 'todavía no hay días suficientes',
      vendiendoMenos: alertas.caidas.map((s) => ({ sucursal: s.sucursal, variacion: P(s.variacion) })),
      creciendo: alertas.crecen.map((s) => ({ sucursal: s.sucursal, variacion: P(s.variacion) })),
      variosDiasSinVenta: alertas.conDiasSinVenta.slice(0, 10).map((s) => ({ sucursal: s.sucursal, dias: s.diasSinVenta })),
    },
    notas: ['Muchas sucursales cierran los lunes: una venta baja en lunes es normal.'],
  };

  // Clima: el de los días con venta va en ventaPorDia; acá el pronóstico de los días que siguen.
  const conClima = ctx.ventaPorDia.filter((d) => d.clima).length;
  const desdePron = res.dias.at(-1)?.fecha || `${mes}-00`;
  const pronostico = (clima?.dias || []).filter((d) => d.fecha > desdePron).slice(0, 10);
  ctx.clima = {
    zona: 'Área central de Paraguay (Asunción)',
    criterio: 'Baratote vende bebidas: el clima más favorable es sol y calor; la lluvia y el frío bajan la venta. En octubre 2026, los días con lluvia de 5 mm o más vendieron en promedio un 11% menos que lo normal para ese día de la semana y los días secos un 8% más.',
    diasConDatoDeClima: `${conClima} de ${res.dias.length}`,
    nota: conClima < res.dias.length
      ? 'Faltan datos de clima de algunos días (el portal registra el clima desde que se activó). No supongas el clima de esos días.'
      : 'El clima de cada día es el pronóstico hecho la noche anterior (menos de 24 h de anticipación).',
    pronostico: pronostico.map((d) => ({ fecha: d.fecha, dia: diaDe(d.fecha), ...climaDe(d) })),
  };

  // Últimas 4 semanas (lunes a domingo).
  if (ultimo && filasSemanas?.length) {
    const us = ultimasSemanas(filasSemanas, ultimo, 4);
    ctx.ultimasSemanas = us.semanas.map((s) => ({
      semana: `${s.desde} al ${s.hasta}`, venta: M(s.total), diasCargados: s.diasCargados,
      variacionVsSemanaAnterior: P(s.variacion),
      ...(s.completa ? {} : { nota: 'semana incompleta: la variación es contra los mismos días de la semana anterior' }),
    }));
    if (us.comparacionSucursales) {
      const conVar = us.sucursales.filter((s) => s.variacion !== null && s.valores.at(-2) >= 1e6);
      const f = (s) => ({ sucursal: s.sucursal, variacion: P(s.variacion) });
      ctx.sucursalesSemana = {
        compara: `semana del ${us.comparacionSucursales.desde} contra la del ${us.comparacionSucursales.contra}`,
        mayoresCaidas: [...conVar].sort((a, b) => a.variacion - b.variacion).slice(0, 5).map(f),
        mayoresSubas: [...conVar].sort((a, b) => b.variacion - a.variacion).slice(0, 5).map(f),
      };
    }
  }

  // Último día completo contra el mismo día de la semana anterior.
  if (ultimo) {
    const d = new Date(`${ultimo}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    const antes = d.toISOString().slice(0, 10);
    const c = compararDias(filas, ultimo, filas, antes);
    if (c.total.b > 0) {
      const conVar = c.sucursales.filter((s) => s.variacion !== null && s.b >= 1e6);
      const fila = (s) => ({ sucursal: s.sucursal, venta: M(s.a), antes: M(s.b), variacion: P(s.variacion) });
      ctx.ultimoDiaVsSemanaAnterior = {
        dia: diaDe(ultimo), fecha: ultimo, contra: antes,
        venta: M(c.total.a), ventaAntes: M(c.total.b), variacion: P(c.total.variacion),
        mayoresCaidas: [...conVar].sort((a, b) => a.variacion - b.variacion).slice(0, 5).map(fila),
        mayoresSubas: [...conVar].sort((a, b) => b.variacion - a.variacion).slice(0, 5).map(fila),
      };
    }
    const sem = mismoDiaSemana(filas, new Date(`${ultimo}T12:00:00Z`).getUTCDay());
    ctx.mismosDiasDelMes = sem.fechas.map((f, i) => ({ fecha: f, venta: M(sem.totales[i]), variacionVsAnterior: P(sem.variaciones[i]) }));
  }

  // Objetivo y proyección publicados, si son de este mes.
  if (published?.corte?.startsWith(mes)) {
    const r = calcularReporte(published);
    const u = (c) => ({ objetivo: M(c.objetivo), real: M(c.real), avance: P(c.avance), proyeccion: M(c.proyeccion), proyeccionDelObjetivo: P(c.proyeccionPct) });
    ctx.objetivosPublicados = {
      corte: published.corte,
      minorista: u(r.unidades.min),
      baratote: u(r.baratote),
      totalEmpresa: { ...u(r.total), vsMesAnterior: P(r.total.varAnt), vsMismoMesAnioAnterior: P(r.total.varAa) },
      comparaciones: `mes anterior = ${mesAnterior(published.corte)}, año anterior = ${mismoMesAnioAnterior(published.corte)}`,
      nota: 'La proyección de Minorista pondera cada día de la semana (el fin de semana pesa más).',
    };
  }
  return ctx;
}

// Instrucciones que acompañan los datos al copiarlos para el chat de IA.
const INSTRUCCIONES = `Sos un analista comercial de FINEZA S.A. Escribí para el gerente comercial y los comerciales de Baratote Minorista, en español de Paraguay con voseo ("mirá", "revisá"), claro y directo, sin tecnicismos.

Abajo van los datos del mes ya calculados, en JSON. Escribí un informe breve de la situación con estas secciones, en este orden y con estos títulos exactos:
## Resumen
## Lo que hay que mirar
## Clima y próximos días
## Sucursales destacadas
## Recomendaciones

Reglas:
- Usá solo estos datos. No inventes causas, cifras ni sucursales; si algo puede tener varias explicaciones, decilo como posibilidad.
- Montos como "Gs. 1.234 M" (millones, punto de miles) y porcentajes con coma decimal ("12,5%").
- Si el último día parece incompleto, aclaralo y no saques conclusiones de ese día.
- Una venta baja en lunes es normal (muchas sucursales cierran).
- En "Lo que hay que mirar" y "Recomendaciones" usá viñetas que empiecen con "- ", como máximo 5 por sección.
- Si hay objetivos publicados, decí si Minorista va camino a cumplir el objetivo y cuánto falta.
- Tené en cuenta el clima: Baratote vende bebidas y le conviene el sol y el calor; la lluvia y el frío bajan la venta. Relacioná las subas y bajas con el clima solo cuando los datos lo muestren (si llovió, si hizo frío o calor), y usá el pronóstico para anticipar los próximos días, sobre todo si llueve o hace frío un viernes, sábado o domingo, que son los días fuertes.
- Compará las últimas 4 semanas (lunes a domingo): decí si la tendencia sube o baja y qué sucursales cambiaron más.
- Entre 300 y 500 palabras. Podés usar **negrita** para resaltar. Sin tablas ni emojis.
- Respondé solo con el informe, sin introducción ni despedida.`;

export function textoParaCopiar(contexto) {
  return `${INSTRUCCIONES}\n\nDatos de ${contexto.mes}:\n${JSON.stringify(contexto)}`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Convierte el análisis pegado (títulos "#", viñetas "- " o "1. ", **negrita**) en HTML seguro.
export function informeAHtml(texto) {
  const out = [];
  let lista = null; // 'ul' | 'ol'
  const cerrar = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  const abrir = (tipo) => { if (lista !== tipo) { cerrar(); out.push(`<${tipo}>`); lista = tipo; } };
  const enLinea = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>');
  for (const linea of esc(texto).split(/\r?\n/)) {
    const t = linea.trim();
    if (!t) { cerrar(); continue; }
    if (/^#{1,4}\s+/.test(t)) { cerrar(); out.push(`<h3>${enLinea(t.replace(/^#{1,4}\s+/, ''))}</h3>`); continue; }
    if (/^[-*•]\s+/.test(t)) { abrir('ul'); out.push(`<li>${enLinea(t.replace(/^[-*•]\s+/, ''))}</li>`); continue; }
    if (/^\d+[.)]\s+/.test(t)) { abrir('ol'); out.push(`<li>${enLinea(t.replace(/^\d+[.)]\s+/, ''))}</li>`); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { cerrar(); continue; }
    cerrar();
    out.push(`<p>${enLinea(t)}</p>`);
  }
  cerrar();
  return out.join('');
}
