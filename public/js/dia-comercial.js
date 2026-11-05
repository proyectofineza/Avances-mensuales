// Día comercial: las ventas de madrugada se suman al día que abrió la noche anterior.
// Módulo ES sin dependencias externas: lo usan el navegador (al leer la planilla) y las Functions (al guardar).
//
// Regla (sin pérdidas ni duplicados): una venta del día calendario C a la hora H va al día C−1 si H es
// anterior al cierre de madrugada del día comercial C−1; si no, va a C. La apertura no descarta ventas:
// solo marca las que quedan "fuera de horario" para revisarlas.
// Las horas son las del reloj de la sucursal (America/Asuncion, UTC−3 fijo): no se convierten.
//
// Detalle por hora (auditoría): franjas de 30 minutos contadas desde las 00:00 del día comercial;
// 0 = 00:00–00:29, 32 = 16:00–16:29, 48 = 00:00–00:29 del día siguiente (madrugada), 56 = 04:00.
// Con franjas de 30 minutos los cierres de 00:30, 01:30, 02:30 y 04:00 quedan siempre en un borde.

import { celdas, normalizarSucursal, parseMonto, parseFecha, MAX_FILAS } from './sucursales.js';
import { parseCorte } from './calc.js';

// Horario general por día de la semana (0 = domingo). Si el cierre es menor o igual a la apertura, es del día siguiente.
export const HORARIO_GENERAL = {
  0: { apertura: '10:00', cierre: '23:00' },
  1: { apertura: '16:00', cierre: '00:30' },
  2: { apertura: '16:00', cierre: '00:30' },
  3: { apertura: '16:00', cierre: '00:30' },
  4: { apertura: '16:00', cierre: '01:30' },
  5: { apertura: '16:00', cierre: '02:30' },
  6: { apertura: '11:00', cierre: '04:00' },
};
export const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const FRANJA_MIN = 30;

const pad = (n) => String(n).padStart(2, '0');
const HORA_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

// 'HH:MM' → minutos desde las 00:00 (null si no es válida).
export function minutos(hhmm) {
  const r = HORA_RE.exec(String(hhmm ?? '').trim());
  if (!r || +r[1] > 23 || +r[2] > 59) return null;
  return +r[1] * 60 + +r[2];
}

export const diaSemana = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();
export function sumarDia(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Horario guardado → horario completo y válido: { general: {0..6}, sucursales: { SUC: { wd: {apertura, cierre} } } }.
export function normalizarHorario(h) {
  const dia = (x, defecto) => (x && minutos(x.apertura) !== null && minutos(x.cierre) !== null
    ? { apertura: String(x.apertura).trim().padStart(5, '0'), cierre: String(x.cierre).trim().padStart(5, '0') }
    : defecto);
  const general = {};
  for (let wd = 0; wd < 7; wd++) general[wd] = dia(h?.general?.[wd], HORARIO_GENERAL[wd]);
  const sucursales = {};
  for (const [s, dias] of Object.entries(h?.sucursales || {})) {
    const suc = normalizarSucursal(s);
    const propios = {};
    for (let wd = 0; wd < 7; wd++) { const d = dia(dias?.[wd], null); if (d) propios[wd] = d; }
    if (suc && Object.keys(propios).length) sucursales[suc] = propios;
  }
  return { general, sucursales };
}

// Horario de una sucursal un día de la semana: { apertura, cierre, ap, ci, cruza } (ap/ci en minutos;
// si cruza la medianoche, ci es el cierre del día siguiente).
export function horarioDe(horario, sucursal, wd) {
  const h = horario?.sucursales?.[sucursal]?.[wd] || horario?.general?.[wd] || HORARIO_GENERAL[wd];
  const ap = minutos(h.apertura), ci = minutos(h.cierre);
  return { apertura: h.apertura, cierre: h.cierre, ap, ci, cruza: ci <= ap };
}

// Fecha comercial de una venta: { fecha, franja, madrugada, fueraHorario }.
export function fechaComercial(horario, sucursal, fecha, minuto) {
  const anterior = sumarDia(fecha, -1);
  const hAnt = horarioDe(horario, sucursal, diaSemana(anterior));
  const madrugada = hAnt.cruza && minuto < hAnt.ci;
  const fc = madrugada ? anterior : fecha;
  const m = madrugada ? 1440 + minuto : minuto; // minutos desde las 00:00 del día comercial
  const h = madrugada ? hAnt : horarioDe(horario, sucursal, diaSemana(fecha));
  const fin = h.cruza ? 1440 + h.ci : h.ci;
  return { fecha: fc, franja: Math.floor(m / FRANJA_MIN), madrugada, fueraHorario: m < h.ap || m >= fin };
}

// 'HH:MM:SS' o 'HH:MM' → { minuto, segundos? }; también fracción de día de Excel (0,5 = 12:00).
function parseHora(v) {
  const s = String(v ?? '').trim();
  const r = HORA_RE.exec(s);
  if (r) {
    if (+r[1] > 23 || +r[2] > 59 || (r[3] && +r[3] > 59)) return null;
    return { minuto: +r[1] * 60 + +r[2], texto: `${pad(+r[1])}:${r[2]}:${r[3] || '00'}` };
  }
  if (/^0?[.,]\d+$/.test(s)) {
    const seg = Math.round(Number(s.replace(',', '.')) * 86400);
    if (seg >= 86400) return null;
    return { minuto: Math.floor(seg / 60), texto: `${pad(Math.floor(seg / 3600))}:${pad(Math.floor(seg / 60) % 60)}:${pad(seg % 60)}` };
  }
  return null;
}

// ¿La planilla trae la hora de cada venta? (columna "hora", o la fecha con hora: "2026-11-01 00:45:34").
export function tieneHora(texto) {
  const rows = celdas(texto);
  if (!rows.length) return false;
  const cab = rows[0].map((c) => c.toLowerCase());
  if (cab.some((c) => /^hora/.test(c))) return true;
  const iF = cab.findIndex((c) => /fecha/.test(c));
  return iF >= 0 && rows.slice(1, 6).some((r) => /\d[ T]\d{1,2}:\d{2}/.test(r[iF] || ''));
}

// Lee la planilla con hora y la consolida por día comercial.
// Columnas (con títulos): sucursal, hora, fecha (o día) y monto; o la fecha con la hora en la misma celda.
// Devuelve {
//   filas: [{ sucursal, fecha, monto }]   una por sucursal y día comercial (la forma que ya guarda el portal),
//   horas: { fecha: { SUC: { franja: monto } } },
//   anteriores: [fechas]   días comerciales que el archivo trae solo en parte (la madrugada del primer día):
//                          al guardar se suman a lo que ya tenía ese día, no lo reemplazan,
//   primeraFecha, ultimaFecha   días calendario que cubre el archivo,
//   registros, total, precision ('segundos' | 'minutos' | 'hora'),
//   madrugada: { registros, monto }   ventas que pasaron al día anterior,
//   fuera: { registros, monto, sucursales }   ventas fuera del horario (se cuentan igual),
//   errores, necesitaMes }
export function leerPlanillaHoras(texto, mes, horario) {
  const vacio = (errores, extra = {}) => ({ filas: [], horas: {}, anteriores: [], errores, necesitaMes: false, registros: 0, total: 0, ...extra });
  const rows = celdas(texto);
  if (rows.length < 2) return vacio([{ linea: 0, motivo: 'La planilla está vacía.' }]);
  const cab = rows[0].map((c) => c.toLowerCase());
  const buscar = (re) => cab.findIndex((c) => re.test(c));
  const iSuc = buscar(/sucursal|local|tienda|nombre/);
  const iMonto = buscar(/monto|venta|importe|total/);
  let iHora = buscar(/^hora/);
  let iFecha = buscar(/fecha/);
  let soloDia = false;
  if (iFecha < 0) { iFecha = buscar(/^d[ií]a$/); soloDia = iFecha >= 0; }
  if (iSuc < 0 || iMonto < 0 || iFecha < 0) {
    return vacio([{ linea: 1, motivo: 'No encontré las columnas. La planilla con hora tiene que tener sucursal, hora, fecha (o día) y monto.' }]);
  }
  if (soloDia && !mes) return vacio([], { necesitaMes: true });
  const h = normalizarHorario(horario);

  const porDia = new Map(), horas = {}, errores = [];
  const fueraSuc = new Set();
  let registros = 0, total = 0, conSegundos = 0, enPunto = 0, primera = null, ultima = null;
  const madrugada = { registros: 0, monto: 0 }, fuera = { registros: 0, monto: 0 };
  rows.slice(1).forEach((r, k) => {
    const linea = k + 2;
    const sucursal = normalizarSucursal(r[iSuc]);
    let celdaFecha = r[iFecha], celdaHora = iHora >= 0 ? r[iHora] : null;
    if (celdaHora === null) {
      const m = /^(.+?)[ T](\d{1,2}:\d{2}(?::\d{2})?)/.exec(String(celdaFecha ?? '').trim());
      if (m) [celdaFecha, celdaHora] = [m[1], m[2]];
    }
    const fecha = parseFecha(celdaFecha, mes);
    const hora = parseHora(celdaHora);
    const monto = parseMonto(r[iMonto]);
    if (!sucursal) return errores.push({ linea, motivo: 'Falta el nombre de la sucursal.' });
    if (!fecha) return errores.push({ linea, motivo: `Fecha inválida: "${celdaFecha ?? ''}".` });
    if (!hora) return errores.push({ linea, motivo: `Hora inválida: "${celdaHora ?? ''}".` });
    if (monto === null) return errores.push({ linea, motivo: `Monto inválido: "${r[iMonto] ?? ''}".` });
    registros++;
    total += monto;
    if (!hora.texto.endsWith(':00')) conSegundos++;
    if (hora.texto.endsWith(':00:00')) enPunto++;
    if (!primera || fecha < primera) primera = fecha;
    if (!ultima || fecha > ultima) ultima = fecha;

    const c = fechaComercial(h, sucursal, fecha, hora.minuto);
    const key = `${sucursal}|${c.fecha}`;
    const prev = porDia.get(key);
    porDia.set(key, { sucursal, fecha: c.fecha, monto: (prev?.monto || 0) + monto });
    const dia = (horas[c.fecha] ||= {});
    const fr = (dia[sucursal] ||= {});
    fr[c.franja] = (fr[c.franja] || 0) + monto;
    if (c.madrugada) { madrugada.registros++; madrugada.monto += monto; }
    if (c.fueraHorario) { fuera.registros++; fuera.monto += monto; fueraSuc.add(sucursal); }
  });

  const filas = [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sucursal.localeCompare(b.sucursal));
  if (filas.length > MAX_FILAS) errores.unshift({ linea: 0, motivo: `Son ${filas.length} filas por día; el máximo por carga es ${MAX_FILAS}.` });
  const precision = !registros ? null : conSegundos ? 'segundos' : enPunto === registros ? 'hora' : 'minutos';
  return {
    filas: filas.slice(0, MAX_FILAS), horas, errores, necesitaMes: false,
    anteriores: primera ? [...new Set(filas.map((f) => f.fecha))].filter((f) => f < primera) : [],
    primeraFecha: primera, ultimaFecha: ultima, registros, total, precision, madrugada,
    fuera: { ...fuera, sucursales: [...fueraSuc].sort() },
  };
}

// ---- Guardado (lo usa la Function de ventas por sucursal) ----

const sumaMapa = (filas, fecha) => Object.fromEntries(filas.filter((f) => f.fecha === fecha).map((f) => [f.sucursal, f.monto]));

// Fusiona una carga en el mes guardado, sin perder ni duplicar ventas.
//   actual: { filas, horas?, madrugada?, comerciales? } lo guardado del mes (puede estar vacío)
//   nuevas: filas del mes que trae la carga
//   opciones: { anteriores: [fechas], ultimaFecha, horas: { fecha: {...} } | null, comercial: boolean }
// - Días normales: se reemplazan completos (como siempre). Si otra carga ya sumó la madrugada del día
//   siguiente (madrugada[fecha]) y esta carga no la trae (es el último día del archivo), se vuelve a sumar.
// - Días "anteriores" (solo la madrugada, que vino en el archivo del día o mes siguiente): se reemplaza la
//   madrugada sumada antes por la nueva, sin tocar el resto del día.
// Devuelve { filas, horas, madrugada, comerciales, dias, reemplazadas }.
export function fusionarMes(actual, nuevas, { anteriores = [], ultimaFecha = null, horas = null, comercial = false } = {}) {
  const parcial = new Set(anteriores);
  const madrugada = structuredClone(actual?.madrugada || {});
  const horasMes = structuredClone(actual?.horas || {});
  const comerciales = new Set(actual?.comerciales || []);
  const normales = nuevas.filter((f) => !parcial.has(f.fecha));
  const fechas = new Set(normales.map((f) => f.fecha));
  const previas = actual?.filas || [];

  // 1) Días completos: se reemplazan.
  const mapa = new Map(previas.filter((f) => !fechas.has(f.fecha)).map((f) => [`${f.sucursal}|${f.fecha}`, { ...f }]));
  for (const f of normales) mapa.set(`${f.sucursal}|${f.fecha}`, { ...f });
  for (const fecha of fechas) {
    // El archivo trae el día siguiente: la madrugada ya viene adentro y la guardada se descarta.
    const traeSiguiente = horas && ultimaFecha && fecha < ultimaFecha;
    if (traeSiguiente) delete madrugada[fecha];
    else for (const [s, v] of Object.entries(madrugada[fecha] || {})) {
      const k = `${s}|${fecha}`;
      mapa.set(k, { sucursal: s, fecha, monto: (mapa.get(k)?.monto || 0) + v });
    }
    if (horas) {
      const viejas = horasMes[fecha] || {};
      const dia = structuredClone(horas[fecha] || {});
      if (!traeSiguiente) {
        for (const [s, fr] of Object.entries(viejas)) for (const [k, v] of Object.entries(fr)) {
          if (+k >= 48) (dia[s] ||= {})[k] = v; // madrugada del día siguiente, que este archivo no trae
        }
      }
      horasMes[fecha] = dia;
    } else delete horasMes[fecha]; // carga sin hora: el detalle por hora de ese día ya no corresponde
    if (comercial) comerciales.add(fecha); else comerciales.delete(fecha);
  }

  // 2) Días parciales: solo la madrugada.
  for (const fecha of parcial) {
    const vieja = madrugada[fecha] || {};
    const nueva = sumaMapa(nuevas, fecha);
    for (const s of new Set([...Object.keys(vieja), ...Object.keys(nueva)])) {
      const k = `${s}|${fecha}`;
      const monto = (mapa.get(k)?.monto || 0) - (vieja[s] || 0) + (nueva[s] || 0);
      if (monto > 0) mapa.set(k, { sucursal: s, fecha, monto });
      else mapa.delete(k);
    }
    if (Object.keys(nueva).length) madrugada[fecha] = nueva; else delete madrugada[fecha];
    if (horas) {
      const dia = horasMes[fecha] || {};
      for (const fr of Object.values(dia)) for (const k of Object.keys(fr)) if (+k >= 48) delete fr[k];
      for (const [s, fr] of Object.entries(horas[fecha] || {})) Object.assign((dia[s] ||= {}), fr);
      horasMes[fecha] = dia;
    }
  }

  const filas = [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sucursal.localeCompare(b.sucursal));
  return {
    filas, horas: horasMes, madrugada, comerciales: [...comerciales].sort(),
    dias: fechas.size, parciales: parcial.size,
    reemplazadas: previas.filter((f) => fechas.has(f.fecha)).length,
  };
}

// Valida la parte de una carga que trae hora (viene del navegador).
export function validarHoras(horas) {
  if (horas === null || horas === undefined) return null;
  if (typeof horas !== 'object') return false;
  for (const [fecha, dia] of Object.entries(horas)) {
    if (!parseCorte(fecha) || typeof dia !== 'object') return false;
    for (const fr of Object.values(dia)) {
      if (typeof fr !== 'object') return false;
      for (const [k, v] of Object.entries(fr)) if (!/^\d{1,2}$/.test(k) || +k > 95 || !Number.isFinite(v) || v < 0) return false;
    }
  }
  return true;
}

// Etiqueta de una franja: 33 → '16:30', 49 → '00:30 (+1)'.
export function etiquetaFranja(k) {
  const m = k * FRANJA_MIN;
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}${m >= 1440 ? ' (+1)' : ''}`;
}
