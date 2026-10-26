// Pronóstico diario para el área central (Asunción) desde MET Norway (api.met.no),
// gratuito también para uso comercial. Pide un User-Agent que identifique la app.
const LAT = -25.30;
const LON = -57.60;
const URL = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LAT}&lon=${LON}`;
const USER_AGENT = 'portal-avance-ventas/1.0 github.com/proyectofineza/Avances-mensuales';

const fechaHora = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function local(iso) {
  const p = Object.fromEntries(fechaHora.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) };
}

// Agrupa los pasos horarios / de 6 h en días locales: máxima, mínima, lluvia total y
// el símbolo del mediodía. La lluvia de cada tramo se cuenta una sola vez.
export function resumirPronostico(timeseries) {
  const dias = new Map();
  let cubiertoHasta = 0;
  for (const paso of timeseries) {
    const t = Date.parse(paso.time);
    const { fecha, hora } = local(paso.time);
    const d = dias.get(fecha) || { fecha, tmax: -Infinity, tmin: Infinity, lluvia: 0, simbolo: null, horaSimbolo: 99 };
    const temp = paso.data?.instant?.details?.air_temperature;
    if (typeof temp === 'number') {
      d.tmax = Math.max(d.tmax, temp);
      d.tmin = Math.min(d.tmin, temp);
    }
    if (t >= cubiertoHasta) {
      const tramo = paso.data?.next_1_hours ? [paso.data.next_1_hours, 1] : paso.data?.next_6_hours ? [paso.data.next_6_hours, 6] : null;
      if (tramo) {
        d.lluvia += Number(tramo[0].details?.precipitation_amount) || 0;
        cubiertoHasta = t + tramo[1] * 3600e3;
      }
    }
    const simbolo = (paso.data?.next_6_hours || paso.data?.next_1_hours)?.summary?.symbol_code;
    if (simbolo && Math.abs(hora - 12) < Math.abs(d.horaSimbolo - 12)) {
      d.simbolo = simbolo;
      d.horaSimbolo = hora;
    }
    dias.set(fecha, d);
  }
  return [...dias.values()]
    .filter((d) => Number.isFinite(d.tmax))
    .map(({ fecha, tmax, tmin, lluvia, simbolo }) => ({
      fecha,
      tmax: Math.round(tmax * 10) / 10,
      tmin: Math.round(tmin * 10) / 10,
      lluvia: Math.round(lluvia * 10) / 10,
      simbolo,
    }));
}

// ---- Historial propio ----
// No hay una fuente gratuita (también para uso comercial) de clima ya ocurrido en Paraguay,
// así que el portal guarda, para cada fecha, el último pronóstico hecho ANTES de que
// empiece ese día (menos de 24 h de anticipación). Blob "clima-historial":
//   { dias: { 'AAAA-MM-DD': { tmax, tmin, lluvia, simbolo, hechoEn } } }
const DIAS_GUARDADOS = 400;

export function hoyLocal(ahora = new Date()) {
  return local(ahora.toISOString()).fecha;
}

// Mezcla el pronóstico nuevo en el historial: las fechas futuras se actualizan; las de hoy
// y las pasadas quedan fijas (si no estaban, se toma lo que haya, marcado como parcial).
export function mezclarHistorial(historial, dias, ahora = new Date()) {
  const hoy = hoyLocal(ahora);
  const out = { ...(historial || {}) };
  for (const d of dias) {
    const nuevo = { tmax: d.tmax, tmin: d.tmin, lluvia: d.lluvia, simbolo: d.simbolo, hechoEn: ahora.toISOString() };
    if (d.fecha > hoy) out[d.fecha] = nuevo;
    else if (!out[d.fecha]) out[d.fecha] = { ...nuevo, parcial: true };
  }
  const fechas = Object.keys(out).sort();
  for (const f of fechas.slice(0, Math.max(fechas.length - DIAS_GUARDADOS, 0))) delete out[f];
  return out;
}

// Pide el pronóstico, lo guarda como vigente y actualiza el historial.
export async function renovarClima({ getJSON, setJSON }) {
  const dias = await obtenerPronostico();
  const clima = { actualizado: new Date().toISOString(), fuente: 'MET Norway', dias };
  await setJSON('clima', clima);
  const hist = await getJSON('clima-historial', { dias: {} });
  await setJSON('clima-historial', { dias: mezclarHistorial(hist.dias, dias) });
  return clima;
}

export async function obtenerPronostico() {
  const res = await fetch(URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`MET Norway respondió ${res.status}`);
  const json = await res.json();
  return resumirPronostico(json.properties?.timeseries || []);
}
