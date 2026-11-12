// Reglas de cálculo (sección 5 de la especificación).
// Módulo ES sin dependencias: lo usan el navegador y las Netlify Functions.

export const UNIDADES = [
  { id: 'may', nombre: 'Mayorista', grupo: 'Baratote', calendario: 'lun-dom' },
  // Minorista: la venta se concentra en el fin de semana, se proyecta ponderando cada día.
  { id: 'min', nombre: 'Minorista', grupo: 'Baratote', calendario: 'lun-dom', ponderado: true },
  { id: 'fgl', nombre: 'Fineglass', grupo: null, calendario: 'lun-vie' },
  // Fineboats: ventas impredecibles, la proyección lineal se muestra como referencial.
  { id: 'fbt', nombre: 'Fineboats', grupo: null, calendario: 'lun-dom', referencial: true },
];

export const IDS = UNIDADES.map((u) => u.id);

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
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

// Peso de cada día de la semana en la venta de Minorista (%). Valores iniciales
// del análisis de ventas por sucursal de octubre 2026 (sin CENTRAL).
export const DIAS_SEMANA = [
  { k: 'lun', nombre: 'Lunes', wd: 1 },
  { k: 'mar', nombre: 'Martes', wd: 2 },
  { k: 'mie', nombre: 'Miércoles', wd: 3 },
  { k: 'jue', nombre: 'Jueves', wd: 4 },
  { k: 'vie', nombre: 'Viernes', wd: 5 },
  { k: 'sab', nombre: 'Sábado', wd: 6 },
  { k: 'dom', nombre: 'Domingo', wd: 0 },
];
export const PESOS_MINORISTA = { lun: 1.4, mar: 9.3, mie: 9.8, jue: 8.8, vie: 18.8, sab: 27.7, dom: 24.2 };

const fechaIso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Fechas especiales (feriados, aguinaldo, fiestas): [{ fecha, factor, nota }]. El factor multiplica
// lo que se espera vender ese día (1,8 = 80% más que un día normal igual; 0,3 = casi nada).
export const MAX_FACTOR = 5;
export function mapaEspeciales(especiales) {
  const out = new Map();
  for (const e of especiales || []) {
    const f = Number(e?.factor);
    if (parseCorte(e?.fecha) && Number.isFinite(f) && f >= 0) out.set(e.fecha, f);
  }
  return out;
}
// ¿El mes del corte tiene alguna fecha especial?
export function hayEspeciales(corte, especiales) {
  const mes = (corte || '').slice(0, 7);
  return Boolean(mes) && [...mapaEspeciales(especiales).keys()].some((f) => f.startsWith(mes));
}

// Peso de cada día del mes para una unidad: 0 si no opera; Minorista (ponderada) según el día de la
// semana y el resto 1; todo multiplicado por el factor de la fecha especial, si la hay.
function pesador(u, pesos = PESOS_MINORISTA, especiales = []) {
  const porWd = Object.fromEntries(DIAS_SEMANA.map((d) => [d.wd, Number(pesos?.[d.k]) || 0]));
  const esp = mapaEspeciales(especiales);
  return (y, m, d) => {
    if (!esOperativo(y, m, d, u.calendario)) return 0;
    const base = u.ponderado ? porWd[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] : 1;
    return base * (esp.get(fechaIso(y, m, d)) ?? 1);
  };
}

// Parte del mes que ya pasó (0–1) según el peso de cada día, o null si no hay corte o todo pesa 0.
function fraccionCon(corte, peso) {
  const c = parseCorte(corte);
  if (!c) return null;
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  let hecho = 0, total = 0;
  for (let d = 1; d <= ultimo; d++) {
    const w = peso(c.y, c.m, d);
    total += w;
    if (d <= c.d) hecho += w;
  }
  return total > 0 ? hecho / total : null;
}

// Parte del mes ya transcurrida según los pesos de Minorista (0–1), o null si no hay corte.
export function fraccionPonderada(corte, pesos = PESOS_MINORISTA, especiales = []) {
  return fraccionCon(corte, pesador({ calendario: 'lun-dom', ponderado: true }, pesos, especiales));
}

// Ajuste por lluvia de Minorista (referencial). Del análisis de octubre 2026 (sucursales
// sin CENTRAL, comparando cada día con el promedio de su día de la semana): los días con
// lluvia ≥ 5 mm vendieron 0,89 de lo normal y los días secos 1,08.
export const AJUSTE_LLUVIA = { umbralMm: 5, factorLluvia: 0.89, factorSeco: 1.08 };

// Proyección de Minorista con el pronóstico de lluvia para los días que faltan.
// pronostico: [{ fecha: 'YYYY-MM-DD', lluvia }]. Los días sin pronóstico quedan como
// en la ponderada. Devuelve null en modo manual o si todavía no hay venta ponderable.
export function proyeccionLluvia(data, pronostico = [], ajuste = AJUSTE_LLUVIA) {
  const c = parseCorte(data.corte);
  if (!c || data.dias?.modo === 'manual') return null;
  const pesos = data.pesos || PESOS_MINORISTA;
  const porWd = Object.fromEntries(DIAS_SEMANA.map((d) => [d.wd, Number(pesos[d.k]) || 0]));
  const porFecha = new Map(pronostico.map((p) => [p.fecha, p]));
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  const esp = mapaEspeciales(data.especiales);
  const peso = (d) => porWd[new Date(Date.UTC(c.y, c.m - 1, d)).getUTCDay()] * (esp.get(fechaIso(c.y, c.m, d)) ?? 1);

  let hecho = 0;
  for (let d = 1; d <= c.d; d++) hecho += peso(d);
  if (hecho <= 0) return null;
  const real = Number(data.real?.min) || 0;
  const ritmo = real / hecho; // venta por punto de peso

  let resto = 0, restoBase = 0, conPronostico = 0, conLluvia = 0;
  for (let d = c.d + 1; d <= ultimo; d++) {
    const fecha = `${c.y}-${String(c.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const p = porFecha.get(fecha);
    let f = 1;
    if (p) {
      conPronostico++;
      const llueve = p.lluvia >= ajuste.umbralMm;
      if (llueve) conLluvia++;
      f = llueve ? ajuste.factorLluvia : ajuste.factorSeco;
    }
    resto += peso(d) * ritmo * f;
    restoBase += peso(d) * ritmo;
  }
  const proyeccion = real + resto;
  const base = real + restoBase;
  const objetivo = Number(data.obj?.min) || 0;
  return {
    proyeccion,
    proyeccionPct: objetivo > 0 ? proyeccion / objetivo : 0,
    base,
    variacion: base > 0 ? proyeccion / base - 1 : 0,
    diasRestantes: ultimo - c.d,
    conPronostico,
    conLluvia,
  };
}

// Días que usa la proyección de una unidad: los del calendario (automático)
// o los que cargó el administrador (manual). En automático, una unidad ponderada
// agrega la fracción del mes transcurrida según el peso de cada día.
export function diasUnidad(data, u) {
  if (data.dias?.modo === 'manual') {
    const m = data.dias[u.id] || {};
    const mes = Math.max(Number(m.mes) || 0, 0);
    if (mes > 0) return { operados: Math.min(Math.max(Number(m.curso) || 0, 0), mes), mes };
  }
  const dias = diasOperativos(data.corte, u.calendario);
  // Minorista siempre se pondera; las demás, solo si el mes tiene fechas especiales.
  if (u.ponderado || hayEspeciales(data.corte, data.especiales)) {
    dias.fraccion = fraccionCon(data.corte, pesador(u, data.pesos || PESOS_MINORISTA, data.especiales));
  }
  return dias;
}

// dias = { operados, mes, fraccion? }; con fraccion la proyección es real / fraccion.
export function calcUnidad(real, objetivo, dias) {
  real = Number(real) || 0;
  objetivo = Number(objetivo) || 0;
  const { operados, mes } = dias;
  const ponderada = dias.fraccion !== undefined && dias.fraccion !== null;
  let proyeccion;
  if (ponderada) proyeccion = dias.fraccion > 0 ? real / dias.fraccion : real;
  else proyeccion = operados > 0 ? (real / operados) * mes : real;
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
    ritmoIdeal: ponderada ? dias.fraccion : mes > 0 ? operados / mes : 0,
    ponderada,
    faltante,
    diasRestantes,
    necesarioDia: diasRestantes > 0 ? faltante / diasRestantes : 0,
    promedioDia: operados > 0 ? real / operados : 0,
    promedioIdeal: mes > 0 ? objetivo / mes : 0, // lo que había que vender por día para llegar justo
  };
}

// Plan de lo que queda del mes: cuánto vender cada día para llegar al objetivo.
// El faltante de cada unidad se reparte entre los días que quedan según su peso (ver `pesador`):
// Minorista con el peso de cada día de la semana; el resto en partes iguales entre sus días
// operativos (Fineglass solo lunes a viernes); las fechas especiales multiplican el peso del día.
// Opciones:
//   meta:       1 = el objetivo; 0,95 o 1,05 para una meta más baja o más alta.
//   pronostico: [{ fecha, lluvia }] para Minorista: los días con lluvia pesan AJUSTE_LLUVIA.factorLluvia
//               y los secos factorSeco (los días sin pronóstico, como siempre).
// Baratote y Total suman sus unidades día por día. Devuelve null en modo manual (sin fechas).
// { fechas, meta, unidades: { id: { real, objetivo, faltante, dias: [{ fecha, wd, monto, acumulado, lluvia? }] } },
//   baratote, total }
export function planRestante(data, { meta = 1, pronostico = null, ajuste = AJUSTE_LLUVIA } = {}) {
  const c = parseCorte(data.corte);
  if (!c || data.dias?.modo === 'manual') return null;
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  const clima = new Map((pronostico || []).map((p) => [p.fecha, p]));
  const fechas = [];
  for (let d = c.d + 1; d <= ultimo; d++) {
    fechas.push({ fecha: fechaIso(c.y, c.m, d), d, wd: new Date(Date.UTC(c.y, c.m - 1, d)).getUTCDay() });
  }
  const armar = (real, objetivo, montoDe, extra = () => ({})) => {
    let acumulado = real;
    const dias = fechas.map((f) => {
      const monto = montoDe(f);
      acumulado += monto;
      return { fecha: f.fecha, wd: f.wd, monto, acumulado, ...extra(f) };
    });
    return { real, objetivo, faltante: Math.max(objetivo - real, 0), dias };
  };
  const llueve = (f) => {
    const p = clima.get(f.fecha);
    return p ? p.lluvia >= ajuste.umbralMm : null;
  };
  const unidades = {};
  for (const u of UNIDADES) {
    const real = Number(data.real?.[u.id]) || 0;
    const objetivo = (Number(data.obj?.[u.id]) || 0) * meta;
    const faltante = Math.max(objetivo - real, 0);
    const base = pesador(u, data.pesos || PESOS_MINORISTA, data.especiales);
    const conClima = u.ponderado && clima.size;
    const peso = (f) => {
      const w = base(c.y, c.m, f.d);
      const l = conClima ? llueve(f) : null;
      return l === null ? w : w * (l ? ajuste.factorLluvia : ajuste.factorSeco);
    };
    let suma = fechas.reduce((s, f) => s + peso(f), 0);
    // Si los días que quedan pesan 0, se reparte en partes iguales entre los operativos.
    const pesoFinal = suma > 0 ? peso : (f) => (esOperativo(c.y, c.m, f.d, u.calendario) ? 1 : 0);
    if (suma <= 0) suma = fechas.reduce((s, f) => s + pesoFinal(f), 0);
    unidades[u.id] = armar(real, objetivo, (f) => (suma > 0 ? faltante * pesoFinal(f) / suma : 0),
      (f) => (conClima && llueve(f) !== null ? { lluvia: llueve(f) } : {}));
  }
  const sumar = (ids) => {
    const partes = ids.map((id) => unidades[id]);
    const real = partes.reduce((s, p) => s + p.real, 0);
    const objetivo = partes.reduce((s, p) => s + p.objetivo, 0);
    const i = new Map(fechas.map((f, k) => [f.fecha, k]));
    const plan = armar(real, objetivo, (f) => partes.reduce((s, p) => s + p.dias[i.get(f.fecha)].monto, 0),
      (f) => { const l = partes.map((p) => p.dias[i.get(f.fecha)].lluvia).find((x) => x !== undefined); return l === undefined ? {} : { lluvia: l }; });
    plan.faltante = partes.reduce((s, p) => s + p.faltante, 0); // lo que falta en cada unidad (lo que sobra en una no tapa a otra)
    return plan;
  };
  return { fechas: fechas.map((f) => f.fecha), meta, unidades, baratote: sumar(['may', 'min']), total: sumar(IDS) };
}

// Reparte lo que le falta a una sucursal de Minorista entre los días del mes posteriores a
// `ultimaFecha`, con el peso de cada día de la semana y las fechas especiales.
// [{ fecha, wd, monto }] (vacío si no quedan días o no falta nada).
export function repartirMinorista(ultimaFecha, faltante, pesos = PESOS_MINORISTA, especiales = []) {
  const c = parseCorte(ultimaFecha);
  if (!c || !(faltante > 0)) return [];
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  const peso = pesador({ calendario: 'lun-dom', ponderado: true }, pesos, especiales);
  const dias = [];
  for (let d = c.d + 1; d <= ultimo; d++) dias.push({ fecha: fechaIso(c.y, c.m, d), wd: new Date(Date.UTC(c.y, c.m - 1, d)).getUTCDay(), w: peso(c.y, c.m, d) });
  let suma = dias.reduce((s, x) => s + x.w, 0);
  if (suma <= 0) { dias.forEach((x) => { x.w = 1; }); suma = dias.length; }
  return dias.map(({ fecha, wd, w }) => ({ fecha, wd, monto: suma > 0 ? faltante * w / suma : 0 }));
}

// Plan contra lo vendido, publicación por publicación del mes (history ordenado por corte).
// Para cada par de publicaciones seguidas: lo que pedía el plan de la anterior para los días
// hasta el corte nuevo, y lo que se vendió (diferencia de acumulados). El plan es sin clima y
// con meta 100%, para que no cambie según cuándo se mire.
// [{ desde, hasta, dias, unidades: { id: { plan, vendido } }, baratote, total }], del más viejo al más nuevo.
export function cumplimientoPlan(history = []) {
  const out = [];
  const lista = [...history].filter((h) => parseCorte(h.corte)).sort((a, b) => a.corte.localeCompare(b.corte));
  for (let k = 1; k < lista.length; k++) {
    const prev = lista[k - 1], cur = lista[k];
    if (prev.corte.slice(0, 7) !== cur.corte.slice(0, 7) || prev.dias?.modo === 'manual') continue;
    const plan = planRestante(prev);
    if (!plan) continue;
    const enRango = (d) => d.fecha <= cur.corte;
    const unidades = {};
    for (const id of IDS) {
      unidades[id] = {
        plan: plan.unidades[id].dias.filter(enRango).reduce((s, d) => s + d.monto, 0),
        vendido: (Number(cur.real?.[id]) || 0) - (Number(prev.real?.[id]) || 0),
      };
    }
    const sumar = (ids) => ({ plan: ids.reduce((s, id) => s + unidades[id].plan, 0), vendido: ids.reduce((s, id) => s + unidades[id].vendido, 0) });
    out.push({
      desde: plan.fechas[0], hasta: cur.corte, dias: plan.fechas.filter((f) => f <= cur.corte).length,
      unidades, baratote: sumar(['may', 'min']), total: sumar(IDS),
    });
  }
  return out;
}

// Suma de unidades: la proyección es la suma de proyecciones de cada una.
// Automático: ritmo ideal y días con calendario lunes a domingo.
// Manual: días de la unidad con mayor objetivo y ritmo ideal ponderado por objetivo.
// Con fechas especiales en el mes, el ritmo ideal es el de cada unidad ponderado por su objetivo.
function agregado(partes, corte, manual, especiales = false) {
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
    if (especiales && objetivo > 0) ritmoIdeal = partes.reduce((s, p) => s + p.objetivo * p.ritmoIdeal, 0) / objetivo;
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
    promedioIdeal: mes > 0 ? objetivo / mes : 0,
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
  const esp = hayEspeciales(corte, data.especiales);
  const baratote = agregado([unidades.may, unidades.min], corte, manual, esp);
  comparar(baratote, suma(ant, ['may', 'min']), suma(aa, ['may', 'min']));
  const total = agregado(Object.values(unidades), corte, manual, esp);
  comparar(total, suma(ant, IDS), suma(aa, IDS));
  return { corte, manual, especiales: esp, unidades, baratote, total };
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
    pesos: normalizarPesos(src.pesos),
    especiales: normalizarEspeciales(src.especiales),
    comp: { ant: montos(src.comp?.ant), aa: montos(src.comp?.aa) },
  };
}

// Fechas especiales válidas: una por fecha, factor 0–5 con dos decimales, nota de hasta 40 letras.
export const MAX_ESPECIALES = 60;
export function normalizarEspeciales(src) {
  const porFecha = new Map();
  for (const e of Array.isArray(src) ? src : []) {
    const f = Number(String(e?.factor ?? '').replace(',', '.'));
    if (!parseCorte(e?.fecha) || !Number.isFinite(f) || f < 0) continue;
    porFecha.set(e.fecha, {
      fecha: e.fecha,
      factor: Math.round(Math.min(f, MAX_FACTOR) * 100) / 100,
      nota: String(e.nota ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
    });
  }
  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-MAX_ESPECIALES);
}

// Pesos 0–100 con un decimal; si no hay ninguno cargado, los valores iniciales.
export function normalizarPesos(src) {
  const pesos = Object.fromEntries(DIAS_SEMANA.map((d) => {
    const v = Math.round(Math.min(Math.max(Number(src?.[d.k]) || 0, 0), 100) * 10) / 10;
    return [d.k, v];
  }));
  return Object.values(pesos).some((v) => v > 0) ? pesos : { ...PESOS_MINORISTA };
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

// Último día del mes de una fecha (YYYY-MM-DD), y si la fecha es ese día.
export function ultimoDiaDelMes(fecha) {
  const c = parseCorte(fecha);
  return c ? `${fecha.slice(0, 8)}${String(new Date(Date.UTC(c.y, c.m, 0)).getUTCDate()).padStart(2, '0')}` : null;
}
export const esUltimoDiaDelMes = (fecha) => Boolean(fecha) && ultimoDiaDelMes(fecha) === fecha;

export function hoyAsuncion() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function fmtCI(ci) {
  return String(ci || '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
