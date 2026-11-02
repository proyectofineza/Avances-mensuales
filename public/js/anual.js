// Comparativo anual: cuentas a partir de las ventas por mes (sin dependencias del navegador).
//   meses:   { 'AAAA-MM': { min, may, fgl, fbt } }   meses cerrados
//   enCurso: { mes: 'AAAA-MM', real: {...}, proyeccion: {...} } | null   mes en curso (lo publicado)
// Unidades de vista: total, bar (Baratote = Minorista + Mayorista), min, may, fgl, fbt.

export const VISTAS_UNIDAD = [
  { id: 'total', nombre: 'Total' },
  { id: 'bar', nombre: 'Baratote' },
  { id: 'min', nombre: 'Minorista' },
  { id: 'may', nombre: 'Mayorista' },
  { id: 'fgl', nombre: 'Fineglass' },
  { id: 'fbt', nombre: 'Fineboats' },
];
const TOPE = 0.5;

// Valor de una unidad de vista; null si el mes no tiene ningún dato de las unidades que la forman.
export function valorUnidad(v, u) {
  if (!v) return null;
  const ids = u === 'total' ? ['min', 'may', 'fgl', 'fbt'] : u === 'bar' ? ['min', 'may'] : [u];
  const con = ids.filter((id) => v[id] !== undefined && v[id] !== null);
  return con.length ? con.reduce((s, id) => s + Number(v[id]), 0) : null;
}

const clave = (anio, m) => `${anio}-${String(m).padStart(2, '0')}`;
const suma = (arr, hasta) => arr.slice(0, hasta).reduce((s, v) => s + (v || 0), 0);
const variacion = (a, b) => (a !== null && b > 0 ? a / b - 1 : null);

export function resumenAnual(meses, enCurso, u = 'total') {
  const cerrados = Object.keys(meses).sort();
  const ultimo = cerrados.at(-1) || null;
  const anio = Number((enCurso?.mes || ultimo || '').slice(0, 4)) || null;
  if (!anio) return null;
  const serie = (a) => Array.from({ length: 12 }, (_, i) => valorUnidad(meses[clave(a, i + 1)], u));
  const series = { [anio]: serie(anio), [anio - 1]: serie(anio - 1), [anio - 2]: serie(anio - 2) };
  const y = series[anio], y1 = series[anio - 1], y2 = series[anio - 2];

  // n = último mes cerrado del año (1–12); 0 si el año todavía no tiene meses cerrados.
  let n = 0;
  for (let i = 11; i >= 0; i--) if (y[i] !== null) { n = i + 1; break; }

  // Acumulado del año (enero a n) contra los mismos meses de los años anteriores.
  const comparables = (s) => (n && s.slice(0, n).every((v) => v !== null) ? suma(s, n) : null);
  const ytd = { y: n ? suma(y, n) : 0, y1: comparables(y1), y2: comparables(y2) };

  // Brecha acumulada contra el año anterior y cuántos meses seguidos viene creciendo o achicándose.
  let racha = null;
  if (ytd.y1 !== null && n >= 2) {
    const brecha = (k) => suma(y, k) - suma(y1, k);
    const sube = brecha(n) > brecha(n - 1);
    let meses_ = 1;
    for (let k = n - 1; k >= 2; k--) {
      if ((brecha(k) > brecha(k - 1)) === sube) meses_++;
      else break;
    }
    racha = { sube, meses: meses_ };
  }

  const variaciones = y.map((v, i) => variacion(v, y1[i]));
  const ultimoMes = n ? {
    mes: n,
    valor: y[n - 1],
    vsAnterior: variacion(y[n - 1], n >= 2 ? y[n - 2] : y1[11]),
    vsAnioAnterior: variaciones[n - 1],
  } : null;

  // Mejor mes del año y la mayor caída contra el año anterior.
  let mejor = null, peor = null;
  y.forEach((v, i) => {
    if (v !== null && (!mejor || v > mejor.valor)) mejor = { mes: i + 1, valor: v };
    const x = variaciones[i];
    if (x !== null && x < 0 && (!peor || x < peor.variacion)) peor = { mes: i + 1, variacion: x };
  });

  // Proyección del año: lo cerrado + el mes en curso (lo publicado) + el resto como el año anterior
  // movido por la tendencia de los últimos meses cerrados (hasta 3, limitada a ±50%).
  let proyeccion = null;
  if (n < 12 && y1.slice(n).every((v) => v !== null)) {
    const pares = [];
    for (let i = n - 1; i >= Math.max(0, n - 3); i--) if (y[i] !== null && y1[i] > 0) pares.push(i);
    const t = pares.length ? pares.reduce((s, i) => s + y[i], 0) / pares.reduce((s, i) => s + y1[i], 0) - 1 : 0;
    const factor = 1 + Math.min(Math.max(t, -TOPE), TOPE);
    const serieP = Array(12).fill(null);
    const curso = enCurso?.mes === clave(anio, n + 1) ? valorUnidad(enCurso.proyeccion, u) : null;
    for (let i = n; i < 12; i++) serieP[i] = i === n && curso !== null ? curso : y1[i] * factor;
    const total = suma(y, n) + serieP.reduce((s, v) => s + (v || 0), 0);
    proyeccion = { serie: serieP, total, tendencia: t, enCurso: curso !== null, vsAnioAnterior: variacion(total, suma(y1, 12)) };
  }

  return { anio, n, series, ytd, varYtd1: variacion(ytd.y, ytd.y1), varYtd2: variacion(ytd.y, ytd.y2), ventaja: ytd.y1 !== null ? ytd.y - ytd.y1 : null, racha, variaciones, ultimoMes, mejor, peor, proyeccion };
}

// Variación de cada unidad contra el año anterior, mes por mes (tabla de calor), más el acumulado.
export function tablaVariaciones(meses, anio, hasta) {
  return VISTAS_UNIDAD.map((u) => {
    const celdas = Array.from({ length: 12 }, (_, i) => {
      const a = valorUnidad(meses[clave(anio, i + 1)], u.id);
      const b = valorUnidad(meses[clave(anio - 1, i + 1)], u.id);
      return { valor: a, anterior: b, variacion: variacion(a, b) };
    });
    const conAmbos = celdas.slice(0, hasta).filter((c) => c.valor !== null && c.anterior !== null);
    const acumulado = conAmbos.length ? variacion(conAmbos.reduce((s, c) => s + c.valor, 0), conAmbos.reduce((s, c) => s + c.anterior, 0)) : null;
    return { ...u, celdas, acumulado };
  });
}
