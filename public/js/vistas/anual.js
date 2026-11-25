// Vista "Comparativo anual": el año en curso resaltado contra los dos anteriores, mes a mes o
// acumulado, con la variación de cada mes contra el año anterior y una tabla de calor por unidad.
import * as API from '../api.js';
import { estado, fmtMillones, fmtMiles, fmtVar, fmtFecha, nombreMes, hoyAsuncion } from '../calc.js';
import { VISTAS_UNIDAD, resumenAnual, tablaVariaciones, faltaParaIgualar } from '../anual.js';
import { leerPlanillaMensual } from '../objetivos.js';
import { $, MES_CORTO, MES_LARGO, compartirTexto, contarNumeros, currentView, esc, guardarPref, handleError, icono, imprimir, isAdmin, leerPref, showMsg, tono } from './comun.js';

export const anual = { datos: null, u: leerPref('anual-u', 'total'), modo: leerPref('anual-modo', 'mes'), cmp: leerPref('anual-cmp', '0-1'), ver: leerPref('anual-ver', 'pct'), puntos: null };

export function setupAnual() {
  const el = $('anual-contenido');
  el.addEventListener('click', (e) => {
    const u = e.target.closest('[data-anual-u]');
    if (u) { anual.u = u.dataset.anualU; guardarPref('anual-u', anual.u); renderAnual(); return; }
    const m = e.target.closest('[data-anual-modo]');
    if (m) { anual.modo = m.dataset.anualModo; guardarPref('anual-modo', anual.modo); renderAnual(); return; }
    const c = e.target.closest('[data-anual-cmp]');
    if (c) { anual.cmp = c.dataset.anualCmp; guardarPref('anual-cmp', anual.cmp); renderAnual(); return; }
    const v = e.target.closest('[data-anual-ver]');
    if (v) { anual.ver = v.dataset.anualVer; guardarPref('anual-ver', anual.ver); renderAnual(); return; }
    const exp = e.target.closest('[data-anual-exp]');
    if (exp) exportarAnual(exp.dataset.anualExp);
  });
  // Detalle de un mes al pasar el mouse o tocar el gráfico.
  const mostrar = (e) => {
    const hit = e.target.closest('.an-hit');
    if (hit) mostrarMesAnual(Number(hit.dataset.i));
  };
  el.addEventListener('mouseover', mostrar);
  el.addEventListener('click', mostrar);
  el.addEventListener('mouseleave', () => { const t = $('an-tip'); if (t) t.hidden = true; }, true);
  if (isAdmin()) $('anual-guardar').addEventListener('click', guardarMesesAnual);
}

export async function loadAnual() {
  try {
    anual.datos = await API.getAnual();
    renderAnual();
  } catch (err) {
    handleError(err);
  }
}

export const nombreUnidad = (u) => VISTAS_UNIDAD.find((x) => x.id === u)?.nombre || '';
// En el celular los gráficos se dibujan a su ancho, así el texto no queda diminuto.
export const anualMovil = matchMedia('(max-width: 600px)');
// DER deja lugar para el nombre de cada año al final de su línea.
export const medidasAnual = () => (anualMovil.matches ? { W: 360, IZQ: 40, DER: 34 } : { W: 720, IZQ: 50, DER: 44 });
anualMovil.addEventListener('change', () => { if (currentView() === 'anual' && anual.datos) renderAnual(); });
export const acumular = (s) => { let t = 0; return s.map((v) => (v === null ? null : (t += v))); };

export function renderAnual() {
  const d = anual.datos;
  const el = $('anual-contenido');
  const r = d ? resumenAnual(d.meses, d.enCurso, anual.u) : null;
  if (!r || !r.n) {
    $('anual-sub').textContent = '';
    el.innerHTML = `<div class="card empty">Todavía no hay meses cerrados para comparar.${isAdmin() ? ' Cargalos abajo, en Cargar meses cerrados.' : ''}</div>`;
    if (isAdmin()) $('anual-carga').open = true;
    return;
  }
  const Y = r.anio;
  const mesN = MES_LARGO[r.n - 1];
  const parciales = Object.entries(d.fuentes).filter(([, f]) => f === 'parcial').map(([m]) => nombreMes(`${m}-01`));
  $('anual-titulo').textContent = `Comparativo anual · ${Y}`;
  $('anual-sub').textContent = `Meses cerrados hasta ${mesN} ${Y}${d.enCurso ? ` · ${MES_LARGO[Number(d.enCurso.mes.slice(5)) - 1]} en curso: lo publicado al ${fmtFecha(d.enCurso.corte)}` : ''}`;

  const pct = (v) => (v === null ? '—' : fmtVar(v));
  const tono = (v) => (v === null ? '' : v >= 0 ? 'var-pos' : 'var-neg');
  const um = r.ultimoMes;
  const mesAntNombre = r.n >= 2 ? MES_LARGO[r.n - 2] : `diciembre ${Y - 1}`;
  // racha.sube = la diferencia contra el año anterior aumentó (mejora): con ventaja, la ventaja crece;
  // con atraso, el atraso se achica.
  const racha = r.racha
    ? `${r.ventaja >= 0 ? `la ventaja ${r.racha.sube ? 'creció' : 'se achicó'}` : `el atraso ${r.racha.sube ? 'se achicó' : 'creció'}`} ${r.racha.meses === 1 ? 'el último mes' : `${r.racha.meses} meses seguidos`}`
    : '';
  const kpis = `
    <div class="kpis an-kpis">
      <div class="card kpi" style="--acento:var(--primary)">
        <div class="kpi-top">${icono('venta')}<span class="kpi-label">Acumulado ${Y} · enero a ${mesN}</span></div>
        <span class="kpi-value" data-contar>${fmtMillones(r.ytd.y)}</span>
        <span class="kpi-sub"><b class="${tono(r.varYtd1)}">${pct(r.varYtd1)}</b> vs ${Y - 1}${r.varYtd2 !== null ? ` · <b class="${tono(r.varYtd2)}">${pct(r.varYtd2)}</b> vs ${Y - 2}` : ''}</span>
      </div>
      <div class="card kpi" style="--acento:${r.ventaja === null || r.ventaja >= 0 ? 'var(--pos)' : 'var(--neg)'}">
        <div class="kpi-top">${icono('avance')}<span class="kpi-label">${r.ventaja === null || r.ventaja >= 0 ? 'Ventaja' : 'Atraso'} contra ${Y - 1}</span></div>
        <span class="kpi-value" data-contar>${r.ventaja === null ? '—' : `${r.ventaja >= 0 ? '+' : '−'}${fmtMillones(Math.abs(r.ventaja))}`}</span>
        <span class="kpi-sub">${racha || 'mismos meses del año anterior'}</span>
      </div>
      <div class="card kpi" style="--acento:var(--c-fgl)">
        <div class="kpi-top">${icono('calendario')}<span class="kpi-label">${mesN[0].toUpperCase() + mesN.slice(1)} contra ${mesAntNombre}</span></div>
        <span class="kpi-value ${tono(um.vsAnterior)}">${pct(um.vsAnterior)}</span>
        <span class="kpi-sub">contra ${mesN} ${Y - 1}: <b class="${tono(um.vsAnioAnterior)}">${pct(um.vsAnioAnterior)}</b></span>
      </div>
      <div class="card kpi" style="--acento:var(--c-fbt)">
        <div class="kpi-top">${icono('objetivo')}<span class="kpi-label">Proyección ${Y}</span></div>
        <span class="kpi-value" data-contar>${r.proyeccion ? fmtMillones(r.proyeccion.total) : '—'}</span>
        <span class="kpi-sub">${r.proyeccion ? `<b class="${tono(r.proyeccion.vsAnioAnterior)}">${pct(r.proyeccion.vsAnioAnterior)}</b> vs ${Y - 1} completo${r.proyeccion.enCurso ? ' · con lo publicado del mes en curso' : ''}` : `falta ${Y - 1} completo para proyectar`}</span>
      </div>
    </div>`;

  const seg = (attr, actual, opciones) => opciones.map(([v, t]) => `<button type="button" data-${attr}="${v}" class="${v === actual ? 'active' : ''}">${t}</button>`).join('');
  el.innerHTML = `
    ${kpis}
    ${parciales.length ? `<p class="nota" style="margin:-6px 0 14px">${esc(parciales.join(', '))}: el cierre del portal no llega al último día del mes; cargalo completo para comparar bien.</p>` : ''}
    <div class="card an-card">
      <div class="card-head an-controles">
        <div class="seg-btns an-unidades" role="group" aria-label="Unidad">${seg('anual-u', anual.u, VISTAS_UNIDAD.map((u) => [u.id, u.nombre]))}</div>
        <div class="seg-btns" role="group" aria-label="Vista">${seg('anual-modo', anual.modo, [['mes', 'Mes a mes'], ['acu', 'Acumulado']])}</div>
      </div>
      <div class="leyenda an-leyenda">
        <span><i class="sw" style="background:var(--primary)"></i>${Y}</span>
        <span><i class="sw an-sw-1"></i>${Y - 1}</span>
        <span><i class="sw an-sw-2"></i>${Y - 2}</span>
        ${r.proyeccion ? '<span><i class="sw an-sw-p"></i>Proyección</span>' : ''}
        <span class="muted">${nombreUnidad(anual.u)} · millones de Gs.</span>
      </div>
      <div class="an-graf">${lineasAnualHtml(r)}<div class="an-tip" id="an-tip" hidden></div></div>
      <h3 class="an-sub">Cada mes contra el mismo mes de ${Y - 1}</h3>
      ${barrasAnualHtml(r)}
    </div>
    ${faltaAnualHtml(d, Y, r.n)}
    ${calorAnualHtml(d.meses, Y, r.n)}
    <div class="an-exportar">
      <button class="btn btn-sm" type="button" data-anual-exp="pdf">PDF</button>
      <button class="btn btn-sm" type="button" data-anual-exp="compartir">Compartir</button>
    </div>`;
  contarNumeros(el);
}

// Líneas por año (SVG): el año en curso con área y puntos, los anteriores en gris, la proyección punteada.
export function lineasAnualHtml(r) {
  const Y = r.anio;
  const acu = anual.modo === 'acu';
  const tr = (s) => (acu ? acumular(s) : s);
  const sy = tr(r.series[Y]), s1 = tr(r.series[Y - 1]), s2 = tr(r.series[Y - 2]);
  let sp = null;
  if (r.proyeccion) {
    sp = Array(12).fill(null);
    sp[r.n - 1] = sy[r.n - 1];
    let t = sy[r.n - 1];
    for (let i = r.n; i < 12; i++) sp[i] = acu ? (t += r.proyeccion.serie[i]) : r.proyeccion.serie[i];
  }
  const { W, IZQ, DER } = medidasAnual();
  const H = W < 500 ? 250 : 270, ARR = 30, ABA = 26;
  const todos = [sy, s1, s2, sp || []].flat().filter((v) => v !== null && v !== undefined);
  const max = Math.max(...todos, 1) * 1.06;
  // Mes a mes, el eje arranca cerca del mínimo para que se vean las diferencias entre años.
  const min = acu ? 0 : Math.max(0, Math.min(...todos) * 0.85);
  const x = (i) => IZQ + (i * (W - IZQ - DER)) / 11;
  const y = (v) => ARR + (1 - (v - min) / (max - min)) * (H - ARR - ABA);
  const linea = (s) => {
    let d = '', abierto = false;
    s.forEach((v, i) => {
      if (v === null || v === undefined) { abierto = false; return; }
      d += `${abierto ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      abierto = true;
    });
    return d.trim();
  };
  const ultimo = r.n - 1;
  const area = `${linea(sy)} L${x(ultimo).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((k) => min + (max / 1.06 - min) * k);
  const grilla = marcas.map((v) => `<line x1="${IZQ}" x2="${W - DER}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="ac-grilla"/><text x="${IZQ - 6}" y="${(y(v) + 4).toFixed(1)}" class="ac-eje" text-anchor="end">${fmtMiles(v / 1e6)}</text>`).join('');
  const meses = MES_CORTO.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ac-eje${i === ultimo ? ' an-eje-act' : ''}" text-anchor="middle">${m}</text>`).join('');
  const puntos = sy.map((v, i) => (v === null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === ultimo ? 5 : 3.2}" class="an-punto" style="animation-delay:${(0.25 + i * 0.09).toFixed(2)}s"/>`)).join('');
  // Años anteriores con su color y su marca (lleno para el anterior, hueco para el de hace dos años).
  const marcasAnt = (s, clase, r_) => s.map((v, i) => (v === null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r_}" class="${clase}" style="animation-delay:${(0.4 + i * 0.07).toFixed(2)}s"/>`)).join('');
  // Nombre de los años anteriores al final de su línea, separados para que no se encimen
  // (el año en curso ya se distingue por el área y los puntos).
  const finales = [[s2, Y - 2, 'an-anio-2'], [s1, Y - 1, 'an-anio-1']]
    .map(([s, anio, clase]) => { const i = s.findLastIndex((v) => v !== null && v !== undefined); return i < 0 ? null : { i, yy: y(s[i]) + 4, anio, clase }; })
    .filter(Boolean).sort((a, b) => a.yy - b.yy);
  finales.forEach((f, k) => { if (k && f.i === finales[k - 1].i && f.yy - finales[k - 1].yy < 13) f.yy = finales[k - 1].yy + 13; });
  const anios = finales.map((f) => `<text x="${(x(f.i) + 7).toFixed(1)}" y="${f.yy.toFixed(1)}" class="an-anio ${f.clase}">${f.anio}</text>`).join('');

  // Anotaciones: lo que hay que mirar.
  const nota = (i, v, texto, abajo = false, clase = '') => {
    const ancla = i <= 1 ? 'start' : i >= 10 ? 'end' : 'middle';
    return `<text x="${x(i).toFixed(1)}" y="${(y(v) + (abajo ? 20 : -11)).toFixed(1)}" class="an-nota ${clase}" text-anchor="${ancla}">${esc(texto)}</text>`;
  };
  const notas = [];
  if (!acu) {
    if (r.mejor) notas.push(nota(r.mejor.mes - 1, sy[r.mejor.mes - 1], `Mejor mes · ${fmtMiles(r.mejor.valor / 1e6)}`));
    if (r.peor && r.peor.mes !== r.mejor?.mes) notas.push(nota(r.peor.mes - 1, sy[r.peor.mes - 1], `Mayor caída · ${fmtVar(r.peor.variacion)}`, true, 'an-nota-neg'));
  } else if (r.ventaja !== null) {
    notas.push(nota(ultimo, sy[ultimo], `${r.ventaja >= 0 ? '+' : '−'}${fmtMiles(Math.abs(r.ventaja) / 1e6)} M vs ${Y - 1}`, false, r.ventaja >= 0 ? 'an-nota-pos' : 'an-nota-neg'));
  }
  if (sp && sp[11] !== null) notas.push(nota(11, sp[11], `${acu ? 'Cierre proyectado' : 'Dic. proyectado'} · ${fmtMiles(sp[11] / 1e6)}`, false, 'an-nota-proy'));

  anual.puntos = { Y, sy, s1, s2, sp, n: r.n, acu };
  const hits = MES_CORTO.map((_, i) => `<rect class="an-hit" data-i="${i}" x="${(x(i) - (W - IZQ - DER) / 22).toFixed(1)}" y="${ARR - 10}" width="${((W - IZQ - DER) / 11).toFixed(1)}" height="${H - ARR - ABA + 10}"/>`).join('');
  return `
    <svg class="an-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas por mes de ${Y}, ${Y - 1} y ${Y - 2}">
      ${grilla}${meses}
      <path d="${area}" class="an-area"/>
      <path d="${linea(s2)}" class="an-linea an-l2" pathLength="1"/>
      <path d="${linea(s1)}" class="an-linea an-l1" pathLength="1"/>
      ${marcasAnt(s2, 'an-p2', 2.4)}${marcasAnt(s1, 'an-p1', 2.6)}
      ${sp ? `<path d="${linea(sp)}" class="an-proy"/>` : ''}
      <path d="${linea(sy)}" class="an-linea an-ly" pathLength="1"/>
      ${puntos}
      ${notas.join('')}
      ${anios}
      <line class="an-guia" id="an-guia" x1="0" x2="0" y1="${ARR - 10}" y2="${H - ABA}" visibility="hidden"/>
      ${hits}
    </svg>`;
}

export function mostrarMesAnual(i) {
  const p = anual.puntos;
  const tip = $('an-tip');
  const guia = $('an-guia');
  if (!p || !tip) return;
  const svg = guia.ownerSVGElement;
  const { W, IZQ, DER } = medidasAnual();
  const xv = IZQ + (i * (W - IZQ - DER)) / 11;
  guia.setAttribute('x1', xv); guia.setAttribute('x2', xv); guia.setAttribute('visibility', 'visible');
  const fila = (anio, v, clase, comp) => (v === null || v === undefined ? '' : `<div class="${clase}"><span>${anio}</span><b>${fmtMillones(v)}</b>${comp !== undefined && comp !== null && comp > 0 ? `<small class="${v / comp - 1 >= 0 ? 'var-pos' : 'var-neg'}">${fmtVar(v / comp - 1)}</small>` : ''}</div>`);
  const proyectado = p.sp && i >= p.n ? p.sp[i] : null;
  tip.innerHTML = `
    <strong>${MES_LARGO[i][0].toUpperCase() + MES_LARGO[i].slice(1)}${p.acu ? ' · acumulado' : ''}</strong>
    ${fila(p.Y, p.sy[i], 'an-tip-y', p.s1[i])}
    ${proyectado !== null ? fila(`${p.Y} proy.`, proyectado, 'an-tip-p', p.s1[i]) : ''}
    ${fila(p.Y - 1, p.s1[i], 'an-tip-1', p.s2[i])}
    ${fila(p.Y - 2, p.s2[i], 'an-tip-2')}`;
  tip.hidden = false;
  const caja = svg.getBoundingClientRect();
  const izq = (xv / W) * caja.width;
  tip.style.left = `${Math.min(Math.max(izq - tip.offsetWidth / 2, 0), caja.width - tip.offsetWidth)}px`;
}

// Barras de variación contra el año anterior: verdes las que crecieron, rojas las que cayeron.
export function barrasAnualHtml(r) {
  const v = r.variaciones;
  const { W, IZQ, DER } = medidasAnual();
  const H = 160, ARR = 22, ABA = 24;
  const maxAbs = Math.max(...v.filter((x) => x !== null).map(Math.abs), 0.05) * 1.15;
  const x = (i) => IZQ + (i * (W - IZQ - DER)) / 11;
  const cero = ARR + (H - ARR - ABA) / 2;
  const alto = (val) => (Math.abs(val) / maxAbs) * ((H - ARR - ABA) / 2);
  const ancho = Math.min(26, ((W - IZQ - DER) / 11) * 0.55);
  const barras = v.map((val, i) => {
    if (val === null) return `<text x="${x(i).toFixed(1)}" y="${(cero + 4).toFixed(1)}" class="ac-eje" text-anchor="middle">·</text>`;
    const h = Math.max(alto(val), 1.5);
    const pos = val >= 0;
    const yb = pos ? cero - h : cero;
    return `
      <rect x="${(x(i) - ancho / 2).toFixed(1)}" y="${yb.toFixed(1)}" width="${ancho.toFixed(1)}" height="${h.toFixed(1)}" rx="3" class="an-bar ${pos ? 'pos' : 'neg'}" style="animation-delay:${(0.1 + i * 0.06).toFixed(2)}s"><title>${MES_LARGO[i]}: ${fmtVar(val)} contra ${r.anio - 1}</title></rect>
      <text x="${x(i).toFixed(1)}" y="${(pos ? yb - 5 : yb + h + 12).toFixed(1)}" class="an-bar-txt ${pos ? 'var-pos' : 'var-neg'}" text-anchor="middle" style="animation-delay:${(0.5 + i * 0.06).toFixed(2)}s">${fmtVar(val).replace(/,\d%$/, '%')}</text>`;
  }).join('');
  const meses = MES_CORTO.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="ac-eje" text-anchor="middle">${m}</text>`).join('');
  return `
    <svg class="an-svg an-svg-barras" viewBox="0 0 ${W} ${H}" role="img" aria-label="Variación de cada mes contra el año anterior">
      <line x1="${IZQ}" x2="${W - DER}" y1="${cero}" y2="${cero}" class="an-cero"/>
      ${barras}${meses}
    </svg>`;
}

// Tabla de calor: cada unidad, mes por mes, contra otro año (elegible), en % o en diferencia de Gs.
// anual.cmp dice qué años: '0-1' = año en curso contra el anterior, '0-2' contra dos antes, '1-2' los dos anteriores.
export function calorAnualHtml(meses, Y, n) {
  const [ka, kb] = (anual.cmp || '0-1').split('-').map(Number);
  const A = Y - ka, B = Y - kb;
  const hasta = ka === 0 ? n : 12;
  const enGs = anual.ver === 'gs';
  const filas = tablaVariaciones(meses, A, hasta, B);
  const millones = (v) => `${v >= 0 ? '+' : '−'}${fmtMiles(Math.abs(v) / 1e6)}`;
  const celda = (c) => {
    if (c.variacion === null) return `<td class="an-c-vacia">${c.valor === null ? '' : '—'}</td>`;
    const fuerza = Math.round(10 + Math.min(Math.abs(c.variacion) / 0.3, 1) * 45);
    const color = c.variacion >= 0 ? 'var(--pos)' : 'var(--neg)';
    return `<td style="background:color-mix(in srgb, ${color} ${fuerza}%, transparent)" title="${A}: ${fmtMillones(c.valor)} · ${B}: ${fmtMillones(c.anterior)} · ${fmtVar(c.variacion)}">${enGs ? millones(c.diferencia) : fmtVar(c.variacion).replace(/,\d%$/, '%')}</td>`;
  };
  const acu = (f) => (f.acumulado === null ? '—' : enGs ? millones(f.diferencia) : fmtVar(f.acumulado));
  const seg = (attr, actual, opciones) => opciones.map(([v, t]) => `<button type="button" data-${attr}="${v}" class="${v === actual ? 'active' : ''}">${t}</button>`).join('');
  return `
    <div class="card an-calor">
      <div class="card-head an-controles">
        <h2>Cada unidad: ${A} contra ${B}</h2>
        <div class="an-calor-ctrl">
          <div class="seg-btns" role="group" aria-label="Años a comparar">${seg('anual-cmp', anual.cmp, [['0-1', `${Y} vs ${Y - 1}`], ['0-2', `${Y} vs ${Y - 2}`], ['1-2', `${Y - 1} vs ${Y - 2}`]])}</div>
          <div class="seg-btns" role="group" aria-label="Mostrar">${seg('anual-ver', anual.ver, [['pct', '%'], ['gs', 'Millones Gs.']])}</div>
        </div>
      </div>
      <p class="muted small" style="margin:4px 0 12px">${enGs ? `Diferencia en millones de Gs. de cada mes de ${A} contra el mismo mes de ${B}` : `Variación de cada mes de ${A} contra el mismo mes de ${B}`}${ka === 0 ? `; el acumulado va de enero a ${MES_LARGO[n - 1]}` : ''}. Tocá una unidad para verla en el gráfico.</p>
      <div class="table-wrap">
        <table class="an-calor-tabla${enGs ? ' an-calor-gs' : ''}">
          <thead><tr><th></th>${MES_CORTO.map((m) => `<th>${m}</th>`).join('')}<th>Acum.</th></tr></thead>
          <tbody>${filas.map((f) => `
            <tr class="${f.id === anual.u ? 'act' : ''}${f.id === 'min' || f.id === 'may' ? ' sub' : ''}">
              <th><button type="button" class="btn-link" data-anual-u="${f.id}">${esc(f.nombre)}</button></th>
              ${f.celdas.map(celda).join('')}
              <td class="an-c-acu ${f.acumulado === null ? '' : f.acumulado >= 0 ? 'var-pos' : 'var-neg'}">${acu(f)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// Qué falta para igualar el año anterior completo, por unidad, y si la proyección alcanza.
export function faltaAnualHtml(d, Y, n) {
  const filas = faltaParaIgualar(d.meses, d.enCurso);
  if (!filas.length) return '';
  const quedan = `${MES_LARGO[n]}${n < 11 ? ` a ${MES_LARGO[11]}` : ''}`;
  const mill = (v) => fmtMiles(v / 1e6); // en millones, para que entre en el celular
  const estado = (f) => (f.falta <= 0
    ? `<span class="chip ok">Ya superó ${Y - 1}</span>`
    : f.alcanza === null ? '' : `<span class="chip ${f.alcanza ? 'ok' : 'risk'}">${f.alcanza ? 'La proyección alcanza' : 'La proyección no alcanza'}</span>`);
  return `
    <div class="card an-falta">
      <h2>Qué falta para igualar ${Y - 1}</h2>
      <p class="muted small" style="margin:4px 0 12px">Lo vendido de enero a ${MES_LARGO[n - 1]} contra todo ${Y - 1}, y cuánto hay que vender en lo que queda (${quedan}) para empatar el año. En millones de Gs.</p>
      <div class="table-wrap">
        <table class="suc-tabla an-falta-tabla">
          <thead><tr><th>Unidad</th><th class="r">Vendido ${Y}</th><th class="r opc">Total ${Y - 1}</th><th class="r">Falta</th><th class="r opc">Por mes</th><th class="r">Crecer</th><th class="opc"></th></tr></thead>
          <tbody>${filas.map((f) => `
            <tr class="${f.id === 'min' || f.id === 'may' ? 'sub' : ''}${f.id === anual.u ? ' act' : ''}">
              <td><button type="button" class="btn-link" data-anual-u="${f.id}">${esc(f.nombre)}</button></td>
              <td class="r">${mill(f.vendido)}</td>
              <td class="r opc">${mill(f.totalAnterior)}</td>
              <td class="r"><b>${f.falta > 0 ? mill(f.falta) : '—'}</b></td>
              <td class="r opc">${f.falta > 0 ? mill(f.porMes) : '—'}</td>
              <td class="r ${f.crecimientoNecesario === null || f.falta <= 0 ? '' : f.crecimientoNecesario > 0 ? 'var-neg' : 'var-pos'}">${f.falta <= 0 || f.crecimientoNecesario === null ? '—' : fmtVar(f.crecimientoNecesario)}</td>
              <td class="opc">${estado(f)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="nota" style="margin:10px 0 0">"Crecer": cuánto más que en esos mismos meses de ${Y - 1} hay que vender para empatar el año. En rojo, si hace falta crecer; en verde, si alcanza aun vendiendo menos.</p>
    </div>`;
}

export function exportarAnual(formato) {
  const d = anual.datos;
  const r = d && resumenAnual(d.meses, d.enCurso, anual.u);
  if (!r) return;
  const titulo = `Comparativo anual ${r.anio} · ${nombreUnidad(anual.u)}`;
  if (formato === 'pdf') { imprimir(titulo); return; }
  const um = r.ultimoMes;
  const lineas = [
    titulo,
    `Acumulado enero a ${MES_LARGO[r.n - 1]}: ${fmtMillones(r.ytd.y)} (${fmtVar(r.varYtd1)} vs ${r.anio - 1}${r.varYtd2 !== null ? `, ${fmtVar(r.varYtd2)} vs ${r.anio - 2}` : ''})`,
    r.ventaja !== null ? `${r.ventaja >= 0 ? 'Ventaja' : 'Atraso'} contra ${r.anio - 1}: ${fmtMillones(Math.abs(r.ventaja))}` : '',
    `${MES_LARGO[r.n - 1]}: ${fmtVar(um.vsAnterior)} contra el mes anterior, ${fmtVar(um.vsAnioAnterior)} contra ${r.anio - 1}`,
    r.proyeccion ? `Proyección del año: ${fmtMillones(r.proyeccion.total)} (${fmtVar(r.proyeccion.vsAnioAnterior)} vs ${r.anio - 1})` : '',
  ].filter(Boolean);
  compartirTexto(titulo, lineas.join('\n'));
}

export async function guardarMesesAnual() {
  const msgEl = $('anual-msg');
  const texto = $('anual-texto').value;
  if (!texto.trim()) { showMsg(msgEl, 'Pegá la planilla.', false); return; }
  const r = leerPlanillaMensual(texto);
  const enCurso = hoyAsuncion().slice(0, 7);
  const todos = Object.keys(r.registros).sort();
  const meses = todos.filter((m) => m < enCurso);
  if (!meses.length) { showMsg(msgEl, r.errores[0]?.motivo || 'No encontré meses cerrados. La planilla tiene que tener los títulos Año y Mes.', false); return; }
  const registros = Object.fromEntries(meses.map((m) => [m, r.registros[m]]));
  const anios = [...new Set(meses.map((m) => m.slice(0, 4)))].map((a) => `${a} (${meses.filter((m) => m.startsWith(a)).length} meses)`).join(', ');
  const avisos = [
    `${meses.length} meses: ${anios}.`,
    todos.length > meses.length ? `${todos.length - meses.length} mes${todos.length - meses.length === 1 ? '' : 'es'} todavía no cerrado${todos.length - meses.length === 1 ? '' : 's'} no se carga${todos.length - meses.length === 1 ? '' : 'n'}.` : '',
    r.errores.length ? `${r.errores.length} problema${r.errores.length === 1 ? '' : 's'} (no se carga esa fila o celda): ${r.errores[0].motivo}` : '',
  ].filter(Boolean);
  if (!confirm(`${avisos.join('\n\n')}\n\nLos meses que ya estaban se reemplazan. ¿Guardar?`)) return;
  try {
    await API.guardarPlanillaObjetivos(registros);
    showMsg(msgEl, `Guardado. ${avisos.join(' ')}`, true);
    $('anual-texto').value = '';
    await loadAnual();
  } catch (err) {
    handleError(err, msgEl);
  }
}