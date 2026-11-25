// Sucursales: mapa de calor, informe IA y comparar días.
import * as API from '../api.js';
import { DIAS_SEMANA, estado, fmtMillones, fmtMiles, fmtVar, fmtFecha, fmtDiaMes, fmtFechaHora, nombreMes } from '../calc.js';
import { armarContexto, textoParaCopiar, informeAHtml, MAX_TEXTO } from '../informe.js';
import { compararDias, mismoDiaSemana, ultimoDiaCompleto, ultimasSemanas, NO_MINORISTA } from '../sucursales.js';
import { $, DIA_CORTO, contarNumeros, esFinde, esc, fechaDeMes, fmtM1, handleError, isAdmin, pluralDia, showMsg, sumarDias, varClase, varHtml, wdDe } from './comun.js';
import { exportarHtml, suc } from './sucursales.js';

// ---- Mapa de calor ----
// Modo "propio": cada día contra lo que esa sucursal vende normalmente ese día de la semana
// (verde = mejor que lo habitual, rojo = peor). Modo "monto": todas en la misma escala.

export const LETRA_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
export const CALOR_TOPE = 0.4; // ±40% ya es el color más fuerte
export const CALOR_INICIAL = 30;

// Promedio de cada sucursal por día de la semana (solo días con venta).
export function promediosPorDiaSemana(s) {
  const suma = Array(7).fill(0), n = Array(7).fill(0);
  for (const [f, v] of Object.entries(s.dias)) {
    if (!v) continue;
    const wd = wdDe(f);
    suma[wd] += v;
    n[wd]++;
  }
  return suma.map((x, i) => (n[i] ? x / n[i] : 0));
}

export function colorCalor(v, ref, modo) {
  if (!v) return 'var(--sin-venta)';
  if (modo === 'monto') return `color-mix(in srgb, var(--calor-alto) ${(Math.min(v / ref, 1) * 100).toFixed(0)}%, var(--calor-bajo))`;
  if (!ref) return 'var(--calor-neutro)';
  const t = Math.max(-1, Math.min(1, (v / ref - 1) / CALOR_TOPE));
  return t >= 0
    ? `color-mix(in srgb, var(--pos) ${(t * 100).toFixed(0)}%, var(--calor-neutro))`
    : `color-mix(in srgb, var(--neg) ${(-t * 100).toFixed(0)}%, var(--calor-neutro))`;
}

export function calorHtml() {
  const res = suc.res;
  const c = suc.calor;
  const fechas = res.dias.map((x) => x.fecha);
  const maxGlobal = Math.max(...res.sucursales.flatMap((s) => Object.values(s.dias)), 1);
  const lista = c.todas ? res.sucursales : res.sucursales.slice(0, CALOR_INICIAL);
  const lun = (f) => (wdDe(f) === 1 ? ' lun' : '');
  const cabDia = fechas.map((f) => `<span class="${esFinde(wdDe(f)) ? 'finde' : ''}${lun(f)}">${LETRA_DIA[wdDe(f)]}</span>`).join('');
  const cabNum = fechas.map((f) => `<span class="${esFinde(wdDe(f)) ? 'finde' : ''}${lun(f)}">${Number(f.slice(8))}</span>`).join('');
  const filas = lista.map((s) => {
    const prom = promediosPorDiaSemana(s);
    const celdas = fechas.map((f) => {
      const v = s.dias[f] || 0;
      const ref = c.modo === 'monto' ? maxGlobal : prom[wdDe(f)];
      return `<i class="${lun(f).trim()}" style="background:${colorCalor(v, ref, c.modo)}" data-s="${esc(s.sucursal)}" data-f="${f}" data-v="${v}" data-p="${Math.round(prom[wdDe(f)])}" role="button" tabindex="-1" aria-label="${esc(s.sucursal)} ${fmtFecha(f)}"></i>`;
    }).join('');
    return `
      <div class="calor-fila">
        <button type="button" class="calor-nombre" data-suc="${esc(s.sucursal)}" title="Ver el detalle de ${esc(s.sucursal)}">${esc(s.sucursal)}</button>${celdas}
        <span class="calor-total">${fmtM1(s.total)}</span>
      </div>`;
  }).join('');

  const leyenda = c.modo === 'monto'
    ? `<div class="calor-escala monto"><span>menos venta</span><i></i><span>más venta</span></div>`
    : `<div class="calor-escala propio"><span>${fmtVar(-CALOR_TOPE)} o menos</span><i></i><span>${fmtVar(CALOR_TOPE)} o más</span></div>`;
  const explica = c.modo === 'monto'
    ? 'Todas las sucursales en la misma escala: cuanto más naranja, más vendió ese día. Sirve para ver las grandes y las chicas.'
    : 'Cada cuadrito es un día de una sucursal, comparado con lo que <b>esa misma sucursal</b> vende normalmente <b>ese día de la semana</b>. Verde: vendió más que lo habitual. Rojo: vendió menos. Gris: lo normal.';
  return `
    <div class="card">
      <div class="card-head" style="margin-bottom:10px">
        <div>
          <h2>Mapa de calor</h2>
          <p class="muted small">${explica}</p>
        </div>
        <div class="seg-btns" role="group" aria-label="Escala del mapa">
          <button type="button" data-calor-modo="propio" class="${c.modo === 'propio' ? 'active' : ''}">Vs. lo habitual</button>
          <button type="button" data-calor-modo="monto" class="${c.modo === 'monto' ? 'active' : ''}">Monto vendido</button>
        </div>
      </div>
      <div class="calor-pie">
        ${leyenda}
        <span class="calor-escala-sv"><i></i>sin venta</span>
      </div>
      <div class="calor-info" id="calor-info" role="status">Tocá un cuadrito para ver la venta de ese día. Tocá el nombre para ver el detalle de la sucursal.</div>
      <div class="calor-wrap">
        <div class="calor" style="--dias:${fechas.length}">
          <div class="calor-fila calor-cab"><span class="calor-nombre"></span>${cabDia}<span class="calor-total"></span></div>
          <div class="calor-fila calor-cab"><span class="calor-nombre">Sucursal</span>${cabNum}<span class="calor-total">Mes (M)</span></div>
          ${filas}
        </div>
      </div>
      ${res.sucursales.length > CALOR_INICIAL ? `<div class="actions" style="justify-content:center"><button class="btn btn-sm" type="button" data-calor-todas>${c.todas ? `Ver solo las ${CALOR_INICIAL} que más venden` : `Ver las ${res.sucursales.length} sucursales`}</button></div>` : ''}
    </div>`;
}

// Detalle de un cuadrito del mapa en la barra de arriba (sirve igual con mouse o con el dedo).
export function mostrarCeldaCalor(i) {
  const v = Number(i.dataset.v), p = Number(i.dataset.p), f = i.dataset.f;
  const nombreDia = DIAS_SEMANA.find((x) => x.wd === wdDe(f)).nombre.toLowerCase();
  const comp = v && p ? ` · ${varHtml(v / p - 1)} vs. sus ${pluralDia(nombreDia)} (${fmtM1Gs(p)})` : '';
  $('calor-info').innerHTML = `<b>${esc(i.dataset.s)}</b> · ${DIA_CORTO[wdDe(f)]} ${fmtFecha(f)}: ${v ? `<b>${fmtM1Gs(v)}</b>${comp}` : 'sin venta'}`;
  document.querySelectorAll('.calor i.sel').forEach((x) => x.classList.remove('sel'));
  i.classList.add('sel');
}

// ---- Informe IA ----

// El administrador copia un resumen de los datos, lo consulta en su chat de IA y pega
// acá la respuesta; los comerciales ven el análisis publicado.

export async function cargarInforme(mes) {
  suc.informe = { mes, datos: null, error: null, borrador: null };
  try {
    suc.informe.datos = await API.getInforme(mes);
  } catch (err) {
    suc.informe.error = err.message;
  }
  if (suc.sub === 'informe' && suc.datos?.mes === mes) $('suc-contenido').innerHTML = informeHtml();
}

export function pintarInforme() {
  if (suc.sub === 'informe') $('suc-contenido').innerHTML = informeHtml();
}

// Copia al portapapeles el texto para el chat: instrucciones + datos del mes resumidos.
export async function copiarParaIA() {
  const estado = $('inf-copiado');
  estado.textContent = 'Preparando…';
  let texto;
  try {
    const mes = suc.datos.mes;
    const [dash, clima, filasSemanas] = await Promise.all([
      API.getDashboard(),
      API.getClima(mes).catch(() => null), // sin clima el resumen sale igual
      filasHastaSemanas(4),
    ]);
    texto = textoParaCopiar(armarContexto({ mes, filas: suc.datos.filas, published: dash.published, clima, filasSemanas }));
  } catch (err) {
    estado.textContent = '';
    handleError(err, $('inf-msg'));
    return;
  }
  const area = $('inf-copia');
  area.value = texto;
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Sin permiso de portapapeles: se copia desde el cuadro de texto.
    area.closest('details').open = true;
    area.select();
    document.execCommand('copy');
  }
  estado.textContent = 'Copiado. Pegalo en tu chat de Claude.';
}

export async function publicarInforme() {
  const msgEl = $('inf-msg');
  const texto = $('inf-texto').value.trim();
  if (!texto) { showMsg(msgEl, 'Pegá el análisis antes de publicarlo.', false); return; }
  if (texto.length > MAX_TEXTO) { showMsg(msgEl, `El análisis es muy largo (máximo ${fmtMiles(MAX_TEXTO)} caracteres).`, false); return; }
  try {
    suc.informe.datos = await API.publicarInforme(suc.datos.mes, texto);
    suc.informe.borrador = null;
    pintarInforme();
    showMsg($('inf-msg'), 'Análisis publicado. Los comerciales ya lo pueden ver.', true);
  } catch (err) {
    handleError(err, msgEl);
  }
}

export async function borrarInformeMes() {
  if (!confirm('¿Borrar el análisis publicado de este mes? Los comerciales dejan de verlo.')) return;
  try {
    await API.borrarInforme(suc.datos.mes);
    suc.informe.datos = { informe: null, desactualizado: false };
    suc.informe.borrador = '';
    pintarInforme();
    showMsg($('inf-msg'), 'Se borró el análisis.', true);
  } catch (err) {
    handleError(err, $('inf-msg'));
  }
}

export function informeHtml() {
  const s = suc.informe;
  if (s.mes !== suc.datos.mes || (!s.datos && !s.error)) return '<div class="card empty">Cargando el análisis…</div>';
  const mesNombre = nombreMes(fechaDeMes(suc.datos.mes));
  const info = s.datos?.informe;

  const publicado = info
    ? `
      <div class="card informe">
        <div class="card-head">
          <div>
            <h2>Análisis del mes · ${esc(mesNombre)}</h2>
            <p class="muted small">Publicado ${fmtFechaHora(info.publicado)}${info.por ? ' por ' + esc(info.por) : ''}</p>
          </div>
          ${exportarHtml('informe', false)}
        </div>
        ${s.datos.desactualizado ? `<div class="alert informe-aviso">Se cargaron datos nuevos después de este análisis.${isAdmin() ? ' Podés prepararlo de nuevo abajo.' : ''}</div>` : ''}
        <div class="informe-texto">${informeAHtml(info.texto)}</div>
        <p class="nota">Análisis preparado con IA a partir de los datos del portal. Puede equivocarse: revisá las cifras antes de tomar decisiones.</p>
      </div>`
    : `<div class="card empty" style="margin-bottom:16px">Todavía no hay un análisis publicado de ${esc(mesNombre)}.${isAdmin() ? '' : ' Lo publica el administrador después de cargar los datos.'}</div>`;

  if (!isAdmin()) return publicado;

  const borrador = s.borrador ?? info?.texto ?? '';
  return `
    ${publicado}
    <div class="card informe informe-editor">
      <h2>${info ? 'Actualizar el análisis' : 'Preparar el análisis'}</h2>
      <div class="alert form-msg" id="inf-msg" hidden></div>
      ${s.error ? `<div class="alert alert-error" style="margin:12px 0">${esc(s.error)}</div>` : ''}
      <div class="inf-paso">
        <span class="inf-num">1</span>
        <div>
          <h3>Copiá los datos y consultalos en tu chat</h3>
          <p class="muted small">Se copia un resumen del mes (totales, ranking, alertas, clima de cada día y pronóstico, últimas 4 semanas, comparaciones y objetivos) junto con las instrucciones para el informe. No incluye las planillas completas.</p>
          <div class="actions" style="margin-top:10px">
            <button class="btn btn-primary" type="button" data-inf="copiar">Copiar para Claude</button>
            <a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;text-decoration:none">Abrir Claude</a>
            <span class="muted small" id="inf-copiado" role="status"></span>
          </div>
          <details class="inf-ver">
            <summary class="small">Ver el texto que se copia</summary>
            <textarea id="inf-copia" rows="6" readonly placeholder="Tocá Copiar para Claude para armarlo."></textarea>
          </details>
        </div>
      </div>
      <div class="inf-paso">
        <span class="inf-num">2</span>
        <div>
          <h3>Pegá la respuesta y publicala</h3>
          <p class="muted small">Pegá el informe tal como te lo devuelve el chat. Los títulos (##), las viñetas (-) y la **negrita** se ven ordenados para los comerciales.</p>
          <textarea id="inf-texto" rows="10" maxlength="${MAX_TEXTO}" placeholder="## Resumen&#10;…">${esc(borrador)}</textarea>
          <div class="actions">
            <button class="btn btn-primary" type="button" data-inf="publicar">${info ? 'Publicar cambios' : 'Publicar para los comerciales'}</button>
            ${info ? '<button class="btn btn-danger" type="button" data-inf="borrar">Borrar análisis</button>' : ''}
          </div>
          <p class="muted small" style="margin:14px 0 6px">Vista previa</p>
          <div class="informe-texto inf-preview" id="inf-preview">${borrador ? informeAHtml(borrador) : '<p class="muted">Acá vas a ver cómo queda.</p>'}</div>
        </div>
      </div>
    </div>`;
}

// ---- Comparar días ----

export const etiquetaDia = (fecha) => `${DIA_CORTO[wdDe(fecha)]} ${fmtDiaMes(fecha)}`;

// Filas de un mes (las del mes abierto ya están; otros meses se piden una vez).
export async function filasMes(mes) {
  if (!suc.cache[mes]) {
    try {
      const r = await API.getSucursales(mes);
      suc.cache[mes] = r.mes === mes ? r.filas : [];
    } catch {
      suc.cache[mes] = [];
    }
  }
  return suc.cache[mes];
}

export const fmtM1Gs = (v) => `Gs. ${fmtM1(v)} M`;

export function compararHtml() {
  const c = suc.cmp;
  const { fecha: ultima, incompleto } = ultimoDiaCompleto(suc.res.dias);
  c.incompleto = incompleto;
  if (!c.a || !c.a.startsWith(suc.datos.mes)) { c.a = ultima; c.b = sumarDias(ultima, -7); }
  if (c.wd === null) c.wd = wdDe(c.a);
  const controles = c.modo === 'par'
    ? `
      <div class="cmp-controles">
        <div><label for="cmp-a">Día</label><input type="date" id="cmp-a" value="${c.a}"></div>
        <div><label for="cmp-b">Contra</label><input type="date" id="cmp-b" value="${c.b}"></div>
        <div class="cmp-rapidos">
          <button class="btn btn-sm" type="button" data-cmp-rap="semana">Mismo día, semana anterior</button>
          <button class="btn btn-sm" type="button" data-cmp-rap="dia">Día anterior</button>
        </div>
      </div>`
    : c.modo === 'semana'
      ? `
      <div class="cmp-controles">
        <div><label for="cmp-wd">Día de la semana</label>
          <select id="cmp-wd">${DIAS_SEMANA.map((x) => `<option value="${x.wd}"${x.wd === c.wd ? ' selected' : ''}>${x.nombre}</option>`).join('')}</select>
        </div>
      </div>`
      : `<p class="muted small" style="margin:0">Semanas de lunes a domingo, hasta la semana del ${etiquetaDia(ultima)} (último día completo). Si la semana en curso está incompleta, se compara contra los mismos días de la semana anterior.</p>`;
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head" style="margin-bottom:12px">
        <div>
          <h2>Comparar días</h2>
          <p class="muted small">Venta de Baratote Minorista${NO_MINORISTA.length ? ` (sin ${NO_MINORISTA.join(', ')})` : ''}, en el total y por sucursal.</p>
        </div>
        <div class="seg-btns" role="group" aria-label="Tipo de comparación">
          <button type="button" data-cmodo="par" class="${c.modo === 'par' ? 'active' : ''}">Un día contra otro</button>
          <button type="button" data-cmodo="semana" class="${c.modo === 'semana' ? 'active' : ''}">Mismo día de la semana</button>
          <button type="button" data-cmodo="semanas" class="${c.modo === 'semanas' ? 'active' : ''}">Últimas 4 semanas</button>
        </div>
      </div>
      ${controles}
      <div class="cmp-exportar">${exportarHtml('comparar')}</div>
      ${c.incompleto && c.modo === 'par' ? `<p class="muted small" style="margin:12px 0 0">El ${etiquetaDia(c.incompleto.fecha)} parece incompleto (${fmtMillones(c.incompleto.monto)}, mucho menos que un ${DIAS_SEMANA.find((x) => x.wd === wdDe(c.incompleto.fecha)).nombre.toLowerCase()} normal), por eso arranca comparando el ${etiquetaDia(ultima)}. Podés elegir cualquier fecha.</p>` : ''}
    </div>
    <div id="cmp-res"><div class="card empty">Calculando…</div></div>`;
}

export let cmpTurno = 0;

export async function renderComparacion() {
  const el = $('cmp-res');
  if (!el) return;
  const turno = ++cmpTurno; // si cambian los filtros mientras se pide otro mes, gana el último
  const c = suc.cmp;
  let html;
  if (c.modo === 'par') {
    const [filasA, filasB] = await Promise.all([filasMes(c.a.slice(0, 7)), filasMes(c.b.slice(0, 7))]);
    if (turno !== cmpTurno) return;
    const r = compararDias(filasA, c.a, filasB, c.b);
    suc.cmpUltimo = { modo: 'par', r };
    html = comparacionParHtml(r);
  } else if (c.modo === 'semanas') {
    const filas = await filasHastaSemanas(4);
    if (turno !== cmpTurno) return;
    const r = ultimasSemanas(filas, ultimoDiaCompleto(suc.res.dias).fecha, 4);
    suc.cmpUltimo = { modo: 'semanas', r };
    html = comparacionSemanasHtml(r);
  } else {
    const r = mismoDiaSemana(suc.datos.filas, c.wd);
    suc.cmpUltimo = { modo: 'semana', r };
    html = comparacionSemanaHtml(r);
  }
  // Mantener el foco y el cursor en el buscador mientras se escribe.
  const buscando = document.activeElement?.id === 'cmp-buscar' ? document.activeElement.selectionStart : null;
  el.innerHTML = html;
  if (buscando === null) contarNumeros(el); // al escribir en el buscador no se repite la animación
  if (buscando !== null) {
    const b = $('cmp-buscar');
    b.focus();
    b.setSelectionRange(buscando, buscando);
  }
}

// Orden de la tabla: las que más cayeron, las que más subieron, o todas por venta.
export function ordenarPorVariacion(lista, clave) {
  const conVar = lista.filter((s) => s[clave] !== null);
  if (suc.cmp.orden === 'caidas') return conVar.sort((x, y) => x[clave] - y[clave]).slice(0, 10);
  if (suc.cmp.orden === 'subas') return conVar.sort((x, y) => y[clave] - x[clave]).slice(0, 10);
  return lista;
}

export function controlesTabla(total) {
  const o = suc.cmp.orden;
  return `
    <div class="card-head">
      <div class="seg-btns" role="group" aria-label="Qué sucursales mostrar">
        <button type="button" data-corden="caidas" class="${o === 'caidas' ? 'active' : ''}">Más cayeron</button>
        <button type="button" data-corden="subas" class="${o === 'subas' ? 'active' : ''}">Más subieron</button>
        <button type="button" data-corden="todas" class="${o === 'todas' ? 'active' : ''}">Todas (${total})</button>
      </div>
      <input id="cmp-buscar" class="suc-buscar" type="search" placeholder="Buscar sucursal" value="${esc(suc.cmp.filtro)}" aria-label="Buscar sucursal">
    </div>`;
}

export function filtrarCmp(lista) {
  const q = suc.cmp.filtro.trim().toUpperCase();
  return q ? lista.filter((s) => s.sucursal.includes(q)) : null;
}

export function comparacionParHtml(r) {
  const t = r.total;
  if (!t.a && !t.b) {
    return `<div class="card empty">No hay ventas cargadas para el ${fmtFecha(r.fechaA)} ni para el ${fmtFecha(r.fechaB)}.</div>`;
  }
  const sinDato = (fecha, v) => (v ? '' : `<small class="var-neg">Sin datos cargados del ${fmtFecha(fecha)}</small>`);
  const filtradas = filtrarCmp(r.sucursales);
  const lista = filtradas || ordenarPorVariacion([...r.sucursales], 'variacion');
  const dejaron = r.sucursales.filter((s) => s.b > 0 && !s.a).length;
  const nuevas = r.sucursales.filter((s) => s.a > 0 && !s.b).length;
  const filas = lista.map((s) => `
    <tr data-suc="${esc(s.sucursal)}" class="suc-row" tabindex="0">
      <td><b>${esc(s.sucursal)}</b></td>
      <td class="r">${fmtM1Gs(s.a)}</td>
      <td class="r">${fmtM1Gs(s.b)}</td>
      <td class="r opc ${s.diferencia >= 0 ? 'var-pos' : 'var-neg'}">${s.diferencia >= 0 ? '+' : '−'}${fmtM1(Math.abs(s.diferencia))} M</td>
      <td class="r">${s.variacion === null ? '<span class="muted small">no vendía</span>' : varHtml(s.variacion)}</td>
    </tr>`).join('');
  return `
    <div class="cmp-tot">
      <div><span>${etiquetaDia(r.fechaA)}</span><strong data-contar>${fmtMillones(t.a)}</strong><small>${r.conVentaA} sucursales con venta</small>${sinDato(r.fechaA, t.a)}</div>
      <div><span>${etiquetaDia(r.fechaB)}</span><strong data-contar>${fmtMillones(t.b)}</strong><small>${r.conVentaB} sucursales con venta</small>${sinDato(r.fechaB, t.b)}</div>
      <div class="cmp-tot-var"><span>Variación</span><strong class="${varClase(t.variacion)}">${fmtVar(t.variacion)}</strong><small>${t.diferencia >= 0 ? '+' : '−'}${fmtMillones(Math.abs(t.diferencia))}</small></div>
    </div>
    ${dejaron || nuevas ? `<p class="muted small" style="margin:0 0 12px">${dejaron ? `${dejaron} sucursal${dejaron === 1 ? '' : 'es'} vendieron el ${fmtDiaMes(r.fechaB)} y no el ${fmtDiaMes(r.fechaA)}. ` : ''}${nuevas ? `${nuevas} vendieron el ${fmtDiaMes(r.fechaA)} y no el ${fmtDiaMes(r.fechaB)}.` : ''}</p>` : ''}
    <div class="card">
      ${controlesTabla(r.sucursales.length)}
      <div class="table-wrap">
        <table class="suc-tabla">
          <thead><tr><th>Sucursal</th><th class="r">${etiquetaDia(r.fechaA)}</th><th class="r">${etiquetaDia(r.fechaB)}</th><th class="r opc">Diferencia</th><th class="r">Variación</th></tr></thead>
          <tbody>${filas || '<tr><td colspan="5" class="muted">No hay sucursales para mostrar.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted small" style="margin:12px 0 0">${filtradas ? `${lista.length} resultado${lista.length === 1 ? '' : 's'}.` : suc.cmp.orden === 'todas' ? `${lista.length} sucursales, de la que más vendió el ${fmtDiaMes(r.fechaA)} a la que menos.` : 'Las 10 con mayor cambio. Tocá una sucursal para ver su detalle del mes.'}</p>
    </div>`;
}

// Filas de todos los meses que tocan las últimas n semanas (pueden ser dos meses).
export async function filasHastaSemanas(n) {
  const hasta = ultimoDiaCompleto(suc.res.dias).fecha;
  const lunes = sumarDias(hasta, -((wdDe(hasta) + 6) % 7) - 7 * (n - 1));
  const meses = [...new Set([lunes.slice(0, 7), hasta.slice(0, 7)])];
  return (await Promise.all(meses.map(filasMes))).flat();
}

export const rangoSemana = (s) => `${fmtDiaMes(s.desde)}–${fmtDiaMes(s.hasta)}`;
// En celular, de varias columnas de fechas solo se muestran las dos últimas.
export const opcSi = (i, n) => (i < n - 2 ? ' opc' : '');

export function comparacionSemanasHtml(r) {
  const max = Math.max(...r.semanas.map((s) => s.total), 1);
  const ultima = r.semanas.length - 1;
  const columnas = r.semanas.map((s, i) => `
    <div class="cmp-sem-col${s.completa ? '' : ' incompleta'}">
      <span class="cmp-sem-val">${s.total ? fmtMillones(s.total) : '—'}</span>
      <div class="cmp-sem-bar"><div style="height:${((s.total / max) * 100).toFixed(1)}%"></div></div>
      <span class="cmp-sem-fecha">${rangoSemana(s)}</span>
      <small>${s.variacion === null ? '&nbsp;' : varHtml(s.variacion)}${!s.completa && s.variacion !== null ? ' <span class="muted">vs mismos días</span>' : ''}</small>
      <small class="muted">${s.diasCargados === 7 ? '7 de 7 días' : s.diasCargados ? `${s.diasCargados} de 7 días${i === ultima ? ' · en curso' : ' cargados'}` : 'sin datos'}</small>
    </div>`).join('');
  const filtradas = filtrarCmp(r.sucursales);
  const lista = filtradas || ordenarPorVariacion([...r.sucursales], 'variacion');
  const comp = r.comparacionSucursales;
  const colVar = comp ? `Sem. ${fmtDiaMes(comp.desde)} vs ${fmtDiaMes(comp.contra)}` : 'Variación';
  const filas = lista.map((s) => `
    <tr data-suc="${esc(s.sucursal)}" class="suc-row" tabindex="0">
      <td><b>${esc(s.sucursal)}</b></td>
      ${s.valores.map((v, i, a) => `<td class="r${opcSi(i, a.length)}">${v ? fmtM1(v) : '<span class="muted">0</span>'}</td>`).join('')}
      <td class="r">${s.variacion === null ? '—' : varHtml(s.variacion)}</td>
    </tr>`).join('');
  return `
    <div class="card" style="margin-bottom:16px">
      <h3>Últimas 4 semanas</h3>
      <p class="muted small" style="margin:4px 0 0">Venta total de cada semana (lunes a domingo) y variación contra la semana anterior.</p>
      <div class="cmp-sem">${columnas}</div>
    </div>
    <div class="card">
      ${controlesTabla(r.sucursales.length)}
      <div class="table-wrap">
        <table class="suc-tabla">
          <thead><tr><th>Sucursal</th>${r.semanas.map((s, i, a) => `<th class="r${opcSi(i, a.length)}">${rangoSemana(s)}</th>`).join('')}<th class="r">${colVar}</th></tr></thead>
          <tbody>${filas || `<tr><td colspan="${r.semanas.length + 2}" class="muted">No hay sucursales para mostrar.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="muted small" style="margin:12px 0 0">Montos en millones. La variación por sucursal compara las dos últimas semanas completas.${filtradas ? ` ${lista.length} resultado${lista.length === 1 ? '' : 's'}.` : suc.cmp.orden === 'todas' ? '' : ' Se muestran las 10 con mayor cambio.'}</p>
    </div>`;
}

export function comparacionSemanaHtml(r) {
  const nombre = DIAS_SEMANA.find((x) => x.wd === suc.cmp.wd)?.nombre || '';
  if (!r.fechas.length) return `<div class="card empty">No hay ${pluralDia(nombre.toLowerCase())} cargados en este mes.</div>`;
  const max = Math.max(...r.totales, 1);
  const columnas = r.fechas.map((f, i) => `
    <div class="cmp-sem-col">
      <span class="cmp-sem-val">${fmtMillones(r.totales[i])}</span>
      <div class="cmp-sem-bar"><div style="height:${((r.totales[i] / max) * 100).toFixed(1)}%"></div></div>
      <span class="cmp-sem-fecha">${fmtDiaMes(f)}</span>
      <small>${r.variaciones[i] === null ? '&nbsp;' : varHtml(r.variaciones[i])}</small>
    </div>`).join('');
  const filtradas = filtrarCmp(r.sucursales);
  const lista = filtradas || ordenarPorVariacion([...r.sucursales], 'ultimaVariacion');
  const ultimas = r.fechas.length >= 2 ? `${fmtDiaMes(r.fechas.at(-1))} vs ${fmtDiaMes(r.fechas.at(-2))}` : '';
  const filas = lista.map((s) => `
    <tr data-suc="${esc(s.sucursal)}" class="suc-row" tabindex="0">
      <td><b>${esc(s.sucursal)}</b></td>
      ${s.valores.map((v, i, a) => `<td class="r${opcSi(i, a.length)}">${v ? fmtM1(v) : '<span class="muted">0</span>'}</td>`).join('')}
      <td class="r">${s.ultimaVariacion === null ? '—' : varHtml(s.ultimaVariacion)}</td>
    </tr>`).join('');
  return `
    <div class="card" style="margin-bottom:16px">
      <h3>Todos los ${pluralDia(nombre.toLowerCase())} del mes</h3>
      <p class="muted small" style="margin:4px 0 0">Total de las sucursales cada ${nombre.toLowerCase()} y variación contra el ${nombre.toLowerCase()} anterior.</p>
      <div class="cmp-sem">${columnas}</div>
    </div>
    <div class="card">
      ${controlesTabla(r.sucursales.length)}
      <div class="table-wrap">
        <table class="suc-tabla">
          <thead><tr><th>Sucursal</th>${r.fechas.map((f, i, a) => `<th class="r${opcSi(i, a.length)}">${fmtDiaMes(f)}</th>`).join('')}<th class="r">${ultimas || 'Variación'}</th></tr></thead>
          <tbody>${filas || `<tr><td colspan="${r.fechas.length + 2}" class="muted">No hay sucursales para mostrar.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="muted small" style="margin:12px 0 0">Montos en millones. ${filtradas ? `${lista.length} resultado${lista.length === 1 ? '' : 's'}.` : suc.cmp.orden === 'todas' ? 'De la que más vende a la que menos.' : `Las 10 con mayor cambio entre el ${ultimas}.`}</p>
    </div>`;
}