// Ventas por sucursal de Baratote Minorista: lectura de la planilla y resúmenes.
// Módulo ES sin dependencias: lo usan el navegador y las Netlify Functions.
// Forma de cada fila (pensada para pasar tal cual a una tabla en Supabase):
//   { sucursal: 'LUQUE 1', fecha: 'YYYY-MM-DD', monto: 1234567 }

import { parseCorte } from './calc.js';

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
