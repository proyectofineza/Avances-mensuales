// Ventas por sucursal de Baratote Minorista: lectura de la planilla y resúmenes.
// Módulo ES sin dependencias: lo usan el navegador y las Netlify Functions.
// Forma de cada fila (pensada para pasar tal cual a una tabla en Supabase):
//   { sucursal: 'LUQUE 1', fecha: 'YYYY-MM-DD', monto: 1234567 }

import { parseCorte, fraccionPonderada, PESOS_MINORISTA } from './calc.js';

// Sucursales que no son Minorista (CENTRAL es venta Mayorista): se muestran aparte.
export const NO_MINORISTA = ['CENTRAL'];

export const MAX_FILAS = 20000;

export function normalizarSucursal(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 60);
}

// Guaraníes enteros: "1.234.567", "1234567", "Gs. 1.234.567", "1234567,50" → 1234567.
export function parseMonto(v) {
  let s = String(v ?? '').trim().replace(/^gs\.?\s*/i, '');
  if (!s || /^-/.test(s)) return null;
  s = s.replace(/[.,]\d{1,2}$/, ''); // centavos
  const digitos = s.replace(/[^\d]/g, '');
  if (!digitos || /[^\d.,\s]/.test(s)) return null;
  return Number(digitos);
}

const pad = (n) => String(n).padStart(2, '0');

// Fecha: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY, número de serie de Excel,
// o solo el día (1–31) si se indica el mes.
export function parseFecha(v, mes) {
  const s = String(v ?? '').trim();
  let y, m, d;
  let r;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) {
    [d, m, y] = [+r[1], +r[2], +r[3]];
    if (y < 100) y += 2000;
  } else if (/^\d{1,2}$/.test(s) && mes) {
    const [my, mm] = mes.split('-').map(Number);
    [y, m, d] = [my, mm, +s];
  } else if (/^\d{5}$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400e3);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else return null;
  const fecha = `${y}-${pad(m)}-${pad(d)}`;
  return parseCorte(fecha) ? fecha : null;
}

// Divide el texto en filas y celdas (tabulado de Excel, punto y coma o coma, con comillas).
function celdas(texto) {
  const lineas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const muestra = lineas.slice(0, 5).join('\n');
  const sep = muestra.includes('\t') ? '\t' : (muestra.split(';').length > muestra.split(',').length ? ';' : ',');
  return lineas.map((linea) => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i];
      if (q) {
        if (ch === '"' && linea[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  });
}

// Lee la planilla. mes ('YYYY-MM') se usa cuando la columna de fecha trae solo el día.
// Devuelve { filas, errores: [{ linea, motivo }], columnas, necesitaMes }.
export function leerPlanilla(texto, mes) {
  const rows = celdas(texto);
  if (!rows.length) return { filas: [], errores: [{ linea: 0, motivo: 'La planilla está vacía.' }], columnas: null, necesitaMes: false };

  // Encabezado: si la primera fila no tiene ningún monto válido, se toma como títulos.
  const cab = rows[0].map((c) => c.toLowerCase());
  const tieneCabecera = cab.some((c) => /[a-záéíóúñ]/.test(c)) && !rows[0].some((c, i) => i > 0 && parseMonto(c) !== null && /\d/.test(c));
  let iSuc = 0, iFecha = 1, iMonto = 2, soloDia = false;
  if (tieneCabecera) {
    const buscar = (re) => cab.findIndex((c) => re.test(c));
    iSuc = buscar(/sucursal|local|tienda|nombre/);
    iFecha = buscar(/fecha/);
    if (iFecha < 0) { iFecha = buscar(/^d[ií]a$/); soloDia = iFecha >= 0; }
    iMonto = buscar(/monto|venta|importe|total/);
    if (iSuc < 0 || iFecha < 0 || iMonto < 0) {
      return {
        filas: [], columnas: null, necesitaMes: false,
        errores: [{ linea: 1, motivo: 'No encontré las columnas. La planilla tiene que tener sucursal, fecha (o día) y monto.' }],
      };
    }
  }
  const datos = tieneCabecera ? rows.slice(1) : rows;
  if (!tieneCabecera) soloDia = datos.every((r) => /^\d{1,2}$/.test(r[iFecha] || ''));
  if (soloDia && !mes) {
    return { filas: [], errores: [], columnas: { iSuc, iFecha, iMonto, soloDia }, necesitaMes: true };
  }

  const acumulado = new Map();
  const errores = [];
  datos.forEach((r, k) => {
    const linea = k + (tieneCabecera ? 2 : 1);
    const sucursal = normalizarSucursal(r[iSuc]);
    const fecha = parseFecha(r[iFecha], mes);
    const monto = parseMonto(r[iMonto]);
    if (!sucursal) return errores.push({ linea, motivo: 'Falta el nombre de la sucursal.' });
    if (!fecha) return errores.push({ linea, motivo: `Fecha inválida: "${r[iFecha] ?? ''}".` });
    if (monto === null) return errores.push({ linea, motivo: `Monto inválido: "${r[iMonto] ?? ''}".` });
    // Si una sucursal se repite el mismo día, se suman los montos.
    const key = `${sucursal}|${fecha}`;
    const prev = acumulado.get(key);
    acumulado.set(key, { sucursal, fecha, monto: (prev?.monto || 0) + monto });
  });
  const filas = [...acumulado.values()];
  if (filas.length > MAX_FILAS) errores.unshift({ linea: 0, motivo: `Son ${filas.length} filas; el máximo por carga es ${MAX_FILAS}.` });
  return { filas: filas.slice(0, MAX_FILAS), errores, columnas: { iSuc, iFecha, iMonto, soloDia }, necesitaMes: false };
}

const diaSemana = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();

// Alertas del mes a partir del resumen (resumirMes):
// - sinVentaReciente: sin venta en los 2 últimos días cargados (sin contar lunes, que muchas cierran).
// - caidas / crecen: participación en la venta de los últimos 7 días vs los días anteriores del mes
//   (comparar la participación evita que un fin de semana o la lluvia muevan a todas por igual).
// - conDiasSinVenta: 3 o más días sin venta en el mes, sin contar lunes.
// Las sucursales cerradas (nombres en `cerradas`) no generan alertas.
export function alertasSucursales(res, { umbral = 0.2, ventana = 7, maximo = 10, cerradas = [] } = {}) {
  const fechas = res.dias.map((d) => d.fecha);
  const habiles = fechas.filter((f) => diaSemana(f) !== 1);
  const ultimas = habiles.slice(-2);
  const venta = (s, f) => s.dias[f] || 0;
  const fuera = new Set(cerradas);
  res = { ...res, sucursales: res.sucursales.filter((s) => !fuera.has(s.sucursal)) };

  const sinVentaReciente = ultimas.length < 2 ? [] : res.sucursales
    .filter((s) => ultimas.every((f) => !venta(s, f)))
    .map((s) => ({ ...s, ultimaVenta: fechas.filter((f) => venta(s, f) > 0).at(-1) || null }));

  const conDiasSinVenta = res.sucursales
    .map((s) => ({ ...s, diasSinVenta: habiles.filter((f) => !venta(s, f)).length }))
    .filter((s) => s.diasSinVenta >= 3)
    .sort((a, b) => b.diasSinVenta - a.diasSinVenta);

  let caidas = [], crecen = [], recientes = [], previas = [];
  if (fechas.length >= ventana + 3) {
    recientes = fechas.slice(-ventana);
    previas = fechas.slice(0, -ventana);
    const suma = (s, fs) => fs.reduce((t, f) => t + venta(s, f), 0);
    const totRec = res.dias.filter((d) => recientes.includes(d.fecha)).reduce((t, d) => t + d.monto, 0);
    const totPrev = res.dias.filter((d) => previas.includes(d.fecha)).reduce((t, d) => t + d.monto, 0);
    const cambios = res.sucursales
      .map((s) => {
        const prev = suma(s, previas), rec = suma(s, recientes);
        if (!prev || !totPrev || !totRec) return null;
        return { ...s, variacion: (rec / totRec) / (prev / totPrev) - 1, promPrevio: prev / previas.length, promReciente: rec / recientes.length };
      })
      .filter(Boolean);
    const sinVenta = new Set(sinVentaReciente.map((s) => s.sucursal)); // ya figuran en su propia lista
    caidas = cambios.filter((s) => s.variacion <= -umbral && !sinVenta.has(s.sucursal))
      .sort((a, b) => a.variacion - b.variacion).slice(0, maximo);
    crecen = cambios.filter((s) => s.variacion >= umbral).sort((a, b) => b.variacion - a.variacion).slice(0, maximo);
  }
  return {
    ultimas, sinVentaReciente, conDiasSinVenta, caidas, crecen,
    reciente: recientes.length ? { desde: recientes[0], hasta: recientes.at(-1) } : null,
    previo: previas.length ? { desde: previas[0], hasta: previas.at(-1) } : null,
  };
}

// Venta de un día por sucursal (sin NO_MINORISTA): Map sucursal → monto.
function ventaDelDia(filas, fecha, excluir) {
  const fuera = new Set(excluir);
  const m = new Map();
  for (const f of filas) {
    if (f.fecha !== fecha || fuera.has(f.sucursal)) continue;
    m.set(f.sucursal, (m.get(f.sucursal) || 0) + f.monto);
  }
  return m;
}

const variacion = (a, b) => (b > 0 ? a / b - 1 : null);

// Compara la venta del día A contra la del día B (pueden ser de meses distintos:
// se pasan las filas de cada uno). Incluye las sucursales que vendieron en alguno de los dos.
export function compararDias(filasA, fechaA, filasB, fechaB, excluir = NO_MINORISTA) {
  const a = ventaDelDia(filasA, fechaA, excluir);
  const b = ventaDelDia(filasB, fechaB, excluir);
  const nombres = new Set([...a.keys(), ...b.keys()]);
  const sucursales = [...nombres].map((sucursal) => {
    const va = a.get(sucursal) || 0, vb = b.get(sucursal) || 0;
    return { sucursal, a: va, b: vb, diferencia: va - vb, variacion: variacion(va, vb) };
  }).sort((x, y) => y.a - x.a);
  const totA = [...a.values()].reduce((s, v) => s + v, 0);
  const totB = [...b.values()].reduce((s, v) => s + v, 0);
  return {
    fechaA, fechaB,
    total: { a: totA, b: totB, diferencia: totA - totB, variacion: variacion(totA, totB) },
    conVentaA: [...a.values()].filter((v) => v > 0).length,
    conVentaB: [...b.values()].filter((v) => v > 0).length,
    sucursales,
  };
}

// Todos los días del mes que caen en el mismo día de la semana (wd: 0 = domingo),
// con el total y la venta de cada sucursal en cada uno.
export function mismoDiaSemana(filas, wd, excluir = NO_MINORISTA) {
  const fuera = new Set(excluir);
  const fechas = [...new Set(filas.map((f) => f.fecha))].filter((f) => diaSemana(f) === wd).sort();
  const totales = fechas.map(() => 0);
  const porSuc = new Map();
  for (const f of filas) {
    const i = fechas.indexOf(f.fecha);
    if (i < 0 || fuera.has(f.sucursal)) continue;
    totales[i] += f.monto;
    if (!porSuc.has(f.sucursal)) porSuc.set(f.sucursal, fechas.map(() => 0));
    porSuc.get(f.sucursal)[i] += f.monto;
  }
  const sucursales = [...porSuc.entries()].map(([sucursal, valores]) => {
    const n = valores.length;
    return { sucursal, valores, ultimaVariacion: n >= 2 ? variacion(valores[n - 1], valores[n - 2]) : null, total: valores.reduce((s, v) => s + v, 0) };
  }).sort((x, y) => y.total - x.total);
  return { fechas, totales, variaciones: totales.map((t, i) => (i ? variacion(t, totales[i - 1]) : null)), sucursales };
}

const sumarDias = (fecha, n) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Las últimas n semanas (lunes a domingo) hasta la semana que contiene `hasta`.
// filas puede traer varios meses. La semana en curso puede estar incompleta: en ese caso
// se compara contra los mismos días de la semana anterior para que sea justo.
// Devuelve semanas de la más vieja a la más nueva.
export function ultimasSemanas(filas, hasta, n = 4, excluir = NO_MINORISTA) {
  const fuera = new Set(excluir);
  const lunesFin = sumarDias(hasta, -((diaSemana(hasta) + 6) % 7));
  const semanas = [];
  for (let i = n - 1; i >= 0; i--) {
    const desde = sumarDias(lunesFin, -7 * i);
    semanas.push({ desde, hasta: sumarDias(desde, 6), total: 0, porDia: new Map(), porSucursal: new Map() });
  }
  for (const f of filas) {
    if (fuera.has(f.sucursal) || f.fecha > hasta) continue; // nada después del último día que se compara
    const s = semanas.find((x) => f.fecha >= x.desde && f.fecha <= x.hasta);
    if (!s) continue;
    s.total += f.monto;
    s.porDia.set(f.fecha, (s.porDia.get(f.fecha) || 0) + f.monto);
    const porDiaSuc = s.porSucursal.get(f.sucursal) || new Map();
    porDiaSuc.set(f.fecha, (porDiaSuc.get(f.fecha) || 0) + f.monto);
    s.porSucursal.set(f.sucursal, porDiaSuc);
  }

  // Día de la semana (0 = lunes) de cada fecha cargada, para comparar los mismos días.
  const idx = (fecha) => (diaSemana(fecha) + 6) % 7;
  const resultado = semanas.map((s, i) => {
    const cargados = [...s.porDia.keys()].map(idx);
    const completa = cargados.length === 7;
    const prev = semanas[i - 1];
    let variacion = null, comparable = null;
    if (prev && prev.total > 0 && s.total > 0) {
      if (completa) {
        variacion = s.total / prev.total - 1;
      } else {
        // Semana incompleta: contra los mismos días de la semana anterior.
        const dias = new Set(cargados);
        comparable = [...prev.porDia.entries()].filter(([f]) => dias.has(idx(f))).reduce((t, [, v]) => t + v, 0);
        variacion = comparable > 0 ? s.total / comparable - 1 : null;
      }
    }
    return { desde: s.desde, hasta: s.hasta, total: s.total, diasCargados: cargados.length, completa, variacion, comparableAnterior: comparable };
  });

  // Por sucursal: venta de cada semana y variación entre las dos últimas semanas completas.
  const completas = resultado.map((s, i) => (s.completa ? i : -1)).filter((i) => i >= 0);
  const [ia, ib] = completas.slice(-2);
  const nombres = new Set(semanas.flatMap((s) => [...s.porSucursal.keys()]));
  const sumaSuc = (s, nombre) => [...(s.porSucursal.get(nombre)?.values() || [])].reduce((t, v) => t + v, 0);
  const sucursales = [...nombres].map((sucursal) => {
    const valores = semanas.map((s) => sumaSuc(s, sucursal));
    const variacion = ib !== undefined && valores[ia] > 0 ? valores[ib] / valores[ia] - 1 : null;
    return { sucursal, valores, variacion, total: valores.reduce((t, v) => t + v, 0) };
  }).sort((a, b) => b.total - a.total);

  return {
    semanas: resultado,
    sucursales,
    comparacionSucursales: ib !== undefined ? { desde: resultado[ib].desde, contra: resultado[ia].desde } : null,
  };
}

// Último día que parece completo: si el último cargado vendió menos del 30% de lo normal
// para ese día de la semana en el mes, se lo toma como incompleto y se usa el anterior.
// dias: [{ fecha, monto }] ordenados (resumirMes().dias).
export function ultimoDiaCompleto(dias) {
  const ultimo = dias.at(-1);
  if (!ultimo) return { fecha: null, incompleto: null };
  const mismos = dias.slice(0, -1).filter((x) => diaSemana(x.fecha) === diaSemana(ultimo.fecha));
  const normal = mismos.length ? mismos.reduce((s, x) => s + x.monto, 0) / mismos.length : 0;
  if (dias.length > 1 && normal > 0 && ultimo.monto < normal * 0.3) return { fecha: dias.at(-2).fecha, incompleto: ultimo };
  return { fecha: ultimo.fecha, incompleto: null };
}

// Peso de cada día de la semana (0 = domingo) según el promedio de venta de ese día.
export function pesoSemana(dias) {
  const suma = Array(7).fill(0), cuenta = Array(7).fill(0);
  for (const d of dias) { const wd = diaSemana(d.fecha); suma[wd] += d.monto; cuenta[wd]++; }
  const prom = suma.map((s, i) => (cuenta[i] ? s / cuenta[i] : 0));
  const semana = prom.reduce((a, b) => a + b, 0);
  return { peso: prom.map((p) => (semana ? p / semana : 0)), cuenta };
}

// Resumen de un mes: totales Minorista (sin NO_MINORISTA), por sucursal y por día.
export function resumirMes(filas, excluir = NO_MINORISTA) {
  const fuera = new Set(excluir);
  const porSucursal = new Map();
  const porDia = new Map();
  let total = 0, totalExcluido = 0;
  for (const f of filas) {
    if (fuera.has(f.sucursal)) { totalExcluido += f.monto; continue; }
    total += f.monto;
    const s = porSucursal.get(f.sucursal) || { sucursal: f.sucursal, total: 0, dias: {} };
    s.total += f.monto;
    s.dias[f.fecha] = (s.dias[f.fecha] || 0) + f.monto;
    porSucursal.set(f.sucursal, s);
    porDia.set(f.fecha, (porDia.get(f.fecha) || 0) + f.monto);
  }
  const sucursales = [...porSucursal.values()]
    .map((s) => ({ ...s, diasConVenta: Object.values(s.dias).filter((v) => v > 0).length }))
    .sort((a, b) => b.total - a.total);
  const dias = [...porDia.entries()].map(([fecha, monto]) => ({ fecha, monto })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { total, totalExcluido, sucursales, dias };
}

// ---- Listado maestro (sucursal, zona, encargado) y objetivos por sucursal ----

// Zona sugerida para la planilla base: el nombre sin el número final ("LUQUE 2" → "LUQUE").
export function zonaSugerida(nombre) {
  const s = normalizarSucursal(nombre).replace(/(\s+(N[°º]?\s*)?\d+[A-Z]?)+$/, '').trim();
  return s || normalizarSucursal(nombre);
}

// Lee una planilla con columna de sucursal y las columnas pedidas.
// columnas: [{ clave, re, numero? }]. Sin títulos, se toman en orden: sucursal y luego las pedidas.
function leerTabla(texto, columnas) {
  const rows = celdas(texto);
  if (!rows.length) return { filas: [], errores: [{ linea: 0, motivo: 'La planilla está vacía.' }] };
  const cab = rows[0].map((c) => c.toLowerCase());
  const tieneCabecera = /sucursal|local|tienda|nombre/.test(cab[0] || '') || cab.some((c) => /sucursal/.test(c));
  let idx = { sucursal: 0 };
  columnas.forEach((c, i) => { idx[c.clave] = i + 1; });
  if (tieneCabecera) {
    idx = { sucursal: cab.findIndex((c) => /sucursal|local|tienda|nombre/.test(c)) };
    for (const c of columnas) idx[c.clave] = cab.findIndex((x) => c.re.test(x));
    const falta = columnas.filter((c) => c.obligatoria && idx[c.clave] < 0);
    if (idx.sucursal < 0 || falta.length) {
      return { filas: [], errores: [{ linea: 1, motivo: `No encontré las columnas. Tiene que tener sucursal${columnas.filter((c) => c.obligatoria).map((c) => ', ' + c.clave).join('')}.` }] };
    }
  }
  const filas = new Map();
  const errores = [];
  (tieneCabecera ? rows.slice(1) : rows).forEach((r, k) => {
    const linea = k + (tieneCabecera ? 2 : 1);
    const sucursal = normalizarSucursal(r[idx.sucursal]);
    if (!sucursal) return errores.push({ linea, motivo: 'Falta el nombre de la sucursal.' });
    const fila = { sucursal };
    for (const c of columnas) {
      const v = idx[c.clave] >= 0 ? r[idx[c.clave]] : '';
      if (c.numero && !String(v ?? '').trim()) return; // sin valor (planilla base sin completar): se ignora
      if (c.numero) {
        const n = parseMonto(v);
        if (!n) return errores.push({ linea, motivo: `${c.clave[0].toUpperCase() + c.clave.slice(1)} inválido: "${v ?? ''}".` });
        fila[c.clave] = n;
      } else fila[c.clave] = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    }
    filas.set(sucursal, fila); // si se repite, gana la última
  });
  return { filas: [...filas.values()], errores };
}

export function leerMaestro(texto) {
  const r = leerTabla(texto, [{ clave: 'zona', re: /zona|regi[oó]n/ }, { clave: 'encargado', re: /encargad|responsable|gerente|supervisor/ }]);
  r.filas.forEach((f) => { f.zona = f.zona.toUpperCase(); });
  return r;
}

export function leerObjetivos(texto) {
  return leerTabla(texto, [{ clave: 'objetivo', re: /objetivo|meta|presupuesto/, numero: true, obligatoria: true }]);
}

// Avance de cada sucursal contra su objetivo, con la proyección ponderada del mes
// (la misma curva de días de la semana que Minorista). hasta = último día completo.
// Devuelve Map sucursal → { objetivo, avance, proyeccion, proyeccionPct }.
export function avanceSucursales(res, objetivos, hasta, pesos = PESOS_MINORISTA) {
  const out = new Map();
  if (!objetivos?.length || !hasta) return out;
  const frac = fraccionPonderada(hasta, pesos) || 0;
  const porNombre = new Map(res.sucursales.map((s) => [s.sucursal, s]));
  for (const o of objetivos) {
    const s = porNombre.get(o.sucursal);
    // Solo lo vendido hasta el último día completo, para no castigar un día a medio cargar.
    const vendido = s ? Object.entries(s.dias).reduce((a, [f, v]) => (f <= hasta ? a + v : a), 0) : 0;
    const proyeccion = frac > 0 ? vendido / frac : vendido;
    out.set(o.sucursal, { objetivo: o.objetivo, vendido, avance: vendido / o.objetivo, proyeccion, proyeccionPct: proyeccion / o.objetivo });
  }
  return out;
}

// Totales por zona según el listado maestro. Las que no figuran van a "SIN ZONA".
export function resumenZonas(res, maestro = []) {
  const info = new Map(maestro.map((m) => [m.sucursal, m]));
  const zonas = new Map();
  for (const s of res.sucursales) {
    const zona = info.get(s.sucursal)?.zona || 'SIN ZONA';
    const z = zonas.get(zona) || { zona, total: 0, sucursales: [] };
    z.total += s.total;
    z.sucursales.push(s);
    zonas.set(zona, z);
  }
  return [...zonas.values()].sort((a, b) => (a.zona === 'SIN ZONA') - (b.zona === 'SIN ZONA') || b.total - a.total);
}

// Diferencias entre el listado maestro y lo que trae una planilla de ventas.
export function controlMaestro(maestro, nombresPlanilla, excluir = NO_MINORISTA, cerradas = []) {
  const enPlanilla = new Set(nombresPlanilla);
  const enMaestro = new Set(maestro.map((m) => m.sucursal));
  const fuera = new Set([...excluir, ...cerradas]);
  return {
    faltan: [...enMaestro].filter((n) => !enPlanilla.has(n) && !fuera.has(n)).sort(),
    nuevas: [...enPlanilla].filter((n) => !enMaestro.has(n) && !fuera.has(n)).sort(),
  };
}
