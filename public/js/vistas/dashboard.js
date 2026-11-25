// Vista "Dashboard": avance del mes por unidad, proyección, clima, plan día a día.
import * as API from '../api.js';
import { UNIDADES, IDS, DIAS_SEMANA, PESOS_MINORISTA, AJUSTE_LLUVIA, parseCorte, calcularReporte, planRestante, cumplimientoPlan, estado, proyeccionLluvia, mesAnterior, mismoMesAnioAnterior, fmtMillones, fmtMiles, fmtPct, fmtVar, fmtFecha, fmtDiaMes, fmtFechaHora, nombreMes } from '../calc.js';
import { resumirMes, alertasSucursales } from '../sucursales.js';
import { avisoCierreHtml } from './cierre.js';
import { $, CAL_LARGO, COLOR, DIA_CORTO, bar, barW, chipEstado, contarNumeros, esFinde, esc, fmtM1, gauge, handleError, icono, isAdmin, leerPref, state, varHtml, wdDe } from './comun.js';

// ---------- Dashboard ----------

export let dashKey = null;
export let climaPedido = 0;

// El pronóstico se pide como mucho cada 30 min (el servidor lo guarda 3 h).
export async function cargarClima() {
  if (state.clima && Date.now() - climaPedido < 30 * 60e3) return false;
  climaPedido = Date.now();
  try {
    state.clima = await API.getClima();
  } catch {
    state.clima = { error: true, dias: [] };
  }
  return true;
}

// Alertas de sucursales para la vista rápida (último mes cargado), como mucho cada 10 min.
export let sucAlertasPedido = 0;
export async function cargarAlertasSucursales() {
  if (state.sucAlertas !== undefined && Date.now() - sucAlertasPedido < 10 * 60e3) return false;
  sucAlertasPedido = Date.now();
  try {
    const d = await API.getSucursales();
    const cfg = d.mes ? await API.getSucursalesConfig(d.mes).catch(() => ({})) : {};
    const cerradas = (cfg.cerradas || []).map((c) => c.sucursal);
    state.sucAlertas = d.filas?.length ? { mes: d.mes, ...alertasSucursales(resumirMes(d.filas), { cerradas }) } : null;
  } catch {
    state.sucAlertas = null;
  }
  return true;
}

export async function refreshDashboard(force = false) {
  try {
    const [dash, climaNuevo, alertasNuevas] = await Promise.all([API.getDashboard(), cargarClima(), cargarAlertasSucursales()]);
    if (climaNuevo || alertasNuevas) force = true;
    state.published = dash.published;
    state.history = dash.history;
    const key = dash.published ? dash.published.publicadoEn : 'none';
    if (force || key !== dashKey) {
      dashKey = key;
      renderDashboard();
    }
  } catch (err) {
    handleError(err);
  }
}

// Etiqueta para unidades cuya proyección lineal es solo orientativa (Fineboats).
export const tagRef = (c) => (c.referencial ? ' <span class="tag-ref" title="Sus ventas no siguen un ritmo diario: tomá la proyección como orientativa.">Referencial</span>' : '');

// ---- 2. Mini gráfico: avance de la unidad en las últimas publicaciones del mes ----
export function sparklineHtml(serie, color) {
  if (serie.length < 2) return '';
  const W = 132, H = 34, P = 3;
  const max = Math.max(...serie.map((s) => s.v), 0.01);
  const x = (i) => P + (i / (serie.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const d = serie.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(serie.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const ult = serie.at(-1);
  const titulo = serie.map((s) => `${fmtDiaMes(s.corte)}: ${fmtPct(s.v)}`).join(' · ');
  return `
    <div class="spark" title="Avance en cada publicación: ${titulo}">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <path d="${area}" style="fill:color-mix(in srgb, ${color} 16%, transparent)"/>
        <path d="${d}" class="spark-linea" style="stroke:${color}" pathLength="1"/>
        <circle cx="${x(serie.length - 1).toFixed(1)}" cy="${y(ult.v).toFixed(1)}" r="3" style="fill:${color}"/>
      </svg>
      <span>${serie.length} publicaciones · desde ${fmtDiaMes(serie[0].corte)}</span>
    </div>`;
}

export function unidadCard(titulo, calendario, c, color, manual, extra = '', serie = []) {
  const dias = manual ? 'Días cargados a mano' : `Opera ${CAL_LARGO[calendario]}`;
  return `
    <div class="card u-card" style="border-top:4px solid ${color.fuerte}">
      <div class="u-head">
        <div>
          <h3>${esc(titulo)}${tagRef(c)}</h3>
          <p>${dias} · día ${c.diasOperados} de ${c.diasMes}</p>
        </div>
        ${chipEstado(c.proyeccionPct)}
      </div>
      <div class="u-big"><strong style="color:${color.fuerte}" data-contar>${fmtPct(c.avance)}</strong><span>de avance · proyecta ${fmtPct(c.proyeccionPct)}${c.referencial ? ' (referencial)' : ''}</span></div>
      ${bar(c.avance, c.proyeccionPct, color)}
      ${sparklineHtml(serie, color.fuerte)}
      <div class="u-stats">
        <div><span>Real</span><strong>${fmtMillones(c.real)}</strong></div>
        <div><span>Proyección${c.referencial ? ' (ref.)' : ''}</span><strong>${fmtMillones(c.proyeccion)}</strong></div>
        <div><span>Objetivo</span><strong>${fmtMillones(c.objetivo)}</strong></div>
      </div>
      ${extra}
    </div>`;
}

export function canal(c) {
  return `
    <div>
      <div class="canal-head">
        <strong><i class="dot" style="background:${COLOR[c.id].fuerte}"></i>${esc(c.nombre)}${c.ponderada ? ' <span class="tag-ref" title="Proyección ponderada por el peso de cada día de la semana.">Ponderada</span>' : ''}</strong>
        <span>${fmtPct(c.avance)} · proy. ${fmtPct(c.proyeccionPct)} · ${fmtMillones(c.real)} de ${fmtMillones(c.objetivo)}</span>
      </div>
      ${bar(c.avance, c.proyeccionPct, COLOR[c.id], true)}
    </div>`;
}

// Columnas apiladas por unidad: cada tramo es su venta sobre el objetivo total.
// 100% del objetivo = 82% del alto.
export function evolucionHtml() {
  const evol = state.history.slice(-8).map((h) => ({ corte: h.corte, r: calcularReporte(h) }));
  const cols = evol.map(({ r }, i) => {
    const t = r.total;
    const h = Math.min(t.avance * 82, 100);
    const ideal = Math.min(t.ritmoIdeal * 82, 100);
    const tramos = IDS.map((id) => {
      const part = t.real > 0 ? (r.unidades[id].real / t.real) * 100 : 0;
      return `<div style="height:${part.toFixed(2)}%;background:${COLOR[id].fuerte}" title="${r.unidades[id].nombre} ${fmtMillones(r.unidades[id].real)}"></div>`;
    }).join('');
    return `
    <div class="col${i === evol.length - 1 ? ' last' : ''}">
      <div class="col-stack" style="height:${h.toFixed(2)}%">${tramos}</div>
      <div class="col-ideal" style="bottom:${ideal.toFixed(2)}%" title="Ritmo ideal ${fmtPct(t.ritmoIdeal)}"></div>
      <span class="col-pct" style="bottom:calc(${Math.max(h, ideal).toFixed(2)}% + 4px)">${fmtPct(t.avance)}</span>
    </div>`;
  }).join('');
  const labels = evol.map((e) => `<span>${fmtDiaMes(e.corte)}</span>`).join('');
  const leyenda = UNIDADES.map((u) => `<span><i class="sw" style="background:${COLOR[u.id].fuerte}"></i>${esc(u.nombre)}</span>`).join('');
  return `
    <div class="card">
      <h2>Evolución del avance total</h2>
      <p class="muted small" style="margin:4px 0 0">Una columna por publicación del mes, apilada por unidad.</p>
      <div class="chart">
        <div class="chart-cols" style="padding-top:22px">${cols}</div>
        <div class="chart-labels">${labels}</div>
      </div>
      <div class="leyenda" style="margin:12px 0 0">${leyenda}<span><i class="sw ideal"></i>Ritmo ideal</span></div>
    </div>`;
}

// Torta (dona) con la composición de la venta acumulada por canal.
export function composicionHtml(r) {
  const t = r.total;
  let acc = 0;
  const stops = UNIDADES.map((u) => {
    const desde = acc;
    acc += t.real > 0 ? (r.unidades[u.id].real / t.real) * 100 : 0;
    return `${COLOR[u.id].fuerte} ${desde.toFixed(2)}% ${acc.toFixed(2)}%`;
  }).join(', ');
  const fondo = t.real > 0 ? `conic-gradient(${stops})` : 'var(--track)';
  const part = (v) => (t.real > 0 ? fmtPct(v / t.real) : '—');
  // color puede ser una lista (Baratote muestra los colores de sus dos canales).
  const item = (nombre, v, color, sub = false) => `
    <li class="${sub ? 'sub' : ''}">
      <span>${[].concat(color).map((c, i, all) => `<i class="sw${all.length > 1 && i === 0 ? ' pair' : ''}" style="background:${c}"></i>`).join('')}${esc(nombre)}</span>
      <span>${fmtMillones(v)}</span>
      <strong>${part(v)}</strong>
    </li>`;
  return `
    <div class="card">
      <h2>Composición de la venta</h2>
      <p class="muted small" style="margin:4px 0 0">Venta acumulada al corte por unidad y canal.</p>
      <div class="donut-wrap">
        <div class="donut-box">
          <div class="donut" style="background:${fondo}"></div>
          <div class="donut-hole"><strong data-contar>${fmtMillones(t.real)}</strong><span>venta total</span></div>
        </div>
        <ul class="donut-legend">
          ${item('Baratote', r.baratote.real, [COLOR.may.fuerte, COLOR.min.fuerte])}
          ${item('Mayorista', r.unidades.may.real, COLOR.may.fuerte, true)}
          ${item('Minorista', r.unidades.min.real, COLOR.min.fuerte, true)}
          ${item('Fineglass', r.unidades.fgl.real, COLOR.fgl.fuerte)}
          ${item('Fineboats', r.unidades.fbt.real, COLOR.fbt.fuerte)}
        </ul>
      </div>
    </div>`;
}

// Proyección actual vs mes anterior y mismo mes del año anterior.
export function comparativaHtml(r, corte) {
  const t = r.total;
  const lblAnt = mesAnterior(corte);
  const lblAa = mismoMesAnioAnterior(corte);
  if (!(t.ant > 0) && !(t.aa > 0)) {
    return `
      <div class="card">
        <h2>Comparativa</h2>
        <p class="muted" style="margin:12px 0 0">Todavía no se cargaron ventas de ${esc(lblAnt)} ni de ${esc(lblAa)} para comparar.</p>
      </div>`;
  }
  const filasCmp = [
    { nombre: 'Baratote', c: r.baratote, color: COLOR.bar, clase: '' },
    { nombre: 'Mayorista', c: r.unidades.may, color: COLOR.may, clase: 'sub' },
    { nombre: 'Minorista', c: r.unidades.min, color: COLOR.min, clase: 'sub' },
    { nombre: 'Fineglass', c: r.unidades.fgl, color: COLOR.fgl, clase: '' },
    { nombre: 'Fineboats', c: r.unidades.fbt, color: COLOR.fbt, clase: '' },
    { nombre: 'Total', c: t, color: COLOR.total, clase: 'total' },
  ];
  const fila = ({ nombre, c, color, clase }) => {
    const max = Math.max(c.proyeccion, c.ant, c.aa, 1);
    const b = (lbl, v, bg) => `
      <div class="cmp-bar">
        <span class="lbl">${lbl}</span>
        <div class="track"><div style="width:${((v / max) * 100).toFixed(2)}%;background:${bg}"></div></div>
        <span class="val">${v > 0 ? fmtMillones(v) : '—'}</span>
      </div>`;
    return `
      <div class="cmp-row ${clase}">
        <div class="cmp-head">
          <strong><i class="dot" style="background:${color.fuerte}"></i>${esc(nombre)}${tagRef(c)}</strong>
          <span>vs mes ant. ${varHtml(c.varAnt)} · vs año ant. ${varHtml(c.varAa)}</span>
        </div>
        ${b('Proyección', c.proyeccion, color.fuerte)}
        ${b('Mes ant.', c.ant, 'var(--cmp-ant)')}
        ${b('Año ant.', c.aa, 'var(--cmp-aa)')}
      </div>`;
  };
  return `
    <div class="card">
      <h2>Comparativa de la proyección</h2>
      <p class="muted small" style="margin:4px 0 0">Proyección al cierre de ${esc(nombreMes(corte))} vs ${esc(lblAnt)} (mes anterior) y ${esc(lblAa)} (año anterior).</p>
      <div class="cmp-kpis">
        <div><span>vs ${esc(lblAnt)}</span>${varHtml(t.varAnt)}</div>
        <div><span>vs ${esc(lblAa)}</span>${varHtml(t.varAa)}</div>
      </div>
      <div class="cmp-list">${filasCmp.map(fila).join('')}</div>
    </div>`;
}

// Sección destacada: proyección al cierre del mes.
export function proyeccionHtml(r, corte) {
  const t = r.total;
  const est = estado(t.proyeccionPct);
  const brecha = t.proyeccion - t.objetivo;
  const brechaTxt = brecha >= 0
    ? `Supera el objetivo por <b class="hl-ok">${fmtMillones(brecha)}</b>`
    : `Al ritmo actual faltarían <b class="hl-risk">${fmtMillones(-brecha)}</b> para el objetivo`;

  const cmp = (lbl, v, base) => `
    <div class="proy-cmp">
      <span>vs ${esc(lbl)}</span>
      ${v === null ? '<b class="var-na">Sin dato</b>' : `<b class="${v >= 0 ? 'hl-ok' : 'hl-risk'}">${fmtVar(v)}</b>`}
      <small>${base > 0 ? `Cierre ${fmtMillones(base)}` : 'Cargalo en Cargar ventas'}</small>
    </div>`;

  const unidad = (nombre, c, color, sub = false) => {
    const e = estado(c.proyeccionPct);
    return `
      <div class="proy-unit${sub ? ' sub' : ''}">
        <div class="pu-name"><i class="dot" style="background:${color}"></i>${sub ? '<small>Baratote ·</small> ' : ''}${esc(nombre)}${tagRef(c)}</div>
        <div class="pu-value">${fmtMillones(c.proyeccion)}</div>
        <div class="pu-bar"><div style="width:${barW(c.proyeccionPct).toFixed(2)}%;background:${color}"></div><i></i></div>
        <div class="pu-pct"><b class="pu-${e.clase}">${fmtPct(c.proyeccionPct)}</b> del obj. · ${fmtVar(c.varAnt)} vs mes ant.</div>
      </div>`;
  };

  return `
    <section class="proy-hero" aria-label="Proyección al cierre">
      <div class="proy-top">
        <div class="proy-main">
          <span class="proy-label">Proyección al cierre · ${esc(nombreMes(corte))}</span>
          <div class="proy-amount" data-contar>${fmtMillones(t.proyeccion)}</div>
          <div class="proy-state"><span class="chip ${est.clase}">${est.texto}</span><span>Objetivo ${fmtMillones(t.objetivo)}</span></div>
          <p class="proy-brecha">${brechaTxt}</p>
          <p class="proy-ritmo">Para llegar hacen falta <b>${fmtMillones(t.necesarioDia)}</b> por día · hoy el promedio es <b>${fmtMillones(t.promedioDia)}</b> por día</p>
        </div>
        ${gauge(t.proyeccionPct, est.clase)}
        <div class="proy-cmps">
          ${cmp(mesAnterior(corte), t.varAnt, t.ant)}
          ${cmp(mismoMesAnioAnterior(corte), t.varAa, t.aa)}
        </div>
      </div>
      <div class="proy-units">
        ${unidad('Baratote', r.baratote, COLOR.bar.fuerte)}
        ${unidad('Mayorista', r.unidades.may, COLOR.may.fuerte, true)}
        ${unidad('Minorista', r.unidades.min, COLOR.min.fuerte, true)}
        ${unidad('Fineglass', r.unidades.fgl, COLOR.fgl.fuerte)}
        ${unidad('Fineboats', r.unidades.fbt, COLOR.fbt.fuerte)}
      </div>
      <p class="proy-nota">${r.unidades.min.ponderada ? 'Minorista se proyecta según el peso de cada día de la semana (el fin de semana pesa más). ' : ''}La proyección de Fineboats es referencial: sus ventas no siguen un ritmo diario. Igual suma en la proyección total.</p>
    </section>`;
}

// Íconos simples del clima (SVG, sin emojis) según el símbolo de MET Norway.
export function iconoClima(simbolo = '') {
  const nube = '<path d="M8 19h9a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 12.2 3.5 3.5 0 0 0 8 19z" fill="#CBD5E1" stroke="#64748B" stroke-width="1.2"/>';
  const sol = '<circle cx="12" cy="12" r="4.5" fill="#FBBF24"/><g stroke="#F59E0B" stroke-width="1.6" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>';
  const gotas = '<g stroke="#2563EB" stroke-width="1.6" stroke-linecap="round"><path d="M9 21l-1 2M13 21l-1 2M17 21l-1 2"/></g>';
  const rayo = '<path d="M13 18l-3 4h3l-2 3" fill="none" stroke="#F59E0B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  let cuerpo, titulo;
  if (/thunder/.test(simbolo)) { cuerpo = nube + rayo; titulo = 'Tormenta'; }
  else if (/rain|sleet|snow|showers/.test(simbolo)) { cuerpo = nube + gotas; titulo = 'Lluvia'; }
  else if (/partlycloudy|fair/.test(simbolo)) { cuerpo = '<g transform="translate(-3 -4) scale(.85)">' + sol + '</g>' + nube; titulo = 'Parcialmente nublado'; }
  else if (/cloudy|fog/.test(simbolo)) { cuerpo = nube; titulo = 'Nublado'; }
  else { cuerpo = sol; titulo = 'Despejado'; }
  return `<svg class="clima-ico" viewBox="0 0 24 26" role="img" aria-label="${titulo}"><title>${titulo}</title>${cuerpo}</svg>`;
}

// Clima de lo que queda del mes y proyección de Minorista ajustada por lluvia (referencial).
export function climaHtml(r, p) {
  const c = parseCorte(p.corte);
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  if (c.d >= ultimo) return '';
  const clima = state.clima || { dias: [] };
  const porFecha = new Map((clima.dias || []).map((d) => [d.fecha, d]));
  const pesos = p.pesos || PESOS_MINORISTA;
  const pesoWd = Object.fromEntries(DIAS_SEMANA.map((d) => [d.wd, Number(pesos[d.k]) || 0]));
  const espMes = new Map((p.especiales || []).map((e) => [e.fecha, e.factor]));
  const fechaDe = (d) => `${c.y}-${String(c.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const pesoDia = (d) => pesoWd[new Date(Date.UTC(c.y, c.m - 1, d)).getUTCDay()] * (espMes.get(fechaDe(d)) ?? 1);
  let pesoMes = 0;
  for (let d = 1; d <= ultimo; d++) pesoMes += pesoDia(d);

  const tiles = [];
  for (let d = c.d + 1; d <= ultimo; d++) {
    const fecha = `${c.y}-${String(c.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const wd = new Date(Date.UTC(c.y, c.m - 1, d)).getUTCDay();
    const x = porFecha.get(fecha);
    const fuerte = wd === 5 || wd === 6 || wd === 0;
    const llueve = x && x.lluvia >= AJUSTE_LLUVIA.umbralMm;
    const peso = pesoMes > 0 ? pesoDia(d) / pesoMes : 0;
    tiles.push(`
      <div class="clima-dia${fuerte ? ' fuerte' : ''}${llueve ? ' llueve' : ''}">
        <span class="cd-fecha">${DIA_CORTO[wd]} ${d}</span>
        ${x ? iconoClima(llueve && !/rain|thunder|showers/.test(x.simbolo || '') ? 'rain' : x.simbolo) : '<span class="clima-ico sin">—</span>'}
        <span class="cd-temp">${x ? `${Math.round(x.tmax)}°` : 'Sin dato'}</span>
        <span class="cd-lluvia">${x ? `${String(x.lluvia).replace('.', ',')} mm` : ''}</span>
        <span class="cd-peso" title="Parte de la venta del mes de Minorista que se espera este día">${fmtPct(peso)} del mes</span>
      </div>`);
  }

  const aj = proyeccionLluvia(p, clima.dias || []);
  const min = r.unidades.min;
  let resumen;
  if (!aj) {
    resumen = '<p class="muted small" style="margin:12px 0 0">El ajuste por lluvia solo se calcula con días en automático.</p>';
  } else if (!aj.conPronostico) {
    resumen = `<p class="muted small" style="margin:12px 0 0">${clima.error ? 'No se pudo obtener el pronóstico del clima.' : 'Todavía no hay pronóstico para los días que quedan.'}</p>`;
  } else {
    const e = estado(aj.proyeccionPct);
    resumen = `
      <div class="clima-cmp">
        <div>
          <span>Minorista · ponderada</span>
          <strong>${fmtMillones(min.proyeccion)}</strong>
          <small>${fmtPct(min.proyeccionPct)} del objetivo</small>
        </div>
        <div class="ajustada">
          <span>Ajustada por lluvia <span class="tag-ref">Referencial</span></span>
          <strong>${fmtMillones(aj.proyeccion)}</strong>
          <small><b class="pu-${e.clase}">${fmtPct(aj.proyeccionPct)}</b> del objetivo · ${varHtml(aj.variacion)} vs ponderada</small>
        </div>
        <div>
          <span>Días que quedan</span>
          <strong>${aj.diasRestantes}</strong>
          <small>${aj.conLluvia} con lluvia · ${aj.conPronostico - aj.conLluvia} secos${aj.conPronostico < aj.diasRestantes ? ` · ${aj.diasRestantes - aj.conPronostico} sin pronóstico` : ''}</small>
        </div>
      </div>`;
  }

  const actualizado = clima.actualizado ? ` · actualizado ${fmtFechaHora(clima.actualizado)}${clima.vencido ? ' (sin conexión, último disponible)' : ''}` : '';
  return `
    <div class="card clima-card">
      <div class="card-head" style="margin-bottom:0">
        <div>
          <h2>Clima para lo que queda del mes</h2>
          <p class="muted small">Área central (Asunción) · pronóstico MET Norway${actualizado}</p>
        </div>
      </div>
      ${resumen}
      <div class="clima-dias">${tiles.join('')}</div>
      <p class="nota">Recuadro marcado: viernes a domingo, los días fuertes de Minorista. En azul: lluvia de ${AJUSTE_LLUVIA.umbralMm} mm o más. El ajuste usa lo observado en octubre 2026: con lluvia se vendió ${fmtPct(AJUSTE_LLUVIA.factorLluvia)} de lo normal para ese día y en días secos ${fmtPct(AJUSTE_LLUVIA.factorSeco)}. Es orientativo: se va a afinar con más meses de datos.</p>
    </div>`;
}

// ---- 3. Vista rápida: lo esencial en una tarjeta ----
export function rapidoHtml(r, p) {
  const t = r.total;
  const est = estado(t.proyeccionPct);
  const ritmo = t.avance - t.ritmoIdeal;
  const items = [];
  const enRiesgo = [['Baratote', r.baratote], ['Fineglass', r.unidades.fgl], ['Fineboats', r.unidades.fbt]].filter(([, c]) => c.proyeccionPct < 0.9);
  if (enRiesgo.length) items.push({ tipo: 'risk', txt: `${enRiesgo.map(([n, c]) => `<b>${n}</b> proyecta ${fmtPct(c.proyeccionPct)}`).join(' · ')} del objetivo.` });
  const a = state.sucAlertas;
  if (a && a.mes === p.corte.slice(0, 7)) {
    if (a.sinVentaReciente.length) items.push({ tipo: 'risk', txt: `<b>${a.sinVentaReciente.length} sucursal${a.sinVentaReciente.length === 1 ? '' : 'es'}</b> sin venta en los últimos días: ${a.sinVentaReciente.slice(0, 3).map((s) => esc(s.sucursal)).join(', ')}${a.sinVentaReciente.length > 3 ? '…' : ''}.` });
    if (a.caidas.length) items.push({ tipo: 'warn', txt: `Vienen vendiendo menos: ${a.caidas.slice(0, 3).map((s) => `<b>${esc(s.sucursal)}</b> ${fmtVar(s.variacion)}`).join(', ')}.` });
  }
  // Lluvia pronosticada en el próximo viernes a domingo (días fuertes de Minorista).
  const finde = (state.clima?.dias || []).filter((d) => d.fecha > p.corte && esFinde(wdDe(d.fecha))).slice(0, 3);
  const lluvia = finde.filter((d) => d.lluvia >= AJUSTE_LLUVIA.umbralMm);
  if (lluvia.length) items.push({ tipo: 'warn', txt: `Pronóstico: lluvia el ${lluvia.map((d) => `${DIA_CORTO[wdDe(d.fecha)].toLowerCase()} ${Number(d.fecha.slice(8))}`).join(' y el ')}, días fuertes para Minorista.` });
  else if (finde.length) items.push({ tipo: 'ok', txt: `Pronóstico del próximo fin de semana sin lluvia (máx. ${Math.round(Math.max(...finde.map((d) => d.tmax)))}°): buen clima para bebidas.` });
  if (!items.length) items.push({ tipo: 'ok', txt: 'Sin alertas: todas las unidades proyectan 90% o más del objetivo.' });

  const oculto = !isAdmin() && leerPref('dash-detalle', 'no') !== 'si';
  return `
    <div class="card rapido">
      <div class="rapido-top">
        <div class="rapido-dato">
          <span>Proyección al cierre</span>
          <strong data-contar>${fmtPct(t.proyeccionPct)}</strong>
          <span class="chip ${est.clase}">${est.texto}</span>
        </div>
        <div class="rapido-dato">
          <span>Avance a hoy</span>
          <strong data-contar>${fmtPct(t.avance)}</strong>
          <small class="${ritmo >= 0 ? 'var-pos' : 'var-neg'}">${ritmo >= 0 ? 'Adelantado' : 'Atrasado'} ${fmtPct(Math.abs(ritmo))} vs. el ritmo ideal</small>
        </div>
      </div>
      <ul class="rapido-lista">${items.slice(0, 4).map((x) => `<li class="${x.tipo}"><i></i><span>${x.txt}</span></li>`).join('')}</ul>
      ${isAdmin() ? '' : `<button class="btn btn-sm rapido-btn" type="button" data-dash-detalle>${oculto ? 'Ver el detalle completo' : 'Ocultar el detalle'}</button>`}
    </div>`;
}

// ---- Día a día: cuánto vender cada día que queda para llegar al objetivo ----
export const PLAN_UNIDADES = [
  { k: 'total', nombre: 'Total' }, { k: 'bar', nombre: 'Baratote' }, { k: 'may', nombre: 'Mayorista' },
  { k: 'min', nombre: 'Minorista' }, { k: 'fgl', nombre: 'Fineglass' }, { k: 'fbt', nombre: 'Fineboats' },
];

export const PLAN_METAS = [0.95, 1, 1.05];

export function planHtml(r, p) {
  let sel = leerPref('plan-u', 'total');
  if (!PLAN_UNIDADES.some((x) => x.k === sel)) sel = 'total';
  let meta = Number(leerPref('plan-meta', '1'));
  if (!PLAN_METAS.includes(meta)) meta = 1;
  const cab = `<div class="card-head" style="margin-bottom:10px"><div><h2>Cuánto vender cada día que queda</h2>
    <p class="muted small">Lo que falta para la meta, repartido en los días que quedan del mes. Montos en millones de guaraníes.</p></div></div>
    <div class="plan-controles">
      <div class="seg-btns plan-units" role="group" aria-label="Unidad de negocio">${PLAN_UNIDADES.map((x) => `<button type="button" data-plan-u="${x.k}" class="${x.k === sel ? 'active' : ''}">${x.nombre}</button>`).join('')}</div>
      <div class="seg-btns plan-metas" role="group" aria-label="Meta">${PLAN_METAS.map((m) => `<button type="button" data-plan-meta="${m}" class="${m === meta ? 'active' : ''}" title="${m === 1 ? 'El objetivo del mes' : `${fmtPctEntero(m)} del objetivo`}">${m === 1 ? 'Objetivo' : fmtPctEntero(m)}</button>`).join('')}</div>
    </div>`;
  const clima = state.clima?.dias || [];
  const plan = planRestante(p, { meta, pronostico: clima });
  if (!plan) return `${cab}<p class="muted" style="margin-top:12px">Con los días cargados a mano no se puede armar el plan por fecha.</p>`;
  const c = sel === 'total' ? r.total : sel === 'bar' ? r.baratote : r.unidades[sel];
  const x = sel === 'total' ? plan.total : sel === 'bar' ? plan.baratote : plan.unidades[sel];
  const cumplimiento = cumplimientoHtml(sel);
  if (!plan.fechas.length) return `${cab}<p class="muted" style="margin-top:12px">El corte es el último día del mes: no quedan días por vender.</p>${cumplimiento}`;
  const diasQuedan = plan.fechas.length;
  const necesario = x.faltante / diasQuedan;
  const resumen = `<div class="plan-resumen">
      <div><span>Llevás</span><b>${fmtMillones(x.real)}</b><small>${fmtPct(x.objetivo > 0 ? x.real / x.objetivo : 0)} de la meta de ${fmtMillones(x.objetivo)}</small></div>
      <div><span>Faltan</span><b>${x.faltante > 0 ? fmtMillones(x.faltante) : '¡Meta cumplida!'}</b><small>en ${diasQuedan} día${diasQuedan === 1 ? '' : 's'}</small></div>
      <div><span>Promedio por día</span><b>${fmtM1(c.promedioDia)} <small>hoy</small></b><small>ideal ${fmtM1(c.promedioIdeal * meta)} · necesario ${fmtM1(necesario)}</small></div>
    </div>`;
  if (x.faltante <= 0) return `${cab}${resumen}${cumplimiento}`;
  const esp = new Map((p.especiales || []).map((e) => [e.fecha, e]));
  const maxMonto = Math.max(...x.dias.map((d) => d.monto), 1);
  const filas = x.dias.map((d) => {
    const pct = x.objetivo > 0 ? d.acumulado / x.objetivo : 0;
    const e = esp.get(d.fecha);
    const marcas = `${d.lluvia ? '<span class="plan-marca lluvia" title="Pronóstico de lluvia: a Minorista se le pide menos">lluvia</span>' : ''}${e ? `<span class="plan-marca esp" title="Fecha especial: ×${String(e.factor).replace('.', ',')}${e.nota ? ` · ${esc(e.nota)}` : ''}">${e.nota ? esc(e.nota) : `×${String(e.factor).replace('.', ',')}`}</span>` : ''}`;
    return `<tr class="${esFinde(d.wd) ? 'finde' : ''}${d.monto ? '' : ' sin'}">
      <td>${DIA_CORTO[d.wd]} ${Number(d.fecha.slice(8))}${marcas}</td>
      <td class="r muted">${fmtPct(d.monto / x.faltante)}</td>
      <td class="r plan-monto"><span class="plan-barra" style="width:${(d.monto / maxMonto * 100).toFixed(0)}%"></span><b>${d.monto ? fmtM1(d.monto) : '—'}</b></td>
      <td class="r">${fmtM1(d.acumulado)}</td>
      <td class="r">${fmtPct(pct)}</td>
    </tr>`;
  }).join('');
  const reparto = sel === 'min' ? 'Minorista se reparte según el peso de cada día de la semana (el fin de semana pesa más).'
    : sel === 'fgl' ? 'Fineglass se reparte en partes iguales entre los días hábiles (lunes a viernes).'
    : sel === 'may' || sel === 'fbt' ? 'Se reparte en partes iguales entre los días que quedan.'
    : 'Es la suma de cada unidad: Minorista según el peso de cada día de la semana, Fineglass solo de lunes a viernes y el resto en partes iguales.';
  const conClima = ['min', 'bar', 'total'].includes(sel) && x.dias.some((d) => d.lluvia !== undefined);
  const notaClima = conClima ? ` Con pronóstico, a Minorista se le pide ${fmtPct(1 - AJUSTE_LLUVIA.factorLluvia)} menos los días de lluvia y ${fmtPct(AJUSTE_LLUVIA.factorSeco - 1)} más los secos.` : '';
  const notaEsp = x.dias.some((d) => esp.has(d.fecha)) ? ' Las fechas especiales multiplican lo que se espera vender ese día.' : '';
  const sobra = x.dias.at(-1).acumulado > x.objetivo + 1
    ? ' Al cierre suma más que la meta porque cada unidad tiene que llegar a la suya: lo que una vende de más no se descuenta a las otras.' : '';
  return `${cab}${resumen}
    <div class="table-wrap"><table class="plan-tabla">
      <thead><tr><th>Día</th><th class="r" title="Parte de lo que falta que corresponde a ese día">Peso</th><th class="r">Vender</th><th class="r">Acumulado</th><th class="r">% de la meta</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>
    <p class="nota">${reparto}${notaClima}${notaEsp}${sobra} Si un día se vende menos de lo indicado, lo que falta se reparte entre los días siguientes en la próxima publicación.</p>
    ${cumplimiento}`;
}

export const fmtPctEntero = (v) => `${Math.round(v * 100)}%`;

// Plan contra lo vendido: cada tramo entre dos publicaciones del mes (plan al 100%, sin clima).
export function cumplimientoHtml(sel) {
  const tramos = cumplimientoPlan(state.history || []);
  if (!tramos.length) return '';
  const de = (t) => (sel === 'total' ? t.total : sel === 'bar' ? t.baratote : t.unidades[sel]);
  const ultimos = tramos.slice(-7);
  const sumaPlan = ultimos.reduce((s, t) => s + de(t).plan, 0);
  const sumaVend = ultimos.reduce((s, t) => s + de(t).vendido, 0);
  const dif = sumaVend - sumaPlan;
  const filas = [...ultimos].reverse().map((t) => {
    const { plan, vendido } = de(t);
    const d = vendido - plan;
    const rango = t.desde === t.hasta ? `${DIA_CORTO[wdDe(t.hasta)]} ${Number(t.hasta.slice(8))}` : `${Number(t.desde.slice(8))} al ${Number(t.hasta.slice(8))} <small class="muted">(${t.dias} días)</small>`;
    return `<tr>
      <td>${rango}</td>
      <td class="r">${fmtM1(plan)}</td>
      <td class="r">${fmtM1(vendido)}</td>
      <td class="r ${d >= 0 ? 'var-pos' : 'var-neg'}">${d >= 0 ? '+' : '−'}${fmtM1(Math.abs(d))}</td>
      <td class="r ${d >= 0 ? 'var-pos' : 'var-neg'}">${plan > 0 ? fmtPct(vendido / plan) : '—'}</td>
    </tr>`;
  }).join('');
  return `
    <div class="plan-cumpl">
      <h3>Plan contra lo vendido</h3>
      <p class="muted small" style="margin:2px 0 10px">Entre cada publicación: lo que pedía el plan y lo que se vendió.
        ${ultimos.length > 1 ? `En los últimos ${ultimos.length} tramos: <b class="${dif >= 0 ? 'var-pos' : 'var-neg'}">${dif >= 0 ? `${fmtM1(dif)} por encima` : `${fmtM1(-dif)} por debajo`}</b> del plan.` : ''}</p>
      <div class="table-wrap"><table class="plan-tabla">
        <thead><tr><th>Días</th><th class="r">Plan</th><th class="r">Vendido</th><th class="r">Diferencia</th><th class="r">Cumplido</th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>
      <p class="nota">El plan de cada tramo es el de la publicación anterior, con la meta al 100% y sin ajuste por clima.</p>
    </div>`;
}

export function renderDashboard() {
  const el = $('dash');
  const p = state.published;
  if (!p) {
    el.innerHTML = '<div class="card empty">Todavía no hay datos publicados. Cuando el administrador publique el primer reporte, lo vas a ver acá.</div>';
    return;
  }
  const r = calcularReporte(p);
  const t = r.total;
  const u = r.unidades;
  // Avance de cada unidad en las últimas publicaciones (para los mini gráficos).
  const historia = state.history.slice(-8).map((h) => ({ corte: h.corte, r: calcularReporte(h) }));
  const serieDe = (elegir) => historia.map((h) => ({ corte: h.corte, v: elegir(h.r).avance }));
  const filasRitmo = [
    { nombre: 'Baratote', c: r.baratote, clase: 'grupo-row' },
    { nombre: 'Mayorista', c: u.may, clase: 'sub-row' },
    { nombre: 'Minorista', c: u.min, clase: 'sub-row' },
    { nombre: 'Fineglass', c: u.fgl, clase: '' },
    { nombre: 'Fineboats', c: u.fbt, clase: '' },
  ];
  const ritmoRows = filasRitmo.map(({ nombre, c, clase }) => {
    const alto = c.necesarioDia > c.promedioDia;
    return `
      <tr${clase ? ` class="${clase}"` : ''}>
        <td>${esc(nombre)}</td>
        <td class="r">${fmtMiles(c.faltante / 1e6)}</td>
        <td class="r opc">${c.diasRestantes}</td>
        <td class="r ${c.promedioDia >= c.promedioIdeal ? 'necesario-ok' : ''}">${fmtM1(c.promedioDia)}</td>
        <td class="r muted">${fmtM1(c.promedioIdeal)}</td>
        <td class="r ${alto ? 'necesario-alto' : 'necesario-ok'}">${fmtM1(c.necesarioDia)}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="dash-head">
      <h1>Avance de ventas · ${nombreMes(p.corte)}</h1>
      <p class="muted">Corte al ${fmtFecha(p.corte)} · Publicado ${fmtFechaHora(p.publicadoEn)} por ${esc(p.por)}${r.manual ? ' · Días cargados a mano' : ''}</p>
    </div>

    ${avisoCierreHtml(p)}

    ${rapidoHtml(r, p)}

    <div id="dash-detalle"${!isAdmin() && leerPref('dash-detalle', 'no') !== 'si' ? ' hidden' : ''}>
    <nav class="saltos" aria-label="Ir a una sección">
      <button type="button" data-salto="s-proy">Proyección</button>
      <button type="button" data-salto="s-unidades">Unidades</button>
      <button type="button" data-salto="s-clima">Clima</button>
      <button type="button" data-salto="s-graficos">Gráficos</button>
      <button type="button" data-salto="s-comparativa">Comparativa</button>
      <button type="button" data-salto="s-ritmo">Ritmo</button>
      <button type="button" data-salto="s-plan">Día a día</button>
    </nav>

    <div id="s-proy" class="ancla">${proyeccionHtml(r, p.corte)}</div>

    <div class="kpis">
      <div class="card kpi" style="--acento:var(--c-fbt)">
        <div class="kpi-top">${icono('venta')}<span class="kpi-label">Venta acumulada</span></div>
        <span class="kpi-value" data-contar>${fmtMillones(t.real)}</span>
        <span class="kpi-sub">Al corte del ${fmtFecha(p.corte)}</span>
      </div>
      <div class="card kpi" style="--acento:var(--c-fgl)">
        <div class="kpi-top">${icono('objetivo')}<span class="kpi-label">Objetivo del mes</span></div>
        <span class="kpi-value" data-contar>${fmtMillones(t.objetivo)}</span>
        <span class="kpi-sub">Faltan ${fmtMillones(t.faltante)}</span>
      </div>
      <div class="card kpi" style="--acento:var(--c-min)">
        <div class="kpi-top">${icono('avance')}<span class="kpi-label">Avance sobre objetivo</span></div>
        <span class="kpi-value" data-contar>${fmtPct(t.avance)}</span>
        <span class="kpi-sub">Ritmo ideal a hoy ${fmtPct(t.ritmoIdeal)}</span>
      </div>
    </div>

    <div class="unidades ancla" id="s-unidades">
      ${unidadCard('Baratote', 'lun-dom', r.baratote, COLOR.bar, r.manual, `<div class="canales"><div class="unidad-meta" style="font-weight:600">Por canal</div>${canal(u.may)}${canal(u.min)}</div>`, serieDe((x) => x.baratote))}
      ${unidadCard('Fineglass', 'lun-vie', u.fgl, COLOR.fgl, r.manual, '', serieDe((x) => x.unidades.fgl))}
      ${unidadCard('Fineboats', 'lun-dom', u.fbt, COLOR.fbt, r.manual, '', serieDe((x) => x.unidades.fbt))}
    </div>
    <div class="leyenda">
      <span><i class="sw" style="background:var(--text-2)"></i>Venta real (color de la unidad)</span>
      <span><i class="sw" style="background:var(--track-fuerte)"></i>Proyección al cierre (tono claro)</span>
      <span><i class="sw target"></i>Objetivo (100%)</span>
    </div>

    <div id="s-clima" class="ancla">${climaHtml(r, p)}</div>

    <div class="dash-bottom ancla" id="s-graficos">
      ${evolucionHtml()}
      ${composicionHtml(r)}
    </div>

    <div class="dash-bottom ancla" id="s-comparativa" style="margin-top:16px">
      ${comparativaHtml(r, p.corte)}
      <div class="card ancla" id="s-ritmo">
        <h2>Ritmo necesario para llegar</h2>
        <p class="muted small" style="margin:4px 0 12px">Montos en millones de guaraníes.</p>
        <div class="table-wrap">
          <table class="ritmo">
            <thead>
              <tr><th>Unidad</th><th class="r">Faltante</th><th class="r opc">Días</th><th class="r" title="Venta del mes dividida por los días ya vendidos">Actual/día</th><th class="r" title="Objetivo dividido por los días del mes">Ideal/día</th><th class="r">Necesario/día</th></tr>
            </thead>
            <tbody>${ritmoRows}</tbody>
          </table>
        </div>
        <p class="nota"><b>Actual/día</b>: promedio vendido por día hasta hoy (en <span class="necesario-ok">azul</span> si alcanza al ideal). <b>Ideal/día</b>: el objetivo repartido en los días del mes. <b>Necesario/día</b>: lo que hay que vender por día desde mañana; en <span class="necesario-alto">naranja</span> si es más que el promedio actual.</p>
      </div>
    </div>

    <div id="s-plan" class="card ancla plan-card">${planHtml(r, p)}</div>
    </div>`;
  contarNumeros(el);
}