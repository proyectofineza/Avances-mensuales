// Vista "Cierre de mes".
import * as API from '../api.js';
import { PESOS_MINORISTA, calcularReporte, estado, mesAnterior, mismoMesAnioAnterior, fmtMillones, fmtPct, fmtVar, fmtFecha, fmtDiaMes, fmtFechaHora, nombreMes, hoyAsuncion, ultimoDiaDelMes } from '../calc.js';
import { informeAHtml } from '../informe.js';
import { resumirMes, avanceSucursales, resumenZonas } from '../sucursales.js';
import { $, COLOR, barW, compartirTexto, contarNumeros, descargarCsv, esc, fechaDeMes, gauge, handleError, imprimir, isAdmin, state, sumarDias, varHtml } from './comun.js';
import { objetivos } from './objetivos.js';
import { suc } from './sucursales.js';

// ---------- Cierre de mes ----------
// Resumen final de un mes ya terminado: por defecto el anterior al actual.

export const cierre = { datos: null, suc: null, informe: null, turno: 0 };

export function setupCierre() {
  $('cierre-mes').addEventListener('change', () => { state.mesElegido = $('cierre-mes').value; loadCierre($('cierre-mes').value); });
  $('cierre-contenido').addEventListener('click', (e) => {
    const exp = e.target.closest('[data-cexp]');
    if (exp) { exportarCierre(exp.dataset.cexp); return; }
    const ir = e.target.closest('[data-cierre-suc]');
    if (ir) { suc.mesPedido = cierre.datos.mes; location.hash = 'sucursales'; return; }
    if (e.target.closest('[data-cargar-cierre]')) location.hash = 'ventas';
  });
}

export async function loadCierre(mes) {
  const turno = ++cierre.turno; // si se cambia de mes rápido, gana el último pedido
  try {
    const datos = await API.getCierre(mes);
    if (turno !== cierre.turno) return;
    cierre.datos = datos;
    cierre.suc = null;
    cierre.informe = null;
    $('cierre-mes').innerHTML = datos.meses.length
      ? [...datos.meses].reverse().map((m) => `<option value="${m}"${m === datos.mes ? ' selected' : ''}>${nombreMes(fechaDeMes(m))}</option>`).join('')
      : '<option value="">Sin datos</option>';
    renderCierre();
    if (!datos.mes) return;
    const [s, cfg, inf] = await Promise.all([
      API.getSucursales(datos.mes).catch(() => null),
      API.getSucursalesConfig(datos.mes).catch(() => null),
      API.getInforme(datos.mes).catch(() => null),
    ]);
    if (turno !== cierre.turno) return;
    cierre.suc = s?.mes === datos.mes && s.filas.length ? { filas: s.filas, cfg: cfg || {} } : false;
    cierre.informe = inf?.informe || false;
    $('cierre-suc').innerHTML = cierreSucursalesHtml();
    $('cierre-informe').innerHTML = cierreInformeHtml();
    contarNumeros($('cierre-suc'));
  } catch (err) {
    handleError(err);
  }
}

// Estado de una unidad al cierre: con el mes completo se mide lo vendido; si no, la proyección.
export function estadoCierre(pct, completo) {
  if (!completo) return estado(pct);
  if (pct >= 1) return { texto: 'Cumplido', clase: 'ok' };
  if (pct >= 0.9) return { texto: 'Cerca', clase: 'warn' };
  return { texto: 'No cumplido', clase: 'risk' };
}

export function cierreDatos() {
  const d = cierre.datos;
  const rep = d.reporte;
  const fin = ultimoDiaDelMes(fechaDeMes(d.mes));
  return { d, rep, r: calcularReporte(rep), fin, completo: rep.corte >= fin, nombre: nombreMes(fechaDeMes(d.mes)) };
}

export function renderCierre() {
  const el = $('cierre-contenido');
  if (!cierre.datos?.reporte) {
    $('cierre-titulo').textContent = 'Cierre de mes';
    $('cierre-sub').textContent = '';
    el.innerHTML = '<div class="card empty">Todavía no hay meses publicados.</div>';
    return;
  }
  const { d, rep, r, fin, completo, nombre } = cierreDatos();
  const t = r.total;
  const pct = completo ? t.avance : t.proyeccionPct;
  const e = estadoCierre(pct, completo);
  const dif = (completo ? t.real : t.proyeccion) - t.objetivo;
  $('cierre-titulo').textContent = `Cierre de ${nombre}`;
  $('cierre-sub').textContent = `Ventas hasta el ${fmtFecha(rep.corte)}${rep.publicadoEn ? ` · publicado ${fmtFechaHora(rep.publicadoEn)}` : ''}${rep.por ? ` por ${rep.por}` : ''}`;

  const aviso = completo
    ? `<div class="cierre-estado ok"><span><b>Mes completo:</b> ventas hasta el ${fmtFecha(fin)}.</span></div>`
    : `<div class="cierre-estado warn">
        <div><b>El cierre todavía no está completo.</b> El último reporte llega hasta el ${fmtFecha(rep.corte)} y el mes terminó el ${fmtFecha(fin)}.
        ${isAdmin() ? `Cargá las ventas finales con fecha de corte al ${fmtFecha(fin)} y publicá.` : 'Mientras tanto, los números son la proyección al cierre.'}</div>
        ${isAdmin() ? '<button class="btn btn-sm btn-primary" type="button" data-cargar-cierre>Cargar el cierre</button>' : ''}
      </div>`;

  const cmp = (lbl, v, base) => `
    <div class="proy-cmp">
      <span>vs ${esc(lbl)}</span>
      ${v === null ? '<b class="var-na">Sin dato</b>' : `<b class="${v >= 0 ? 'hl-ok' : 'hl-risk'}">${fmtVar(v)}</b>`}
      <small>${base > 0 ? `Cierre ${fmtMillones(base)}` : 'Sin dato cargado'}</small>
    </div>`;

  const filas = [
    { nombre: 'Baratote', c: r.baratote, color: COLOR.bar.fuerte, clase: 'grupo-row' },
    { nombre: 'Mayorista', c: r.unidades.may, color: COLOR.may.fuerte, clase: 'sub-row' },
    { nombre: 'Minorista', c: r.unidades.min, color: COLOR.min.fuerte, clase: 'sub-row' },
    { nombre: 'Fineglass', c: r.unidades.fgl, color: COLOR.fgl.fuerte, clase: '' },
    { nombre: 'Fineboats', c: r.unidades.fbt, color: COLOR.fbt.fuerte, clase: '' },
    { nombre: 'Total', c: t, color: 'var(--text)', clase: 'total-row' },
  ].map(({ nombre: n, c, color, clase }) => {
    const v = completo ? c.real : c.proyeccion;
    const p = c.objetivo > 0 ? v / c.objetivo : 0;
    const est = estadoCierre(p, completo);
    return `
      <tr${clase ? ` class="${clase}"` : ''}>
        <td data-label="Unidad"><i class="dot" style="background:${color}"></i>${esc(n)}</td>
        <td class="r opc" data-label="Objetivo">${fmtMillones(c.objetivo)}</td>
        <td class="r" data-label="${completo ? 'Venta final' : 'Proyección'}">${fmtMillones(v)}</td>
        <td class="r" data-label="Cumplimiento"><b>${fmtPct(p)}</b><div class="cierre-bar"><div style="width:${barW(p).toFixed(1)}%;background:${color}"></div><i></i></div></td>
        <td class="r opc ${v - c.objetivo >= 0 ? 'var-pos' : 'var-neg'}" data-label="Diferencia">${v - c.objetivo >= 0 ? '+' : '−'}${fmtMillones(Math.abs(v - c.objetivo))}</td>
        <td class="r opc" data-label="vs mes ant.">${varHtml(c.varAnt)}</td>
        <td class="r opc" data-label="vs año ant.">${varHtml(c.varAa)}</td>
        <td data-label="Estado"><span class="chip ${est.clase}">${est.texto}</span></td>
      </tr>`;
  }).join('');

  // Cómo terminó el mes: proyección total en cada publicación.
  const serie = d.history.map((h) => ({ corte: h.corte, v: calcularReporte(h).total.proyeccionPct }));
  const evol = serie.length >= 2 ? `
    <div class="card cierre-evol">
      <h2>Cómo se movió la proyección</h2>
      <p class="muted small" style="margin:4px 0 10px">Proyección del total sobre el objetivo en cada publicación del mes.</p>
      <div class="cierre-evol-lista">${serie.map((s) => `<span><small>${fmtDiaMes(s.corte)}</small><b class="${s.v >= 1 ? 'hl-ok' : s.v < 0.9 ? 'hl-risk' : ''}">${fmtPct(s.v)}</b></span>`).join('')}</div>
    </div>` : '';

  el.innerHTML = `
    ${aviso}
    <section class="proy-hero cierre-hero" aria-label="Resultado del mes">
      <div class="proy-top">
        <div class="proy-main">
          <span class="proy-label">${completo ? 'Venta final' : 'Proyección al cierre'} · ${esc(nombre)}</span>
          <div class="proy-amount" data-contar>${fmtMillones(completo ? t.real : t.proyeccion)}</div>
          <div class="proy-state"><span class="chip ${e.clase}">${e.texto}</span><span>Objetivo ${fmtMillones(t.objetivo)}</span></div>
          <p class="proy-brecha">${dif >= 0 ? `Superó el objetivo por <b class="hl-ok">${fmtMillones(dif)}</b>` : `Faltaron <b class="hl-risk">${fmtMillones(-dif)}</b> para el objetivo`}</p>
        </div>
        ${gauge(pct, e.clase === 'ok' ? 'ok' : e.clase === 'warn' ? 'warn' : 'risk')}
        <div class="proy-cmps">
          ${cmp(mesAnterior(rep.corte), t.varAnt, t.ant)}
          ${cmp(mismoMesAnioAnterior(rep.corte), t.varAa, t.aa)}
        </div>
      </div>
      ${rep.sinComparativa ? '<p class="proy-nota">Este mes se publicó antes de que se guardara la comparativa del cierre: no hay datos de mes anterior ni de año anterior.</p>' : ''}
    </section>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head">
        <h2>Resultado por unidad</h2>
        <div class="exportar" role="group" aria-label="Exportar">
          <button class="btn btn-sm" type="button" data-cexp="excel" title="Descargar para Excel">Excel</button>
          <button class="btn btn-sm" type="button" data-cexp="pdf" title="Imprimir o guardar como PDF">PDF</button>
          <button class="btn btn-sm" type="button" data-cexp="compartir" title="Compartir el resumen">Compartir</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="cierre-tabla tarjetas">
          <thead><tr><th>Unidad</th><th class="r opc">Objetivo</th><th class="r">${completo ? 'Venta final' : 'Proyección'}</th><th class="r">Cumplimiento</th><th class="r opc">Diferencia</th><th class="r opc">vs ${esc(mesAnterior(rep.corte))}</th><th class="r opc">vs ${esc(mismoMesAnioAnterior(rep.corte))}</th><th>Estado</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>

    ${evol}
    <div id="cierre-suc">${cierre.suc === null ? '<div class="card empty">Cargando sucursales…</div>' : cierreSucursalesHtml()}</div>
    <div id="cierre-informe">${cierre.informe === null ? '' : cierreInformeHtml()}</div>`;
  contarNumeros(el);
}

// Sucursales del mes: total, mejores y peores, zonas y objetivos.
export function cierreSucursales() {
  const { filas, cfg } = cierre.suc;
  const cerradas = new Set((cfg.cerradas || []).map((c) => c.sucursal));
  const res = resumirMes(filas);
  const abiertas = res.sucursales.filter((s) => !cerradas.has(s.sucursal));
  const hasta = res.dias.at(-1).fecha;
  const objetivos = (cfg.objetivos?.filas || []).filter((o) => !cerradas.has(o.sucursal));
  const avance = avanceSucursales(res, objetivos, hasta, cierre.datos.reporte?.pesos || PESOS_MINORISTA, cierre.datos.reporte?.especiales || []);
  const zonas = cfg.maestro?.filas?.length ? resumenZonas(res, cfg.maestro.filas) : [];
  return { res, abiertas, cerradas, avance, zonas, hasta };
}

export function cierreSucursalesHtml() {
  if (!cierre.suc) {
    return cierre.suc === false ? `<div class="card empty" style="margin-bottom:16px">No hay ventas por sucursal cargadas de ${esc(nombreMes(fechaDeMes(cierre.datos.mes)))}.</div>` : '';
  }
  const { res, abiertas, cerradas, avance, zonas, hasta } = cierreSucursales();
  const lista = (arr) => arr.map((s, i) => `<li data-pos="${i + 1}"><span>${esc(s.sucursal)}</span><b>${fmtMillones(s.total)}</b></li>`).join('');
  const conObj = [...avance.values()];
  const cumplieron = conObj.filter((a) => a.avance >= 1).length;
  const lejos = [...avance.entries()].sort((a, b) => a[1].avance - b[1].avance).slice(0, 8);
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head">
        <div>
          <h2>Sucursales · Baratote Minorista</h2>
          <p class="muted small" style="margin:4px 0 0">Ventas cargadas hasta el ${fmtFecha(hasta)}.</p>
        </div>
        <button class="btn btn-sm" type="button" data-cierre-suc>Ver el detalle en Sucursales</button>
      </div>
      <div class="cierre-suc-kpis">
        <div><span>Venta Minorista</span><strong data-contar>${fmtMillones(res.total)}</strong></div>
        <div><span>Sucursales con venta</span><strong>${abiertas.length}</strong>${cerradas.size ? `<small>${cerradas.size} cerrada${cerradas.size === 1 ? '' : 's'}</small>` : ''}</div>
        <div><span>Promedio por sucursal</span><strong>${fmtMillones(res.total / Math.max(res.sucursales.length, 1))}</strong></div>
        ${conObj.length ? `<div><span>Cumplieron su objetivo</span><strong>${cumplieron} de ${conObj.length}</strong><small>${fmtPct(cumplieron / conObj.length)}</small></div>` : ''}
      </div>
      <div class="cierre-suc-grid">
        <div><h3>Las 5 que más vendieron</h3><ol class="cierre-lista">${lista(abiertas.slice(0, 5))}</ol></div>
        <div><h3>Las 5 que menos vendieron</h3><ol class="cierre-lista">${lista(abiertas.slice(-5).reverse())}</ol></div>
        ${lejos.length ? `<div><h3>Más lejos de su objetivo</h3><ol class="cierre-lista">${lejos.map(([n, a]) => `<li><span>${esc(n)}</span><b class="${a.avance >= 1 ? 'hl-ok' : 'hl-risk'}">${fmtPct(a.avance)}</b></li>`).join('')}</ol></div>` : ''}
        ${zonas.length ? `<div><h3>Por ciudad</h3><ol class="cierre-lista">${zonas.map((z) => `<li><span>${esc(z.zona)}</span><b>${fmtMillones(z.total)}</b></li>`).join('')}</ol></div>` : ''}
      </div>
    </div>`;
}

export function cierreInformeHtml() {
  if (!cierre.informe) return '';
  return `
    <details class="card informe cierre-informe-card">
      <summary><h2>Análisis del mes (IA)</h2><span class="muted small">Publicado ${fmtFechaHora(cierre.informe.publicado)} · tocá para ver</span></summary>
      <div class="informe-texto">${informeAHtml(cierre.informe.texto)}</div>
    </details>`;
}

export function exportarCierre(formato) {
  if (!cierre.datos?.reporte) return;
  const { d, r, completo, nombre } = cierreDatos();
  const filas = [['Baratote', r.baratote], ['Mayorista', r.unidades.may], ['Minorista', r.unidades.min], ['Fineglass', r.unidades.fgl], ['Fineboats', r.unidades.fbt], ['Total', r.total]];
  const valor = (c) => (completo ? c.real : c.proyeccion);
  if (formato === 'pdf') { imprimir(`Cierre ${nombre}`); return; }
  if (formato === 'excel') {
    const tabla = [['Unidad', 'Objetivo', completo ? 'Venta final' : 'Proyección', 'Cumplimiento', 'Diferencia', 'vs mes anterior', 'vs año anterior', 'Estado'],
      ...filas.map(([n, c]) => [n, c.objetivo, Math.round(valor(c)), fmtPct(valor(c) / (c.objetivo || 1)), Math.round(valor(c) - c.objetivo), fmtVar(c.varAnt), fmtVar(c.varAa), estadoCierre(valor(c) / (c.objetivo || 1), completo).texto])];
    if (cierre.suc) {
      const { abiertas, avance } = cierreSucursales();
      tabla.push([], ['Sucursal', 'Venta del mes', 'Objetivo', 'Cumplimiento'],
        ...abiertas.map((s) => { const a = avance.get(s.sucursal); return [s.sucursal, s.total, a?.objetivo ?? '', a ? fmtPct(a.avance) : '']; }));
    }
    descargarCsv(`cierre-${d.mes}.csv`, tabla);
    return;
  }
  const t = r.total;
  const lineas = [
    `Cierre de ${nombre}${completo ? '' : ' (todavía incompleto: proyección)'}`,
    `Total: ${fmtMillones(valor(t))} · ${fmtPct(valor(t) / (t.objetivo || 1))} del objetivo (${fmtMillones(t.objetivo)})`,
    `vs ${mesAnterior(d.reporte.corte)}: ${fmtVar(t.varAnt)} · vs ${mismoMesAnioAnterior(d.reporte.corte)}: ${fmtVar(t.varAa)}`,
    '',
    ...filas.slice(0, -1).map(([n, c]) => `- ${n}: ${fmtPct(valor(c) / (c.objetivo || 1))} (${fmtMillones(valor(c))})`),
  ];
  if (cierre.suc) {
    const { abiertas } = cierreSucursales();
    lineas.push('', 'Sucursales que más vendieron:', ...abiertas.slice(0, 5).map((s, i) => `${i + 1}. ${s.sucursal} — ${fmtMillones(s.total)}`));
  }
  compartirTexto(`Cierre ${nombre}`, lineas.join('\n'));
}

// Aviso en el dashboard los primeros días del mes (o si el mes nuevo todavía no se publicó).
export function avisoCierreHtml(p) {
  const hoy = hoyAsuncion();
  const mesHoy = hoy.slice(0, 7);
  const mesPub = p.corte.slice(0, 7);
  const anterior = sumarDias(`${mesHoy}-01`, -1).slice(0, 7);
  if (mesPub < mesHoy) {
    return `<div class="cierre-aviso"><span>Todavía no se publicó ${esc(nombreMes(`${mesHoy}-01`).split(' ')[0].toLowerCase())}: estos son los números de ${esc(nombreMes(p.corte))}.</span><a class="btn btn-sm" href="#cierre">Ver el cierre de ${esc(nombreMes(p.corte).split(' ')[0].toLowerCase())}</a></div>`;
  }
  if (Number(hoy.slice(8)) <= 10) {
    return `<div class="cierre-aviso"><span>Ya podés ver cómo terminó ${esc(nombreMes(`${anterior}-01`))}.</span><a class="btn btn-sm" href="#cierre">Ver el cierre</a></div>`;
  }
  return '';
}