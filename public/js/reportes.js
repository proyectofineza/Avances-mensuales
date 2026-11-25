// Reportería de sucursales: por supervisor, las que más mejoraron, matriz cumplimiento vs crecimiento
// y el resumen semanal (Teams). Funciones puras: las usan el portal, el modo pantalla y el servidor.
import { avanceSucursales, ultimoDiaCompleto, resumirMes } from './sucursales.js';
import { estado, fraccionPonderada, PESOS_MINORISTA } from './calc.js';

export const SIN_SUPERVISOR = 'SIN SUPERVISOR';

// Suma días a una fecha AAAA-MM-DD.
export function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Mes anterior y mismo mes del año anterior de un AAAA-MM.
export function mesPrevio(mes) {
  const [y, m] = mes.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export const mesAnioAnterior = (mes) => `${Number(mes.slice(0, 4)) - 1}-${mes.slice(5)}`;

// ---- Por supervisor ----
// res: resumirMes(); avance: avanceSucursales(); maestro: [{ sucursal, supervisor }].
// [{ supervisor, sucursales: [{ sucursal, total, avance? }], total, objetivo, proyeccion, pct, verdes, amarillas, rojas, sinObjetivo }]
export function resumenSupervisores(res, avance, maestro = []) {
  const info = new Map(maestro.map((m) => [m.sucursal, m]));
  const grupos = new Map();
  for (const s of res.sucursales) {
    const nombre = info.get(s.sucursal)?.supervisor || SIN_SUPERVISOR;
    const g = grupos.get(nombre) || { supervisor: nombre, sucursales: [], total: 0, objetivo: 0, proyeccion: 0, verdes: 0, amarillas: 0, rojas: 0, sinObjetivo: 0 };
    const a = avance.get(s.sucursal) || null;
    g.sucursales.push({ sucursal: s.sucursal, total: s.total, avance: a });
    g.total += s.total;
    if (a) {
      g.objetivo += a.objetivo;
      g.proyeccion += a.proyeccion;
      const c = estado(a.proyeccionPct).clase;
      if (c === 'ok') g.verdes++; else if (c === 'warn') g.amarillas++; else g.rojas++;
    } else g.sinObjetivo++;
    grupos.set(nombre, g);
  }
  const orden = (s) => (s.avance ? s.avance.proyeccionPct : -1);
  return [...grupos.values()]
    .map((g) => ({ ...g, pct: g.objetivo ? g.proyeccion / g.objetivo : null, sucursales: g.sucursales.sort((a, b) => orden(b) - orden(a) || b.total - a.total) }))
    .sort((a, b) => (a.supervisor === SIN_SUPERVISOR) - (b.supervisor === SIN_SUPERVISOR) || (b.pct ?? -1) - (a.pct ?? -1) || b.total - a.total);
}

// ---- Las que más mejoraron ----
// Proyección contra el objetivo al último día completo y `dias` antes. Si el mes todavía no tiene
// esos días cargados, devuelve []. [{ sucursal, antes, ahora, cambio, ventaPeriodo }] de mayor a menor cambio.
export function mejorasSucursales(res, objetivos, { hasta = ultimoDiaCompleto(res.dias).fecha, dias = 7, pesos = PESOS_MINORISTA, especiales = [] } = {}) {
  if (!hasta || !objetivos?.length) return [];
  const antes = sumarDias(hasta, -dias);
  if (antes < `${hasta.slice(0, 7)}-01` || !res.dias.some((d) => d.fecha <= antes)) return [];
  const ahora = avanceSucursales(res, objetivos, hasta, pesos, especiales);
  const previo = avanceSucursales(res, objetivos, antes, pesos, especiales);
  return [...ahora].map(([sucursal, a]) => {
    const p = previo.get(sucursal);
    return { sucursal, antes: p.proyeccionPct, ahora: a.proyeccionPct, cambio: a.proyeccionPct - p.proyeccionPct, ventaPeriodo: a.vendido - p.vendido };
  }).sort((a, b) => b.cambio - a.cambio);
}

// ---- Matriz cumplimiento vs crecimiento ----
// mensual: { 'AAAA-MM': { SUC: monto } }; base: 'anio' (mismo mes del año anterior) o 'mes' (mes anterior).
// Crecimiento = proyección al cierre contra el total de ese mes de referencia.
// [{ sucursal, cumplimiento, crecimiento, proyeccion, referencia, cuadrante }]; crecimiento null si no hay referencia.
export function matrizSucursales(avance, mensual, mes, base = 'anio') {
  const ref = mensual?.[base === 'anio' ? mesAnioAnterior(mes) : mesPrevio(mes)] || {};
  return [...avance].map(([sucursal, a]) => {
    const referencia = ref[sucursal] > 0 ? ref[sucursal] : null;
    const crecimiento = referencia ? a.proyeccion / referencia - 1 : null;
    const cumple = a.proyeccionPct >= 1;
    const crece = crecimiento !== null && crecimiento >= 0;
    const cuadrante = crecimiento === null ? null : cumple ? (crece ? 'estrella' : 'facil') : (crece ? 'empuje' : 'atencion');
    return { sucursal, cumplimiento: a.proyeccionPct, crecimiento, proyeccion: a.proyeccion, referencia, cuadrante };
  });
}

// Cuántas sucursales tienen referencia para cada base (para elegir la de por defecto).
export function coberturaMatriz(avance, mensual, mes) {
  const n = (k) => [...avance.keys()].filter((s) => mensual?.[k]?.[s] > 0).length;
  return { anio: n(mesAnioAnterior(mes)), mes: n(mesPrevio(mes)), total: avance.size };
}

// ---- Resumen semanal (Teams, los lunes) ----
// La semana son los 7 días que terminan en `hasta` (el último día completo cargado, hasta ayer),
// dentro del mes. Plan de la semana: el objetivo de cada sucursal repartido por el peso de cada día.
//   filas: sucursales/AAAA-MM; objetivos: [{ sucursal, objetivo }] (sin cerradas); maestro: listado.
export function resumenSemanal({ filas, objetivos = [], maestro = [], pesos = PESOS_MINORISTA, especiales = [], ayer }) {
  const res = resumirMes(filas);
  const completo = ultimoDiaCompleto(res.dias.filter((d) => !ayer || d.fecha <= ayer)).fecha;
  if (!completo) return null;
  const hasta = completo;
  const inicioMes = `${hasta.slice(0, 7)}-01`;
  const desde = sumarDias(hasta, -6) < inicioMes ? inicioMes : sumarDias(hasta, -6);
  const previo = sumarDias(desde, -1);
  const frac = (f) => (f < inicioMes ? 0 : fraccionPonderada(f, pesos, especiales) || 0);
  const fSemana = frac(hasta) - frac(previo);

  const conObj = new Set(objetivos.map((o) => o.sucursal));
  const ventaEn = (s, a, b) => Object.entries(s.dias).reduce((t, [f, v]) => (f >= a && f <= b ? t + v : t), 0);
  let ventaSemana = 0, planSemana = 0, vendidoMes = 0, objetivoMes = 0;
  for (const o of objetivos) {
    const s = res.sucursales.find((x) => x.sucursal === o.sucursal);
    planSemana += o.objetivo * fSemana;
    objetivoMes += o.objetivo;
    if (s) { ventaSemana += ventaEn(s, desde, hasta); vendidoMes += ventaEn(s, inicioMes, hasta); }
  }
  const ventaSemanaTodas = res.sucursales.reduce((t, s) => t + ventaEn(s, desde, hasta), 0);
  const fMes = frac(hasta);
  const proyeccionMes = fMes > 0 ? vendidoMes / fMes : vendidoMes;

  const avance = avanceSucursales(res, objetivos, hasta, pesos, especiales);
  const lista = [...avance].map(([sucursal, a]) => ({ sucursal, ...a })).sort((a, b) => b.proyeccionPct - a.proyeccionPct);
  const cuenta = { ok: 0, warn: 0, risk: 0 };
  for (const a of lista) cuenta[estado(a.proyeccionPct).clase]++;

  // Cambios de estado contra una semana antes (si el mes ya tenía esos días).
  const antes = previo >= inicioMes ? avanceSucursales(res, objetivos, previo, pesos, especiales) : new Map();
  const bajaron = [], subieron = [];
  for (const a of lista) {
    const p = antes.get(a.sucursal);
    if (!p) continue;
    const ca = estado(p.proyeccionPct).clase, cn = estado(a.proyeccionPct).clase;
    if (ca === 'ok' && cn !== 'ok') bajaron.push({ sucursal: a.sucursal, antes: p.proyeccionPct, ahora: a.proyeccionPct });
    else if (ca !== 'ok' && cn === 'ok') subieron.push({ sucursal: a.sucursal, antes: p.proyeccionPct, ahora: a.proyeccionPct });
  }
  const mejoras = mejorasSucursales(res, objetivos, { hasta, dias: 7, pesos, especiales }).filter((m) => m.cambio > 0).slice(0, 3);
  const supervisores = maestro.some((m) => m.supervisor)
    ? resumenSupervisores(res, avance, maestro).filter((g) => g.objetivo > 0)
    : [];

  return {
    mes: hasta.slice(0, 7), desde, hasta,
    semana: { venta: ventaSemana, plan: planSemana, pct: planSemana ? ventaSemana / planSemana : null, ventaTodas: ventaSemanaTodas },
    mesActual: { vendido: vendidoMes, objetivo: objetivoMes, avance: objetivoMes ? vendidoMes / objetivoMes : null, proyeccion: proyeccionMes, proyeccionPct: objetivoMes ? proyeccionMes / objetivoMes : null },
    conObjetivo: conObj.size, cuenta,
    mejores: lista.slice(0, 5), peores: lista.slice(-5).reverse(),
    bajaron, subieron, mejoras, supervisores,
  };
}
