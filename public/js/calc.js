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

export function calcUnidad(real, objetivo, corte, calendario) {
  real = Number(real) || 0;
  objetivo = Number(objetivo) || 0;
  const { operados, mes } = diasOperativos(corte, calendario);
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
// El ritmo ideal y los días usan calendario lunes a domingo.
function agregado(partes, corte) {
  const real = partes.reduce((s, p) => s + p.real, 0);
  const objetivo = partes.reduce((s, p) => s + p.objetivo, 0);
  const proyeccion = partes.reduce((s, p) => s + p.proyeccion, 0);
  const { operados, mes } = diasOperativos(corte, 'lun-dom');
  return {
    real,
    objetivo,
    proyeccion,
    diasOperados: operados,
    diasMes: mes,
    avance: objetivo > 0 ? real / objetivo : 0,
    proyeccionPct: objetivo > 0 ? proyeccion / objetivo : 0,
    ritmoIdeal: mes > 0 ? operados / mes : 0,
    faltante: Math.max(objetivo - real, 0),
  };
}

// Cálculo completo a partir de { corte, obj, real }.
export function calcularReporte(data) {
  const corte = data.corte;
  const unidades = {};
  for (const u of UNIDADES) {
    unidades[u.id] = { ...u, ...calcUnidad(data.real?.[u.id], data.obj?.[u.id], corte, u.calendario) };
  }
  const baratote = agregado([unidades.may, unidades.min], corte);
  const total = agregado(Object.values(unidades), corte);
  return { corte, unidades, baratote, total };
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
