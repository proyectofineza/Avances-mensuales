// Portal de cada sucursal: validación de ubicación, historial mensual por sucursal y la vista
// que ve la sucursal (solo sus datos y su puesto). Módulo ES sin dependencias del navegador.

import { normalizarSucursal, parseMonto, resumirMes, ultimoDiaCompleto, avanceSucursales } from './sucursales.js';

export const RADIO_DEFECTO = 300;      // metros alrededor del local
export const PRECISION_MAXIMA = 1000;  // una ubicación menos precisa que esto no sirve para validar
export const PRECISION_GPS = 150;      // al autorizar: con esta precisión o mejor, el equipo tiene GPS

// Distancia en metros entre dos puntos { lat, lng } (haversine).
export function distanciaMetros(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Posición enviada por el navegador → { lat, lng, precision } o null si no es válida.
export function leerPosicion(p) {
  const lat = Number(p?.lat), lng = Number(p?.lng), precision = Number(p?.precision);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, precision: Number.isFinite(precision) && precision > 0 ? Math.round(precision) : null };
}

// ¿La posición está en el local? ref = ubicación de la sucursal { lat, lng }.
// Se descuenta la imprecisión del GPS (hasta PRECISION_GPS) para no rechazar a quien está en la puerta.
export function revisarUbicacion(ref, radio, pos) {
  if (!ref) return { ok: false, motivo: 'La sucursal todavía no tiene su ubicación cargada. Avisá al administrador.' };
  if (!pos) return { ok: false, motivo: 'Para ingresar tenés que permitir la ubicación en este equipo.' };
  if (!pos.precision || pos.precision > PRECISION_MAXIMA) {
    return { ok: false, motivo: 'La ubicación de este equipo es muy imprecisa. Activá el GPS (o la ubicación precisa) y probá de nuevo.' };
  }
  const distancia = Math.round(distanciaMetros(ref, pos));
  const margen = Math.min(pos.precision, PRECISION_GPS);
  if (distancia - margen > (radio || RADIO_DEFECTO)) {
    return { ok: false, distancia, motivo: `Estás a ${fmtDistancia(distancia)} de la sucursal. Solo se puede ingresar desde el local.` };
  }
  return { ok: true, distancia };
}

export const fmtDistancia = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString('es-PY', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`);

// ---- Historial mensual por sucursal (planilla) ----

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function numeroMes(v) {
  const s = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^\d{1,2}$/.test(s) && +s >= 1 && +s <= 12) return +s;
  const i = MESES_CORTOS.findIndex((m) => s.startsWith(m) || (m === 'sep' && s.startsWith('set')));
  return i >= 0 ? i + 1 : null;
}

function separar(texto) {
  const lineas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const muestra = lineas.slice(0, 5).join('\n');
  const sep = muestra.includes('\t') ? '\t' : (muestra.split(';').length > muestra.split(',').length ? ';' : ',');
  return lineas.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
}

// Dos formatos (con títulos):
//   largo: Sucursal | Año | Mes | Venta        (una fila por sucursal y mes)
//   ancho: Sucursal | Año | Enero | … | Diciembre  (una fila por sucursal y año; sin Año, se usa `anio`)
// → { registros: { 'AAAA-MM': { SUCURSAL: monto } }, errores: [{ linea, motivo }], formato, necesitaAnio }
export function leerHistorialSucursales(texto, anio) {
  const rows = separar(texto);
  if (rows.length < 2) return { registros: {}, errores: [{ linea: 0, motivo: 'Pegá la planilla con la fila de títulos.' }] };
  const cab = rows[0].map((c) => c.toLowerCase());
  const iSuc = cab.findIndex((c) => /sucursal|local|tienda/.test(c));
  const iAnio = cab.findIndex((c) => /^a[ñn]o$|year/.test(c));
  const iMes = cab.findIndex((c) => /^mes$/.test(c));
  const iVenta = cab.findIndex((c) => /venta|monto|importe|total/.test(c));
  const colMeses = cab.map((c, i) => (i !== iMes && i !== iSuc && numeroMes(c) && !/^\d+$/.test(c) ? [i, numeroMes(c)] : null)).filter(Boolean);
  if (iSuc < 0) return { registros: {}, errores: [{ linea: 1, motivo: 'No encontré la columna Sucursal.' }] };

  const ancho = iMes < 0 && colMeses.length > 0;
  if (!ancho && (iAnio < 0 || iMes < 0 || iVenta < 0)) {
    return { registros: {}, errores: [{ linea: 1, motivo: 'La planilla tiene que tener Sucursal, Año, Mes y Venta, o Sucursal y una columna por mes (Enero … Diciembre).' }] };
  }
  if (ancho && iAnio < 0 && !anio) return { registros: {}, errores: [], formato: 'ancho', necesitaAnio: true };

  const registros = {}, errores = [];
  const poner = (y, m, suc, monto) => {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    (registros[k] ||= {})[suc] = monto;
  };
  rows.slice(1).forEach((r, k) => {
    const linea = k + 2;
    const suc = normalizarSucursal(r[iSuc]);
    if (!suc) return errores.push({ linea, motivo: 'Falta el nombre de la sucursal.' });
    const y = Number(iAnio >= 0 ? r[iAnio] : anio);
    if (!(y >= 2000 && y <= 2100)) return errores.push({ linea, motivo: `Año inválido: "${r[iAnio] ?? ''}".` });
    if (ancho) {
      for (const [i, m] of colMeses) {
        if (!String(r[i] ?? '').trim()) continue; // mes vacío: no se carga
        const monto = parseMonto(r[i]);
        if (monto === null) errores.push({ linea, motivo: `Monto inválido en ${rows[0][i]}: "${r[i]}".` });
        else poner(y, m, suc, monto);
      }
    } else {
      const m = numeroMes(r[iMes]);
      if (!m) return errores.push({ linea, motivo: `Mes inválido: "${r[iMes] ?? ''}".` });
      const monto = parseMonto(r[iVenta]);
      if (monto === null) return errores.push({ linea, motivo: `Monto inválido: "${r[iVenta] ?? ''}".` });
      poner(y, m, suc, monto);
    }
  });
  return { registros, errores, formato: ancho ? 'ancho' : 'largo', necesitaAnio: false };
}

// Totales por sucursal de un mes cargado en el portal: { SUCURSAL: monto }.
export function totalesPorSucursal(filas) {
  const out = {};
  for (const f of filas) out[f.sucursal] = (out[f.sucursal] || 0) + f.monto;
  return out;
}

// ---- Vista de la sucursal ----

const diasDelMes = (mes) => { const [y, m] = mes.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const variacion = (a, b) => (a !== null && a !== undefined && b > 0 ? a / b - 1 : null);

// Todo lo que ve una sucursal, sin datos de otras (solo su puesto entre todas).
//   filasMes:   filas de todas las sucursales del mes (sucursales/AAAA-MM)
//   objetivos:  [{ sucursal, objetivo }] del mes
//   mensual:    { 'AAAA-MM': monto } de esta sucursal (historial + portal)
//   cerradas:   nombres de sucursales cerradas (no cuentan en el ranking)
export function vistaSucursal({ sucursal, mes, filasMes = [], objetivos = [], mensual = {}, cerradas = [] }) {
  const res = resumirMes(filasMes);
  const fuera = new Set(cerradas);
  const propia = res.sucursales.find((s) => s.sucursal === sucursal) || null;
  const ultimaFecha = res.dias.at(-1)?.fecha || null;
  const hasta = ultimoDiaCompleto(res.dias).fecha;
  const total = diasDelMes(mes);
  const diaUltimo = ultimaFecha ? Number(ultimaFecha.slice(8)) : 0;
  const completo = diaUltimo >= total;

  // Avance contra el objetivo del mes.
  const av = avanceSucursales(res, objetivos, hasta);
  // Sin objetivo propio, la proyección se calcula igual (con un objetivo cualquiera).
  const mio = av.get(sucursal) || (propia ? avanceSucursales(res, [{ sucursal, objetivo: 1 }], hasta).get(sucursal) : null);
  const vendido = propia?.total || 0;
  const objetivo = objetivos.find((o) => o.sucursal === sucursal)?.objetivo || null;
  const diasRestantes = Math.max(total - diaUltimo, 0);
  const falta = objetivo ? Math.max(objetivo - vendido, 0) : null;
  const avance = {
    objetivo, vendido, ultimaFecha, hasta, completo, diasMes: total, diasRestantes,
    pct: objetivo ? vendido / objetivo : null,
    proyeccion: completo ? vendido : mio?.proyeccion ?? null,
    proyeccionPct: objetivo ? (completo ? vendido / objetivo : mio?.proyeccionPct ?? null) : null,
    falta,
    necesarioDia: falta !== null && diasRestantes > 0 ? falta / diasRestantes : null,
    promedioDia: diaUltimo ? vendido / diaUltimo : 0,
  };

  // Puesto entre las sucursales abiertas: por venta del mes y por cumplimiento proyectado.
  const abiertas = res.sucursales.filter((s) => !fuera.has(s.sucursal));
  const iVenta = abiertas.findIndex((s) => s.sucursal === sucursal);
  const porCumpl = [...av.entries()].filter(([n]) => !fuera.has(n)).sort((a, b) => b[1].proyeccionPct - a[1].proyeccionPct);
  const iCumpl = porCumpl.findIndex(([n]) => n === sucursal);
  const ranking = {
    venta: iVenta >= 0 ? { puesto: iVenta + 1, de: abiertas.length } : null,
    cumplimiento: iCumpl >= 0 ? { puesto: iCumpl + 1, de: porCumpl.length } : null,
  };

  // Venta diaria del mes (sin días futuros).
  const dias = res.dias.map((d) => ({ fecha: d.fecha, monto: propia?.dias[d.fecha] || 0 }));

  // Historial: el año del mes y los dos anteriores, mes a mes.
  const anio = Number(mes.slice(0, 4));
  const mensualConMes = { ...mensual, [mes]: vendido || mensual[mes] || null };
  const serie = (y) => Array.from({ length: 12 }, (_, i) => {
    const v = mensualConMes[`${y}-${String(i + 1).padStart(2, '0')}`];
    return v === undefined || v === null ? null : v;
  });
  const series = { [anio]: serie(anio), [anio - 1]: serie(anio - 1), [anio - 2]: serie(anio - 2) };
  const nMes = Number(mes.slice(5));
  const variaciones = series[anio].map((v, i) => variacion(v, series[anio - 1][i]));
  // Acumulado del año: meses cerrados (antes del mes en curso, o hasta él si ya terminó) con los dos años.
  const hastaMes = completo ? nMes : nMes - 1;
  const pares = series[anio].slice(0, hastaMes).map((v, i) => [v, series[anio - 1][i]]).filter(([a, b]) => a !== null && b !== null);
  const acumulado = pares.length ? {
    meses: pares.length,
    actual: pares.reduce((s, [a]) => s + a, 0),
    anterior: pares.reduce((s, [, b]) => s + b, 0),
  } : null;
  if (acumulado) acumulado.variacion = variacion(acumulado.actual, acumulado.anterior);
  const mismoMesAnterior = series[anio - 1][nMes - 1];

  return {
    sucursal, mes, abierta: !fuera.has(sucursal), conVentas: Boolean(propia),
    avance, ranking, dias,
    historial: { anio, series, variaciones, acumulado, mesEnCurso: completo ? null : nMes },
    vsAnioAnterior: {
      anterior: mismoMesAnterior,
      // Proyección del mes contra el mismo mes del año anterior (si el mes no terminó).
      variacion: variacion(completo ? vendido : avance.proyeccion, mismoMesAnterior),
    },
  };
}
