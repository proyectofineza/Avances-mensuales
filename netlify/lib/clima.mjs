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

export async function obtenerPronostico() {
  const res = await fetch(URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`MET Norway respondió ${res.status}`);
  const json = await res.json();
  return resumirPronostico(json.properties?.timeseries || []);
}
