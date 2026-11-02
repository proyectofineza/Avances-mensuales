// Objetivo sugerido: lectura de la planilla de años anteriores, cuentas de la tabla y cálculo
// del sugerido según el movimiento de las ventas.
// Módulo ES sin dependencias del navegador: lo usan la pantalla y las Netlify Functions.
//
// La planilla (pegada de Excel) tiene uno o más bloques así:
//   AÑO        2024            2025            2026
//   NEGOCIO    Noviembre
//   BARATOTE   21.744.266.658  ...      ← se calcula (Minorista + Mayorista)
//   MINORISTA  13.817.120.269  ...
//   MAYORISTA / FINEGLASS / FINEBOATS
//   EVENTO / PLASTICO                   ← no se usan (solo para controlar el General)
//   GENERAL    ...                      ← se calcula (suma de las unidades)

import { parseMonto } from './sucursales.js';

// Unidades del portal, en el orden de la tabla.
export const NEGOCIOS = [
  { id: 'min', nombre: 'Minorista', re: /^minorista$/ },
  { id: 'may', nombre: 'Mayorista', re: /^mayorista$/ },
  { id: 'fgl', nombre: 'Fineglass', re: /^fine ?glass$/ },
  { id: 'fbt', nombre: 'Fineboats', re: /^fine ?boats?$/ },
];
export const UNIDADES_OBJ = NEGOCIOS.map((n) => n.id);
// Filas de la planilla que no son unidades del portal: se ignoran.
const IGNORADOS = /^eventos?$|^pl[aá]sticos?$/;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const sinTilde = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const numeroMes = (s) => {
  const t = sinTilde(s).replace(/^setiembre$/, 'septiembre');
  const i = MESES.indexOf(t);
  return i >= 0 ? i + 1 : null;
};

function celdas(texto) {
  return String(texto).replace(/^﻿/, '').split(/\r?\n/).map((l) => {
    const sep = l.includes('\t') ? '\t' : ';';
    return l.split(sep).map((c) => c.trim());
  });
}

// Devuelve { bloques: [{ mes, anios, valores: { 'AAAA': { min, may, fgl, fbt } } }], errores }.
// mesPorDefecto (1–12) se usa si un bloque no dice el mes.
export function leerPlanillaObjetivos(texto, mesPorDefecto = null) {
  const bloques = [];
  const errores = [];
  let actual = null;
  celdas(texto).forEach((fila, k) => {
    const rotulo = sinTilde(fila[0]);
    if (!rotulo && fila.every((c) => !c)) return;
    if (/^anos?$|^anio$/.test(rotulo)) {
      const anios = fila.slice(1).map((c) => (/^\d{4}$/.test(c) ? Number(c) : null));
      actual = { mes: mesPorDefecto, anios, valores: {}, declarados: {}, excluidos: {} };
      anios.forEach((a) => { if (a) actual.valores[a] = {}; });
      bloques.push(actual);
      return;
    }
    if (!actual) return; // texto antes del primer "AÑO"
    if (rotulo === 'negocio') {
      const mes = fila.slice(1).map(numeroMes).find(Boolean);
      if (mes) actual.mes = mes;
      return;
    }
    const montoDe = (anio, i) => (anio ? parseMonto(fila[i + 1] ?? '') : null);
    if (rotulo === 'baratote' || rotulo === 'general' || rotulo === 'total') {
      // Totales de la planilla: no se usan, pero se comparan con la suma (ver diferenciasTotales).
      const campo = rotulo === 'baratote' ? 'baratote' : 'general';
      actual.anios.forEach((anio, i) => {
        const v = montoDe(anio, i);
        if (v !== null) (actual.declarados[anio] ||= {})[campo] = v;
      });
      return;
    }
    if (IGNORADOS.test(rotulo)) {
      // Evento, Plástico: fuera del portal. Se guarda cuánto suman para no marcar el General como error.
      actual.anios.forEach((anio, i) => {
        const v = montoDe(anio, i);
        if (v) actual.excluidos[anio] = (actual.excluidos[anio] || 0) + v;
      });
      return;
    }
    const negocio = NEGOCIOS.find((n) => n.re.test(rotulo));
    if (!negocio) {
      errores.push({ linea: k + 1, motivo: `No reconozco el negocio "${fila[0]}".` });
      return;
    }
    actual.anios.forEach((anio, i) => {
      if (!anio) return;
      const c = fila[i + 1] ?? '';
      if (!c) return; // celda vacía: sin dato
      const v = parseMonto(c);
      if (v === null) errores.push({ linea: k + 1, motivo: `Monto inválido en ${negocio.nombre} ${anio}: "${c}".` });
      else actual.valores[anio][negocio.id] = v;
    });
  });
  const validos = bloques.filter((b) => b.anios.some(Boolean));
  validos.filter((b) => !b.mes).forEach(() => errores.push({ linea: 0, motivo: 'Hay un bloque sin mes (fila NEGOCIO): elegí el mes antes de leer.' }));
  return { bloques: validos.filter((b) => b.mes), errores };
}

// Pasa los bloques a registros por mes: { 'AAAA-MM': { min, may, fgl, fbt } } (solo años con algún dato).
export function registrosPorMes(bloques) {
  const out = {};
  for (const b of bloques) {
    for (const [anio, v] of Object.entries(b.valores)) {
      if (!Object.keys(v).length) continue;
      out[`${anio}-${String(b.mes).padStart(2, '0')}`] = v;
    }
  }
  return out;
}

// Totales de una columna: Baratote (Minorista + Mayorista) y General (las cuatro unidades).
export function totales(v = {}) {
  const n = (id) => Number(v[id]) || 0;
  return { baratote: n('min') + n('may'), general: NEGOCIOS.reduce((s, x) => s + n(x.id), 0) };
}

// Totales escritos en la planilla que no coinciden con la suma de sus negocios
// (más de Gs. 1.000 de diferencia): [{ mes, anio, campo, planilla, calculado }].
// El General de la planilla incluye Evento y Plástico: se suman para comparar.
export function diferenciasTotales(bloques) {
  const out = [];
  for (const b of bloques) {
    for (const [anio, dec] of Object.entries(b.declarados || {})) {
      const t = totales(b.valores[anio]);
      const calc = { baratote: t.baratote, general: t.general + (b.excluidos?.[anio] || 0) };
      for (const campo of ['baratote', 'general']) {
        if (dec[campo] !== undefined && Math.abs(dec[campo] - calc[campo]) > 1000) {
          out.push({ mes: b.mes, anio: Number(anio), campo, planilla: dec[campo], calculado: calc[campo] });
        }
      }
    }
  }
  return out;
}

export const variacion = (a, b) => (b > 0 && a !== null && a !== undefined ? a / b - 1 : null);

// ---- Sugerido según el movimiento ----
// Para cada unidad: el mismo mes del año anterior × la tendencia de los últimos meses cerrados
// (lo vendido en esos meses contra los mismos meses del año anterior). La tendencia se limita a
// ±tope para que un mes raro no dispare el objetivo. Se redondea al millón.
//   base:  { min, may, fgl, fbt } del mismo mes del año anterior
//   pares: [{ mes, actual: {...}, anterior: {...} }] de los últimos meses cerrados (más reciente primero)
// Devuelve { valores, detalle: { id: { base, tendencia, aplicada, topeada, meses } } }.
export const TOPE_TENDENCIA = 0.5;

export function calcularSugerido(base, pares = [], { tope = TOPE_TENDENCIA } = {}) {
  const valores = {};
  const detalle = {};
  for (const id of UNIDADES_OBJ) {
    const b = Number(base?.[id]);
    if (!(b > 0)) continue;
    const usados = pares.filter((p) => Number(p.anterior?.[id]) > 0 && p.actual?.[id] !== undefined && p.actual?.[id] !== null);
    const suma = (clave) => usados.reduce((s, p) => s + (Number(p[clave][id]) || 0), 0);
    const tendencia = usados.length ? suma('actual') / suma('anterior') - 1 : null;
    const aplicada = tendencia === null ? 0 : Math.min(Math.max(tendencia, -tope), tope);
    valores[id] = Math.round((b * (1 + aplicada)) / 1e6) * 1e6;
    detalle[id] = { base: b, tendencia, aplicada, topeada: tendencia !== null && aplicada !== tendencia, meses: usados.map((p) => p.mes) };
  }
  return { valores, detalle };
}
