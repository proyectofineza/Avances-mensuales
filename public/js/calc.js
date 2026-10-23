// Reglas de cálculo (sección 5 de la especificación).
// Módulo ES sin dependencias: lo usan el navegador y las Netlify Functions.

export const UNIDADES = [
  { id: 'may', nombre: 'Mayorista', grupo: 'Baratote', calendario: 'lun-dom' },
  { id: 'min', nombre: 'Minorista', grupo: 'Baratote', calendario: 'lun-dom' },
  { id: 'fgl', nombre: 'Fineglass', grupo: null, calendario: 'lun-vie' },
  { id: 'fbt', nombre: 'Fineboats', grupo: null, calendario: 'lun-dom' },
];

export const IDS = UNIDADES.map((u) => u.id);

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function parseCorte(corte) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(corte || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

function esOperativo(y, m, d, calendario) {
  if (calendario !== 'lun-vie') return true;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd >= 1 && wd <= 5;
}

// Días operativos del mes: hasta el corte (inclusive) y en total.
export function diasOperativos(corte, calendario = 'lun-dom') {
  const c = parseCorte(corte);
  if (!c) return { operados: 0, mes: 0 };
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  let operados = 0, mes = 0;
  for (let d = 1; d <= ultimo; d++) {
    if (!esOperativo(c.y, c.m, d, calendario)) continue;
    mes++;
    if (d <= c.d) operados++;
  }
  return { operados, mes };
}

// Días que usa la proyección de una unidad: los del calendario (automático)
// o los que cargó el administrador (manual).
export function diasUnidad(data, u) {
  if (data.dias?.modo === 'manual') {
    const m = data.dias[u.id] || {};
    const mes = Math.max(Number(m.mes) || 0, 0);
    if (mes > 0) return { operados: Math.min(Math.max(Number(m.curso) || 0, 0), mes), mes };
  }
  return diasOperativos(data.corte, u.calendario);
}

// dias = { operados, mes }
export function calcUnidad(real, objetivo, dias) {
  real = Number(real) || 0;
  objetivo = Number(objetivo) || 0;
  const { operados, mes } = dias;
  const proyeccion = operados > 0 ? (real / operados) * mes : real;
  const faltante = Math.max(objetivo - real, 0);
  const diasRestantes = mes - operados;
  return {
    real,
    objetivo,
    diasOperados: operados,
    diasMes: mes,
    avance: objetivo > 0 ? real / objetivo : 0,
    proyeccion,
    proyeccionPct: objetivo > 0 ? proyeccion / objetivo : 0,
    ritmoIdeal: mes > 0 ? operados / mes : 0,
    faltante,
    diasRestantes,
    necesarioDia: diasRestantes > 0 ? faltante / diasRestantes : 0,
    promedioDia: operados > 0 ? real / operados : 0,
  };
}

// Suma de unidades: la proyección es la suma de proyecciones de cada una.
// Automático: ritmo ideal y días con calendario lunes a domingo.
// Manual: días de la unidad con mayor objetivo y ritmo ideal ponderado por objetivo.
function agregado(partes, corte, manual) {
  const real = partes.reduce((s, p) => s + p.real, 0);
  const objetivo = partes.reduce((s, p) => s + p.objetivo, 0);
  const proyeccion = partes.reduce((s, p) => s + p.proyeccion, 0);
  let operados, mes, ritmoIdeal;
  if (manual) {
    const ref = partes.reduce((a, p) => (p.objetivo > a.objetivo ? p : a), partes[0]);
    operados = ref.diasOperados;
    mes = ref.diasMes;
    ritmoIdeal = objetivo > 0 ? partes.reduce((s, p) => s + p.objetivo * p.ritmoIdeal, 0) / objetivo : ref.ritmoIdeal;
  } else {
    ({ operados, mes } = diasOperativos(corte, 'lun-dom'));
    ritmoIdeal = mes > 0 ? operados / mes : 0;
  }
  const faltante = Math.max(objetivo - real, 0);
  const diasRestantes = mes - operados;
  return {
    real,
    objetivo,
    proyeccion,
    diasOperados: operados,
    diasMes: mes,
    avance: objetivo > 0 ? real / objetivo : 0,
    proyeccionPct: objetivo > 0 ? proyeccion / objetivo : 0,
    ritmoIdeal,
    faltante,
    diasRestantes,
    necesarioDia: diasRestantes > 0 ? faltante / diasRestantes : 0,
    promedioDia: operados > 0 ? real / operados : 0,
  };
}

// Comparativa: proyección del mes actual vs venta de cierre del mes anterior
// y del mismo mes del año anterior. var = null si no hay dato.
function comparar(c, ant, aa) {
  c.ant = ant;
  c.aa = aa;
  c.varAnt = ant > 0 ? c.proyeccion / ant - 1 : null;
  c.varAa = aa > 0 ? c.proyeccion / aa - 1 : null;
}

// Cálculo completo a partir de { corte, obj, real, dias?, comp? }.
export function calcularReporte(data) {
  const corte = data.corte;
  const manual = data.dias?.modo === 'manual';
  const ant = data.comp?.ant || {};
  const aa = data.comp?.aa || {};
  const unidades = {};
  for (const u of UNIDADES) {
    unidades[u.id] = { ...u, ...calcUnidad(data.real?.[u.id], data.obj?.[u.id], diasUnidad(data, u)) };
    comparar(unidades[u.id], Number(ant[u.id]) || 0, Number(aa[u.id]) || 0);
  }
  const suma = (src, ids) => ids.reduce((s, id) => s + (Number(src[id]) || 0), 0);
  const baratote = agregado([unidades.may, unidades.min], corte, manual);
  comparar(baratote, suma(ant, ['may', 'min']), suma(aa, ['may', 'min']));
  const total = agregado(Object.values(unidades), corte, manual);
  comparar(total, suma(ant, IDS), suma(aa, IDS));
  return { corte, manual, unidades, baratote, total };
}

// Deja un reporte con la forma esperada (montos enteros ≥ 0, días 0–31).
export function normalizarReporte(src = {}) {
  const montos = (o = {}) => Object.fromEntries(IDS.map((id) => {
    const n = Math.round(Number(o[id]) || 0);
    return [id, n > 0 ? n : 0];
  }));
  const dia = (v) => Math.min(Math.max(Math.round(Number(v) || 0), 0), 31);
  const dias = { modo: src.dias?.modo === 'manual' ? 'manual' : 'auto' };
  for (const id of IDS) dias[id] = { mes: dia(src.dias?.[id]?.mes), curso: dia(src.dias?.[id]?.curso) };
  return {
    corte: parseCorte(src.corte) ? src.corte : '',
    obj: montos(src.obj),
    real: montos(src.real),
    dias,
    comp: { ant: montos(src.comp?.ant), aa: montos(src.comp?.aa) },
  };
}

// Devuelve el mensaje de error o null si se puede publicar.
export function validarReporte(d) {
  if (!d.corte || !parseCorte(d.corte)) return 'Indicá la fecha de corte.';
  const falta = UNIDADES.find((u) => !(d.obj?.[u.id] > 0));
  if (falta) return `Falta el objetivo mensual de ${falta.nombre}.`;
  if (d.dias?.modo === 'manual') {
    for (const u of UNIDADES) {
      const x = d.dias[u.id] || {};
      if (!(x.mes >= 1)) return `Indicá los días del mes de ${u.nombre}.`;
      if (!(x.curso >= 1) || x.curso > x.mes) return `Revisá el día en curso de ${u.nombre}: tiene que estar entre 1 y ${x.mes}.`;
    }
  }
  return null;
}

// Nombres de los meses de comparación.
export function mesAnterior(corte) {
  const c = parseCorte(corte);
  if (!c) return '';
  return c.m === 1 ? `${MESES[11]} ${c.y - 1}` : `${MESES[c.m - 2]} ${c.y}`;
}

export function mismoMesAnioAnterior(corte) {
  const c = parseCorte(corte);
  return c ? `${MESES[c.m - 1]} ${c.y - 1}` : '';
}

export function fmtVar(v) {
  if (v === null || v === undefined) return '—';
  return (v >= 0 ? '+' : '−') + fmtPct(Math.abs(v));
}

export function estado(proyeccionPct) {
  if (proyeccionPct >= 1) return { texto: 'En camino', clase: 'ok', bg: '#E3EBFC', fg: '#1E3A8A' };
  if (proyeccionPct >= 0.9) return { texto: 'Ajustado', clase: 'warn', bg: '#FDF0DC', fg: '#92400E' };
  return { texto: 'En riesgo', clase: 'risk', bg: '#FBE4E8', fg: '#9F1239' };
}

// ---- Formato ----

export function fmtMillones(v) {
  return 'Gs. ' + Math.round((Number(v) || 0) / 1e6).toLocaleString('es-PY') + ' M';
}

export function fmtMiles(v) {
  return Math.round(Number(v) || 0).toLocaleString('es-PY');
}

export function fmtPct(v) {
  return ((Number(v) || 0) * 100).toFixed(1).replace('.', ',') + '%';
}

export function fmtFecha(corte) {
  const c = parseCorte(corte);
  if (!c) return '';
  return `${String(c.d).padStart(2, '0')}/${String(c.m).padStart(2, '0')}/${c.y}`;
}

export function fmtDiaMes(corte) {
  return fmtFecha(corte).slice(0, 5);
}

export function fmtFechaHora(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export function nombreMes(corte) {
  const c = parseCorte(corte);
  return c ? `${MESES[c.m - 1]} ${c.y}` : '';
}

export function hoyAsuncion() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function fmtCI(ci) {
  return String(ci || '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
