// Objetivo sugerido: lectura de la planilla de años anteriores + sugerido, y cuentas de la tabla.
// Módulo ES sin dependencias del navegador: lo usan la pantalla y las Netlify Functions.
//
// La planilla (pegada de Excel) tiene uno o más bloques así:
//   AÑO        2024            2025            2026
//   NEGOCIO    Noviembre
//   BARATOTE   21.744.266.658  22.700.000.000  22.700.000.000   ← se calcula (Minorista + Mayorista)
//   MINORISTA  13.817.120.269  ...
//   MAYORISTA  ...
//   EVENTO / PLASTICO / FINEGLASS / FINEBOATS
//   GENERAL    ...                                              ← se calcula (suma de todo)

import { parseMonto } from './sucursales.js';

// Negocios de la planilla. Los del portal (unidad: true) son los que se cargan como objetivo.
export const NEGOCIOS = [
  { id: 'min', nombre: 'Minorista', re: /^minorista$/, unidad: true },
  { id: 'may', nombre: 'Mayorista', re: /^mayorista$/, unidad: true },
  { id: 'evento', nombre: 'Evento', re: /^eventos?$/, unidad: false },
  { id: 'plastico', nombre: 'Plástico', re: /^pl[aá]sticos?$/, unidad: false },
  { id: 'fgl', nombre: 'Fineglass', re: /^fine ?glass$/, unidad: true },
  { id: 'fbt', nombre: 'Fineboats', re: /^fine ?boats?$/, unidad: true },
];
export const UNIDADES_OBJ = NEGOCIOS.filter((n) => n.unidad).map((n) => n.id);

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

// Devuelve { bloques: [{ mes, anios, valores: { 'AAAA': { min, may, ... } } }], errores }.
// mesPorDefecto (1–12) se usa si un bloque no dice el mes.
export function leerPlanillaObjetivos(texto, mesPorDefecto = null) {
  const bloques = [];
  const errores = [];
  let actual = null;
  celdas(texto).forEach((fila, k) => {
    const rotulo = sinTilde(fila[0]);
    if (!rotulo && fila.every((c) => !c)) return;
    if (/^anos?$|^año$|^anio$/.test(rotulo) || rotulo === 'ano') {
      const anios = fila.slice(1).map((c) => (/^\d{4}$/.test(c) ? Number(c) : null));
      actual = { mes: mesPorDefecto, anios, valores: {}, declarados: {} };
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
    if (rotulo === 'baratote' || rotulo === 'general' || rotulo === 'total') {
      // Totales de la planilla: no se usan, pero se comparan con la suma (ver diferenciasTotales).
      const campo = rotulo === 'baratote' ? 'baratote' : 'general';
      actual.anios.forEach((anio, i) => {
        const v = anio ? parseMonto(fila[i + 1] ?? '') : null;
        if (v !== null) (actual.declarados[anio] ||= {})[campo] = v;
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

// Pasa los bloques a registros por mes: { 'AAAA-MM': { min, may, ... } } (solo años con algún dato).
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

// Totales de una columna: Baratote (Minorista + Mayorista) y General (todo).
export function totales(v = {}) {
  const n = (id) => Number(v[id]) || 0;
  const baratote = n('min') + n('may');
  return { baratote, general: NEGOCIOS.reduce((s, x) => s + n(x.id), 0) };
}

// Totales escritos en la planilla que no coinciden con la suma de sus negocios
// (más de Gs. 1.000 de diferencia): [{ mes, anio, campo, planilla, calculado }].
export function diferenciasTotales(bloques) {
  const out = [];
  for (const b of bloques) {
    for (const [anio, dec] of Object.entries(b.declarados || {})) {
      const t = totales(b.valores[anio]);
      for (const campo of ['baratote', 'general']) {
        if (dec[campo] !== undefined && Math.abs(dec[campo] - t[campo]) > 1000) {
          out.push({ mes: b.mes, anio: Number(anio), campo, planilla: dec[campo], calculado: t[campo] });
        }
      }
    }
  }
  return out;
}

export const variacion =(a, b) => (b > 0 && a !== null && a !== undefined ? a / b - 1 : null);
