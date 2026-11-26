// Vista "Sucursales": resumen, ranking, matriz, supervisores, zonas, alertas y panel de detalle.
import * as API from '../api.js';
import { DIAS_SEMANA, PESOS_MINORISTA, parseCorte, fraccionPonderada, estado, fmtMillones, fmtMiles, fmtPct, fmtVar, fmtFecha, fmtDiaMes, fmtFechaHora, nombreMes, hoyAsuncion } from '../calc.js';
import { informeAHtml } from '../informe.js';
import { resumirMes, alertasSucursales, pesoSemana, ultimoDiaCompleto, NO_MINORISTA, parseFecha, avanceSucursales, resumenZonas, zonaSugerida } from '../sucursales.js';
import { resumenSupervisores, mejorasSucursales, matrizSucursales, coberturaMatriz, mesAnioAnterior, mesPrevio as mesPrevioRep } from '../reportes.js';
import { cierre } from './cierre.js';
import { $, COLOR, DIA_CORTO, bar, compartirTexto, contarNumeros, currentView, descargarCsv, esFinde, esc, fechaDeMes, fmtM1, guardarPref, handleError, icono, imprimir, isAdmin, leerArchivo, leerPref, pluralDia, showMsg, showNotice, state, sumarDias, varHtml, wdDe } from './comun.js';
import { objetivos } from './objetivos.js';
import { borrarMesSucursales, cargarObjetivosConfig, guardarPlanilla, pintarEstadoConfig, pintarHorario, revisarPlanilla, setupConfigSucursales, setupPortalSucursales } from './suc-admin.js';
import { borrarInformeMes, calorHtml, cargarInforme, compararHtml, copiarParaIA, etiquetaDia, informeHtml, mostrarCeldaCalor, publicarInforme, rangoSemana, renderComparacion } from './suc-analisis.js';

export const suc = {
  datos: null, lectura: null, filtro: '', sub: leerPref('suc-sub', 'resumen'), rank: 'top', res: null, alertas: null,
  // Comparar días: modo 'par' (un día contra otro) o 'semana' (todos los mismos días del mes).
  cmp: { modo: 'par', a: null, b: null, wd: null, orden: 'caidas', filtro: '' },
  cache: {}, // filas por mes, para comparar contra otros meses
  // Mapa de calor: escala ('propio' = vs. lo habitual de la sucursal, 'monto') y si muestra todas.
  calor: { modo: 'propio', todas: false },
  // Listado maestro y objetivos del mes (/api/sucursales-config); filtros del ranking.
  config: { maestro: null, objetivos: null }, info: new Map(), cerradas: new Map(), cfgObj: null, avance: new Map(), zona: '', encargado: '', supervisor: '',
  // Matriz cumplimiento vs crecimiento: totales por mes de cada sucursal y base ('anio' | 'mes').
  mensual: null, matrizBase: null,
  // Análisis del mes abierto: respuesta de /api/informe, último error y texto que se está editando.
  informe: { mes: null, datos: null, error: null, borrador: null },
  // Venta por hora (días cargados con hora): detalle del mes y filtro ('' | 'z:ZONA' | 's:SUCURSAL').
};
// Pesos por día de la semana de Minorista: los publicados si el reporte es de ese mes.
export const pesosDelMes = (mes) => (suc.published?.corte?.startsWith(mes) && suc.published.pesos) || PESOS_MINORISTA;
// Las fechas especiales valen para cualquier mes (cada una tiene su fecha).
export const especialesDelMes = () => suc.published?.especiales || [];
// Zona de una sucursal: la del listado maestro o, si no hay listado, la sugerida por el nombre.
// Hay ciudades cargadas si alguna fila del listado tiene ciudad (el listado puede tener solo supervisores).
export const hayCiudades = () => [...suc.info.values()].some((m) => m.zona);
export const zonaDe = (nombre) => suc.info.get(nombre)?.zona || (hayCiudades() ? 'SIN CIUDAD' : zonaSugerida(nombre));

export const chipCerrada = (nombre) => (suc.cerradas.has(nombre)
  ? ` <span class="chip" title="Cerrada desde el ${fmtFecha(suc.cerradas.get(nombre))}: no genera alertas ni se mide contra objetivo">Cerrada</span>`
  : '');

// Estado contra el objetivo de la sucursal (proyección ponderada al cierre).
export function avanceChip(nombre) {
  const a = suc.avance.get(nombre);
  if (!a) return '';
  const e = estado(a.proyeccionPct);
  return `<span class="chip ${e.clase}" title="Avance ${fmtPct(a.avance)} · proyecta ${fmtMillones(a.proyeccion)} de ${fmtMillones(a.objetivo)}">${fmtPct(a.proyeccionPct)}</span>`;
}

export function setupSucursales() {
  $('suc-mes').addEventListener('change', () => { state.mesElegido = $('suc-mes').value; loadSucursales($('suc-mes').value); });
  $('suc-subtabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sub]');
    if (!b) return;
    elegirSubSucursal(b.dataset.sub);
  });
  $('suc-contenido').addEventListener('input', (e) => {
    if (e.target.id === 'suc-buscar') {
      suc.filtro = e.target.value;
      renderRankingTabla();
    } else if (e.target.id === 'cmp-buscar') {
      suc.cmp.filtro = e.target.value;
      renderComparacion();
    } else if (e.target.id === 'inf-texto') {
      // Vista previa mientras se pega o edita, sin repintar el editor.
      suc.informe.borrador = e.target.value;
      $('inf-preview').innerHTML = e.target.value.trim() ? informeAHtml(e.target.value) : '<p class="muted">Acá vas a ver cómo queda.</p>';
    }
  });
  $('suc-contenido').addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'cmp-a') suc.cmp.a = e.target.value || suc.cmp.a;
    else if (id === 'cmp-b') suc.cmp.b = e.target.value || suc.cmp.b;
    else if (id === 'cmp-wd') suc.cmp.wd = Number(e.target.value);
    else if (id === 'suc-zona' || id === 'suc-encargado' || id === 'suc-supervisor') {
      suc[id.slice(4)] = e.target.value;
      renderRankingTabla();
      return;
    } else return;
    renderComparacion();
  });
  $('suc-contenido').addEventListener('click', (e) => {
    const exp = e.target.closest('[data-exp]');
    if (exp) { exportar(exp.dataset.exp, exp.dataset.formato); return; }
    const modo = e.target.closest('[data-cmodo]');
    if (modo) { suc.cmp.modo = modo.dataset.cmodo; $('suc-contenido').innerHTML = compararHtml(); renderComparacion(); return; }
    const rapido = e.target.closest('[data-cmp-rap]');
    if (rapido) {
      const dias = rapido.dataset.cmpRap === 'semana' ? 7 : 1;
      suc.cmp.b = sumarDias(suc.cmp.a, -dias);
      $('cmp-b').value = suc.cmp.b;
      renderComparacion();
      return;
    }
    const orden = e.target.closest('[data-corden]');
    if (orden) { suc.cmp.orden = orden.dataset.corden; renderComparacion(); return; }
    const celda = e.target.closest('.calor i[data-f]');
    if (celda) { mostrarCeldaCalor(celda); return; }
    const calorModo = e.target.closest('[data-calor-modo]');
    if (calorModo) { suc.calor.modo = calorModo.dataset.calorModo; $('suc-contenido').innerHTML = calorHtml(); return; }
    if (e.target.closest('[data-calor-todas]')) { suc.calor.todas = !suc.calor.todas; $('suc-contenido').innerHTML = calorHtml(); return; }
    const inf = e.target.closest('[data-inf]');
    if (inf) {
      if (inf.dataset.inf === 'copiar') copiarParaIA();
      else if (inf.dataset.inf === 'publicar') publicarInforme();
      else if (inf.dataset.inf === 'borrar') borrarInformeMes();
      return;
    }
    const ir = e.target.closest('[data-ir]');
    if (ir) {
      if (ir.dataset.rank) suc.rank = ir.dataset.rank;
      elegirSubSucursal(ir.dataset.ir);
      return;
    }
    const mb = e.target.closest('[data-matriz-base]');
    if (mb) { suc.matrizBase = mb.dataset.matrizBase; $('suc-contenido').innerHTML = matrizHtml(); return; }
    const rank = e.target.closest('[data-rank]');
    if (rank) {
      suc.rank = rank.dataset.rank;
      renderRankingTabla();
      return;
    }
    const fila = e.target.closest('[data-suc]');
    if (fila) abrirPanel(fila.dataset.suc);
  });
  $('suc-contenido').addEventListener('mouseover', (e) => {
    const celda = e.target.closest('.calor i[data-f]');
    if (celda) mostrarCeldaCalor(celda);
  });
  $('suc-contenido').addEventListener('keydown', (e) => {
    const fila = e.target.closest('[data-suc]');
    if (fila && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirPanel(fila.dataset.suc); }
  });
  $('suc-panel-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cerrar]');
    if (b) marcarCerrada(b.dataset.nombre, b.dataset.cerrar || null);
    const sup = e.target.closest('[data-sup-guardar]');
    if (sup) guardarSupervisor(sup.dataset.supGuardar, $('panel-sup').value.trim(), sup);
  });
  $('suc-panel-cerrar').addEventListener('click', cerrarPanel);
  $('suc-panel-fondo').addEventListener('click', cerrarPanel);
  // Con el buscador abierto encima, Esc cierra solo el buscador.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('suc-panel').hidden && !$('buscador').open) cerrarPanel(); });
  // Barra de pestañas: en el celular se desliza; el degradé a la derecha avisa que hay más y se va al llegar al final.
  $('suc-subtabs').addEventListener('scroll', marcarFinPestanas, { passive: true });
  window.addEventListener('resize', marcarFinPestanas);
  if (!isAdmin()) return;

  // Las tres cajas de administración (planilla, configuración, portal) quedan detrás de un solo botón.
  $('suc-admin-btn').addEventListener('click', () => mostrarAdminSucursales($('suc-admin').hidden));
  if (leerPref('suc-admin', 'no') === 'si') mostrarAdminSucursales(true);

  $('suc-mes-carga').value = hoyAsuncion().slice(0, 7);
  $('suc-archivo').addEventListener('change', async () => {
    const archivo = $('suc-archivo').files[0];
    if (!archivo) return;
    $('suc-texto').value = await leerArchivo(archivo);
    revisarPlanilla();
  });
  $('suc-leer').addEventListener('click', revisarPlanilla);
  $('suc-mes-carga').addEventListener('change', () => { if (suc.lectura || $('suc-texto').value) revisarPlanilla(); });
  $('suc-texto').addEventListener('input', () => {
    suc.lectura = null;
    $('suc-guardar').disabled = true;
    $('suc-preview').textContent = '';
  });
  $('suc-guardar').addEventListener('click', guardarPlanilla);
  $('suc-borrar-mes').addEventListener('click', borrarMesSucursales);
  API.getTeams().then((t) => { $('suc-teams-box').hidden = !t.configurado; }).catch(() => {});
  setupConfigSucursales();
  setupPortalSucursales();
}

export const lineaSuc = (s, i) => `${i + 1}. ${s.sucursal} — ${fmtMillones(s.total)}`;

// Datos de cada vista para exportar: { titulo, archivo, tabla?, texto }.
export function datosExportar(que) {
  const mes = suc.datos.mes;
  const mesNombre = nombreMes(fechaDeMes(mes));
  const res = suc.res;
  if (que === 'ranking' && suc.rank === 'mejoran') {
    const enFiltro = new Set(rankingFiltrado().map((s) => s.sucursal));
    const lista = mejorasDelMes().filter((m) => enFiltro.has(m.sucursal));
    const tabla = [['Sucursal', 'Proyección hace 7 días', 'Proyección hoy', 'Cambio (puntos)', 'Venta últimos 7 días'],
      ...lista.map((m) => [m.sucursal, fmtPct(m.antes), fmtPct(m.ahora), Math.round(m.cambio * 1000) / 10, Math.round(m.ventaPeriodo)])];
    const texto = [`Las que más mejoraron en los últimos 7 días · ${mesNombre}`, '',
      ...lista.slice(0, 10).map((m, i) => `${i + 1}. ${m.sucursal}: ${fmtPct(m.antes)} → ${fmtPct(m.ahora)} (${fmtPuntos(m.cambio)})`)].join('\n');
    return { titulo: `Más mejoraron ${mesNombre}`, archivo: `mejoraron-${mes}`, tabla, texto };
  }
  if (que === 'ranking') {
    let lista = rankingFiltrado();
    if (suc.rank === 'riesgo') lista = lista.filter((s) => suc.avance.has(s.sucursal)).sort((a, b) => suc.avance.get(a.sucursal).proyeccionPct - suc.avance.get(b.sucursal).proyeccionPct);
    const filtro = [suc.zona && `ciudad ${suc.zona}`, suc.supervisor && `supervisor ${suc.supervisor}`, suc.encargado && `encargado ${suc.encargado}`, suc.filtro.trim() && `"${suc.filtro.trim()}"`].filter(Boolean).join(', ');
    const tabla = [['Puesto', 'Sucursal', 'Ciudad', 'Supervisor', 'Encargado', 'Venta del mes', '% del total', 'Promedio por día', 'Días con venta', 'Objetivo', 'Avance', 'Proyección al cierre', 'Estado'],
      ...lista.map((s) => {
        const a = suc.avance.get(s.sucursal);
        return [s.puesto, s.sucursal, zonaDe(s.sucursal), suc.info.get(s.sucursal)?.supervisor || '', suc.info.get(s.sucursal)?.encargado || '', s.total, fmtPct(s.total / (res.total || 1)),
          Math.round(s.total / Math.max(s.diasConVenta, 1)), s.diasConVenta, a?.objetivo ?? '', a ? fmtPct(a.avance) : '', a ? fmtPct(a.proyeccionPct) : '', a ? estado(a.proyeccionPct).texto : ''];
      })];
    const partes = [`Ranking de sucursales · Baratote Minorista · ${mesNombre}${filtro ? ` (${filtro})` : ''}`, `Total: ${fmtMillones(lista.reduce((t, s) => t + s.total, 0))} en ${lista.length} sucursales.`];
    partes.push('', 'Más venden:', ...lista.slice(0, 5).map(lineaSuc));
    if (lista.length > 5) partes.push('', 'Menos venden:', ...lista.slice(-5).reverse().map((s, i) => `${i + 1}. ${s.sucursal} — ${fmtMillones(s.total)}`));
    const riesgo = lista.filter((s) => suc.avance.get(s.sucursal)?.proyeccionPct < 0.9).sort((a, b) => suc.avance.get(a.sucursal).proyeccionPct - suc.avance.get(b.sucursal).proyeccionPct);
    if (riesgo.length) partes.push('', `En riesgo de no llegar al objetivo (${riesgo.length}):`, ...riesgo.slice(0, 8).map((s) => `- ${s.sucursal}: proyecta ${fmtPct(suc.avance.get(s.sucursal).proyeccionPct)}`));
    return { titulo: `Ranking sucursales ${mesNombre}`, archivo: `ranking-sucursales-${mes}`, tabla, texto: partes.join('\n') };
  }
  if (que === 'zonas') {
    const zonas = zonasDelMes();
    const tabla = [['Ciudad', 'Sucursales', 'Venta del mes', '% del total', 'Objetivo', 'Proyección al cierre', 'Proyección / objetivo'],
      ...zonas.map((z) => [z.zona, z.sucursales.length, z.total, fmtPct(z.total / (res.total || 1)), z.objetivo || '', z.objetivo ? Math.round(z.proyeccion) : '', z.objetivo ? fmtPct(z.proyeccion / z.objetivo) : ''])];
    const texto = [`Venta por ciudad · Baratote Minorista · ${mesNombre}`, '',
      ...zonas.map((z) => `- ${z.zona}: ${fmtMillones(z.total)} (${fmtPct(z.total / (res.total || 1))}, ${z.sucursales.length} suc.)${z.objetivo ? ` · proyecta ${fmtPct(z.proyeccion / z.objetivo)} del objetivo` : ''}`)].join('\n');
    return { titulo: `Ventas por ciudad ${mesNombre}`, archivo: `ciudades-${mes}`, tabla, texto };
  }
  if (que === 'supervisores') {
    const grupos = resumenSupervisores(res, suc.avance, [...suc.info.values()]);
    const tabla = [['Supervisor', 'Sucursales', 'En verde', 'En amarillo', 'En rojo', 'Sin objetivo', 'Venta del mes', 'Objetivo', 'Proyección al cierre', 'Proyección / objetivo'],
      ...grupos.map((g) => [g.supervisor, g.sucursales.length, g.verdes, g.amarillas, g.rojas, g.sinObjetivo, g.total, g.objetivo || '', g.objetivo ? Math.round(g.proyeccion) : '', g.pct === null ? '' : fmtPct(g.pct)])];
    const texto = [`Cumplimiento por supervisor · Baratote Minorista · ${mesNombre}`, '',
      ...grupos.map((g) => `- ${g.supervisor}: ${g.sucursales.length} suc. · ${g.verdes} en verde, ${g.amarillas} en amarillo, ${g.rojas} en rojo${g.pct === null ? '' : ` · proyecta ${fmtPct(g.pct)} del objetivo`}`)].join('\n');
    return { titulo: `Supervisores ${mesNombre}`, archivo: `supervisores-${mes}`, tabla, texto };
  }
  if (que === 'comparar') return datosExportarComparacion();
  if (que === 'informe') {
    const info = suc.informe.datos?.informe;
    if (!info) return null;
    return { titulo: `Análisis ${mesNombre}`, archivo: `analisis-${mes}`, texto: `Análisis del mes · ${mesNombre}\n\n${info.texto}` };
  }
  return null;
}

export function datosExportarComparacion() {
  const u = suc.cmpUltimo;
  if (!u) return null;
  const r = u.r;
  const top = (lista, clave, signo) => lista.filter((s) => s[clave] !== null && Math.sign(s[clave]) === signo)
    .sort((a, b) => signo * (b[clave] - a[clave])).slice(0, 5).map((s) => `- ${s.sucursal}: ${fmtVar(s[clave])}`);
  let titulo, tabla, cabecera, clave;
  if (u.modo === 'par') {
    titulo = `${etiquetaDia(r.fechaA)} vs ${etiquetaDia(r.fechaB)}`;
    tabla = [['Sucursal', etiquetaDia(r.fechaA), etiquetaDia(r.fechaB), 'Diferencia', 'Variación'],
      ...r.sucursales.map((s) => [s.sucursal, s.a, s.b, s.diferencia, s.variacion === null ? '' : fmtVar(s.variacion)])];
    cabecera = `Total: ${fmtMillones(r.total.a)} vs ${fmtMillones(r.total.b)} (${fmtVar(r.total.variacion)}).`;
    clave = 'variacion';
  } else if (u.modo === 'semanas') {
    titulo = 'Últimas 4 semanas';
    tabla = [['Sucursal', ...r.semanas.map(rangoSemana), 'Variación'], ...r.sucursales.map((s) => [s.sucursal, ...s.valores, s.variacion === null ? '' : fmtVar(s.variacion)])];
    cabecera = r.semanas.map((s) => `${rangoSemana(s)}: ${s.total ? fmtMillones(s.total) : '—'}${s.variacion === null ? '' : ` (${fmtVar(s.variacion)})`}`).join('\n');
    clave = 'variacion';
  } else {
    const nombre = DIAS_SEMANA.find((x) => x.wd === suc.cmp.wd)?.nombre || '';
    titulo = `Todos los ${pluralDia(nombre.toLowerCase())}`;
    tabla = [['Sucursal', ...r.fechas.map(fmtDiaMes), 'Variación'], ...r.sucursales.map((s) => [s.sucursal, ...s.valores, s.ultimaVariacion === null ? '' : fmtVar(s.ultimaVariacion)])];
    cabecera = r.fechas.map((f, i) => `${fmtDiaMes(f)}: ${fmtMillones(r.totales[i])}${r.variaciones[i] === null ? '' : ` (${fmtVar(r.variaciones[i])})`}`).join('\n');
    clave = 'ultimaVariacion';
  }
  const caen = top(r.sucursales, clave, -1), suben = top(r.sucursales, clave, 1);
  const texto = [`Comparación · ${titulo} · Baratote Minorista`, cabecera,
    ...(caen.length ? ['', 'Más cayeron:', ...caen] : []), ...(suben.length ? ['', 'Más subieron:', ...suben] : [])].join('\n');
  return { titulo: `Comparación ${titulo}`, archivo: `comparacion-${u.modo}-${suc.datos.mes}`, tabla, texto };
}

export function exportar(que, formato) {
  const d = datosExportar(que);
  if (!d) { showNotice('No hay datos para exportar.', true); return; }
  if (formato === 'excel' && d.tabla) descargarCsv(`${d.archivo}.csv`, d.tabla);
  else if (formato === 'pdf') imprimir(d.titulo);
  else compartirTexto(d.titulo, d.texto);
}

export async function loadSucursales(mes) {
  try {
    const [datos, dash] = await Promise.all([API.getSucursales(mes), API.getDashboard().catch(() => null)]);
    suc.datos = datos;
    suc.published = dash?.published || null; // objetivo de Minorista para el avance acumulado
    suc.config = await API.getSucursalesConfig(datos.mes || hoyAsuncion().slice(0, 7)).catch(() => ({ maestro: null, objetivos: null }));
    suc.info = new Map((suc.config.maestro?.filas || []).map((m) => [m.sucursal, m]));
    suc.cerradas = new Map((suc.config.cerradas || []).map((c) => [c.sucursal, c.fecha]));
    if (isAdmin()) {
      if ($('cfg-obj-mes').value === datos.mes) suc.cfgObj = suc.config.objetivos;
      else if (!suc.cfgObj) cargarObjetivosConfig();
      pintarEstadoConfig();
      pintarHorario();
    }
    suc.cache = {}; // puede haber cambiado una carga: se vuelven a pedir los otros meses
    suc.mensual = null; // totales por mes (matriz): se piden de nuevo al abrirla
    cerrarPanel();
    const sel = $('suc-mes');
    sel.innerHTML = suc.datos.meses.length
      ? [...suc.datos.meses].reverse().map((m) => `<option value="${m}"${m === suc.datos.mes ? ' selected' : ''}>${nombreMes(fechaDeMes(m))}</option>`).join('')
      : '<option value="">Sin datos</option>';
    if (isAdmin()) $('suc-borrar-mes').hidden = !suc.datos.mes;
    renderSucursales();
  } catch (err) {
    handleError(err);
  }
}

export const SUBS_SUCURSALES = ['resumen', 'informe', 'ranking', 'matriz', 'supervisores', 'zonas', 'calor', 'comparar', 'alertas'];

// Abre una pestaña de Sucursales. agregarAlHistorial: deja una entrada para que "atrás" vuelva a la anterior.
export function elegirSubSucursal(sub, agregarAlHistorial = true, pintar = true) {
  if (!SUBS_SUCURSALES.includes(sub)) { if (pintar) renderSucursales(); return; }
  const cambia = sub !== suc.sub;
  suc.sub = sub;
  guardarPref('suc-sub', sub);
  if (agregarAlHistorial && cambia) history.pushState(null, '', `#sucursales/${sub}`);
  if (pintar) renderSucursales();
}

// Muestra u oculta las cajas de administración de Sucursales (y recuerda la elección en este navegador).
export function mostrarAdminSucursales(si, recordar = true) {
  $('suc-admin').hidden = !si;
  $('suc-admin-btn').setAttribute('aria-expanded', String(si));
  $('suc-admin-btn').classList.toggle('active', si);
  if (recordar) guardarPref('suc-admin', si ? 'si' : 'no');
}

// La pestaña abierta queda a la vista en la barra (en el celular no entran las 9 a lo ancho).
function centrarPestanaActiva() {
  const nav = $('suc-subtabs');
  const b = nav.querySelector('.active');
  if (!b || nav.scrollWidth <= nav.clientWidth) { marcarFinPestanas(); return; }
  const rn = nav.getBoundingClientRect(), rb = b.getBoundingClientRect();
  if (rb.left < rn.left + 8 || rb.right > rn.right - 40) {
    nav.scrollTo({ left: nav.scrollLeft + (rb.left + rb.width / 2) - (rn.left + rn.width / 2), behavior: 'auto' });
  }
  marcarFinPestanas();
}

function marcarFinPestanas() {
  const nav = $('suc-subtabs');
  nav.classList.toggle('al-final', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 4);
}

export function renderSucursales() {
  const d = suc.datos;
  const el = $('suc-contenido');
  if (!d?.mes || !d.filas.length) {
    $('suc-sub').textContent = '';
    $('suc-subtabs').hidden = true;
    if (isAdmin()) { mostrarAdminSucursales(true, false); $('suc-carga').open = true; }
    el.innerHTML = `<div class="card empty">Todavía no hay ventas por sucursal cargadas.${isAdmin() ? ' Cargá la primera planilla arriba.' : ''}</div>`;
    return;
  }
  suc.res = resumirMes(d.filas);
  suc.alertas = alertasSucursales(suc.res, { cerradas: suc.cerradas.keys() });
  const objetivos = (suc.config?.objetivos?.filas || []).filter((o) => !suc.cerradas.has(o.sucursal));
  suc.avance = avanceSucursales(suc.res, objetivos, ultimoDiaCompleto(suc.res.dias).fecha, pesosDelMes(d.mes), especialesDelMes());
  const com = d.comerciales || [];
  const criterio = !com.length ? '' : ` · por día comercial ${com.length === 1 ? `el ${fmtDiaMes(com[0])}` : `del ${fmtDiaMes(com[0])} al ${fmtDiaMes(com.at(-1))}`}`;
  $('suc-sub').textContent = `${nombreMes(fechaDeMes(d.mes))} · actualizado ${fmtFechaHora(d.actualizado)}${d.por ? ' por ' + d.por : ''}${criterio}`;
  $('suc-sub').title = com.length ? 'Días cargados con hora: lo vendido después de medianoche y hasta el cierre cuenta para el día que abrió la noche anterior.' : '';

  const nAlertas = suc.alertas.sinVentaReciente.length + suc.alertas.caidas.length;
  $('suc-alertas-n').textContent = nAlertas;
  $('suc-alertas-n').hidden = nAlertas === 0;
  $('suc-subtabs').hidden = false;
  if (!SUBS_SUCURSALES.includes(suc.sub)) suc.sub = 'resumen';
  // La barra de direcciones refleja la pestaña abierta (#sucursales/ranking) para poder compartirla.
  if (currentView() === 'sucursales' && location.hash !== `#sucursales/${suc.sub}`) history.replaceState(null, '', `#sucursales/${suc.sub}`);
  suc.cache[d.mes] = d.filas;
  document.querySelectorAll('#suc-subtabs [data-sub]').forEach((b) => {
    const activa = b.dataset.sub === suc.sub;
    b.classList.toggle('active', activa);
    b.setAttribute('aria-selected', String(activa));
  });
  if (currentView() === 'sucursales') centrarPestanaActiva();

  if (suc.sub === 'ranking') { el.innerHTML = rankingHtml(); renderRankingTabla(); }
  else if (suc.sub === 'zonas') el.innerHTML = zonasHtml();
  else if (suc.sub === 'supervisores') el.innerHTML = supervisoresHtml();
  else if (suc.sub === 'matriz') { el.innerHTML = matrizHtml(); if (!suc.mensual) cargarMensual(); }
  else if (suc.sub === 'calor') el.innerHTML = calorHtml();
  else if (suc.sub === 'comparar') { el.innerHTML = compararHtml(); renderComparacion(); }
  else if (suc.sub === 'informe') { el.innerHTML = informeHtml(); if (suc.informe.mes !== d.mes) cargarInforme(d.mes); }
  else if (suc.sub === 'alertas') el.innerHTML = alertasHtml();
  else el.innerHTML = resumenSucHtml();
  contarNumeros(el);
}

export function resumenSucHtml() {
  const d = suc.datos;
  const res = suc.res;
  const c = parseCorte(fechaDeMes(d.mes));
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  const porDia = new Map(res.dias.map((x) => [x.fecha, x.monto]));
  const max = Math.max(...res.dias.map((x) => x.monto), 1);
  const mejor = res.dias.reduce((a, b) => (b.monto > a.monto ? b : a), res.dias[0]);
  const diasCargados = res.dias.length;

  // Columnas por día; viernes a domingo en el color fuerte.
  const cols = [], labels = [];
  for (let dd = 1; dd <= ultimo; dd++) {
    const fecha = `${d.mes}-${String(dd).padStart(2, '0')}`;
    const v = porDia.get(fecha);
    const wd = new Date(Date.UTC(c.y, c.m - 1, dd)).getUTCDay();
    const finde = wd === 5 || wd === 6 || wd === 0;
    cols.push(`<div class="sd-col" title="${DIA_CORTO[wd]} ${fmtFecha(fecha)}: ${v === undefined ? 'sin datos' : fmtMillones(v)}">
      <div style="height:${v ? ((v / max) * 100).toFixed(1) : 0}%;background:${finde ? COLOR.min.fuerte : 'var(--dia-normal)'}"></div></div>`);
    labels.push(`<span class="${finde ? 'finde' : ''}">${dd}</span>`);
  }

  const { peso, cuenta } = pesoSemana(res.dias);
  const pesos = pesosSemanaHtml(peso, cuenta);
  const finde = peso[5] + peso[6] + peso[0];
  const top5 = res.sucursales.slice(0, 5);
  const topMax = top5[0]?.total || 1;

  return `
    <div class="kpis">
      <div class="card kpi" style="--acento:var(--c-min)">
        <div class="kpi-top">${icono('venta')}<span class="kpi-label">Venta Minorista del mes</span></div>
        <span class="kpi-value" data-contar>${fmtMillones(res.total)}</span>
        <span class="kpi-sub">${diasCargados} día${diasCargados === 1 ? '' : 's'} cargado${diasCargados === 1 ? '' : 's'} · hasta el ${fmtFecha(res.dias.at(-1).fecha)}</span>
      </div>
      <div class="card kpi" style="--acento:var(--c-fbt)">
        <div class="kpi-top">${icono('tienda')}<span class="kpi-label">Sucursales con venta</span></div>
        <span class="kpi-value" data-contar>${res.sucursales.length}</span>
        <span class="kpi-sub">Promedio ${fmtMillones(res.total / Math.max(res.sucursales.length, 1))} por sucursal</span>
      </div>
      <div class="card kpi" style="--acento:var(--c-fgl)">
        <div class="kpi-top">${icono('calendario')}<span class="kpi-label">Promedio por día</span></div>
        <span class="kpi-value" data-contar>${fmtMillones(res.total / Math.max(diasCargados, 1))}</span>
        <span class="kpi-sub">Mejor día: ${DIA_CORTO[new Date(`${mejor.fecha}T12:00:00Z`).getUTCDay()]} ${fmtFecha(mejor.fecha)} · ${fmtMillones(mejor.monto)}</span>
      </div>
    </div>
    ${res.totalExcluido ? `<p class="muted small" style="margin:-8px 0 16px">${NO_MINORISTA.join(', ')} (Mayorista) no se incluye: ${fmtMillones(res.totalExcluido)} en el mes.</p>` : ''}

    ${avanceAcumuladoHtml()}

    <div class="dash-bottom">
      <div class="card">
        <h2>Venta por día</h2>
        <p class="muted small" style="margin:4px 0 0">Total de las sucursales cada día. Viernes a domingo en naranja fuerte.</p>
        <div class="sd-chart">${cols.join('')}</div>
        <div class="sd-labels">${labels.join('')}</div>
      </div>
      <div class="card">
        <h2>Peso por día de la semana</h2>
        <p class="muted small" style="margin:4px 0 0">Qué parte de la venta semanal se hace cada día, según este mes. Viernes a domingo: <b>${fmtPct(finde)}</b>.</p>
        <div class="sp-grid">${pesos}</div>
        ${isAdmin() ? '<p class="nota">Podés usar estos valores en Cargar ventas → Peso por día de la semana · Minorista.</p>' : ''}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <h2>Las 5 que más venden</h2>
        <button class="btn btn-sm" type="button" data-ir="ranking" data-rank="top">Ver ranking</button>
      </div>
      <div class="top5">${top5.map((s, i) => `
        <div class="top5-fila" data-suc="${esc(s.sucursal)}" role="button" tabindex="0">
          <span class="top5-n">${i + 1}</span>
          <span class="top5-nombre">${esc(s.sucursal)}</span>
          <span class="top5-bar"><span style="width:${((s.total / topMax) * 100).toFixed(1)}%"></span></span>
          <b>${fmtMillones(s.total)}</b>
        </div>`).join('')}</div>
    </div>`;
}

// ---- 1. Avance acumulado de Minorista: real día a día vs. el ritmo para llegar al objetivo ----
// El "ritmo" reparte el objetivo según el peso de cada día de la semana (el fin de semana pesa
// más), igual que la proyección ponderada. La proyección sigue esa misma curva hasta fin de mes.
export function avanceAcumuladoHtml() {
  const mes = suc.datos.mes;
  const res = suc.res;
  const c = parseCorte(fechaDeMes(mes));
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  const pub = suc.published?.corte?.startsWith(mes) ? suc.published : null;
  const pesos = pesosDelMes(mes);
  const objetivo = pub ? Number(pub.obj?.min) || 0 : 0;
  const fecha = (d) => `${mes}-${String(d).padStart(2, '0')}`;
  const frac = (d) => fraccionPonderada(fecha(d), pesos, especialesDelMes()) || 0;

  const porDia = new Map(res.dias.map((x) => [x.fecha, x.monto]));
  const { fecha: hasta } = ultimoDiaCompleto(res.dias);
  const dHasta = Number(hasta.slice(8));
  let acum = 0;
  const real = [];
  for (let d = 1; d <= dHasta; d++) { acum += porDia.get(fecha(d)) || 0; real.push([d, acum]); }
  const fHasta = frac(dHasta);
  const proyFinal = fHasta > 0 ? acum / fHasta : acum;
  const proy = [];
  for (let d = dHasta; d <= ultimo; d++) proy.push([d, fHasta > 0 ? (acum / fHasta) * frac(d) : acum]);
  const ideal = objetivo ? Array.from({ length: ultimo }, (_, i) => [i + 1, objetivo * frac(i + 1)]) : [];

  // Escalas del gráfico (SVG, en unidades del viewBox).
  const W = 640, H = 230, IZQ = 46, DER = 12, ARR = 14, ABA = 26;
  const yMax = Math.max(objetivo, proyFinal, acum, 1) * 1.08;
  const x = (d) => IZQ + ((d - 1) / Math.max(ultimo - 1, 1)) * (W - IZQ - DER);
  const y = (v) => ARR + (1 - v / yMax) * (H - ARR - ABA);
  const linea = (pts) => pts.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = real.length ? `${linea(real)} L${x(dHasta).toFixed(1)},${y(0)} L${x(1).toFixed(1)},${y(0)} Z` : '';
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((k) => yMax / 1.08 * k);
  const grilla = marcas.map((v) => `<line x1="${IZQ}" x2="${W - DER}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="ac-grilla"/><text x="${IZQ - 6}" y="${(y(v) + 4).toFixed(1)}" class="ac-eje" text-anchor="end">${fmtMiles(v / 1e6)}</text>`).join('');
  const dias = [1, 8, 15, 22, ultimo].filter((d, i, a) => a.indexOf(d) === i).map((d) => `<text x="${x(d).toFixed(1)}" y="${H - 8}" class="ac-eje" text-anchor="middle">${d}</text>`).join('');

  const debido = objetivo ? objetivo * fHasta : 0;
  const dif = acum - debido;
  const frase = objetivo
    ? `Al ${fmtFecha(hasta)} Minorista lleva <b>${fmtMillones(acum)}</b>. Para ir al ritmo del objetivo debería tener <b>${fmtMillones(debido)}</b>: va <b class="${dif >= 0 ? 'var-pos' : 'var-neg'}">${dif >= 0 ? 'adelantada' : 'atrasada'} ${fmtMillones(Math.abs(dif))}</b>. Proyecta cerrar en <b>${fmtMillones(proyFinal)}</b> (${fmtPct(proyFinal / objetivo)} del objetivo de ${fmtMillones(objetivo)}).`
    : `Al ${fmtFecha(hasta)} Minorista lleva <b>${fmtMillones(acum)}</b> y proyecta cerrar en <b>${fmtMillones(proyFinal)}</b>. No hay un objetivo publicado para este mes, por eso no se muestra la línea del ritmo.`;

  return `
    <div class="card avance-ac" style="margin-bottom:16px">
      <h2>Avance acumulado del mes</h2>
      <p class="small" style="margin:6px 0 0">${frase}</p>
      <svg class="ac-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Venta acumulada de Minorista contra el ritmo del objetivo">
        ${grilla}${dias}
        ${area ? `<path d="${area}" class="ac-area"/>` : ''}
        ${ideal.length ? `<path d="${linea(ideal)}" class="ac-ideal" pathLength="1"/>` : ''}
        ${proy.length > 1 ? `<path d="${linea(proy)}" class="ac-proy" pathLength="1"/>` : ''}
        ${real.length ? `<path d="${linea(real)}" class="ac-real" pathLength="1"/><circle cx="${x(dHasta).toFixed(1)}" cy="${y(acum).toFixed(1)}" r="4.5" class="ac-punto"/>` : ''}
      </svg>
      <div class="leyenda" style="margin:6px 0 0">
        <span><i class="sw" style="background:var(--c-min)"></i>Venta acumulada</span>
        ${objetivo ? '<span><i class="sw ideal-l"></i>Ritmo para llegar al objetivo</span>' : ''}
        <span><i class="sw proy-l"></i>Proyección</span>
        <span class="muted">Montos en millones · días del mes abajo</span>
      </div>
    </div>`;
}

export function pesosSemanaHtml(peso, cuenta) {
  return DIAS_SEMANA.map((x) => `
    <div class="sp-dia${esFinde(x.wd) ? ' finde' : ''}">
      <span>${x.nombre.slice(0, 3)}</span>
      <strong>${cuenta[x.wd] ? fmtPct(peso[x.wd]) : '—'}</strong>
      <small>${cuenta[x.wd]} día${cuenta[x.wd] === 1 ? '' : 's'}</small>
    </div>`).join('');
}

// ---- Ranking: 10 que más venden, 10 que menos, o todas; el buscador busca en todas ----

// Botones de exportar de una vista: data-exp = qué se exporta.
export const exportarHtml = (que, excel = true) => `
  <div class="exportar" role="group" aria-label="Exportar">
    ${excel ? `<button class="btn btn-sm" type="button" data-exp="${que}" data-formato="excel" title="Descargar para Excel">Excel</button>` : ''}
    <button class="btn btn-sm" type="button" data-exp="${que}" data-formato="pdf" title="Imprimir o guardar como PDF">PDF</button>
    <button class="btn btn-sm" type="button" data-exp="${que}" data-formato="compartir" title="Compartir el resumen">Compartir</button>
  </div>`;

export function rankingHtml() {
  const zonas = [...new Set([...suc.info.values()].map((m) => m.zona).filter(Boolean))].sort();
  const encargados = [...new Set([...suc.info.values()].map((m) => m.encargado).filter(Boolean))].sort();
  const supervisores = [...new Set([...suc.info.values()].map((m) => m.supervisor).filter(Boolean))].sort();
  if (!zonas.includes(suc.zona)) suc.zona = '';
  if (!encargados.includes(suc.encargado)) suc.encargado = '';
  if (!supervisores.includes(suc.supervisor)) suc.supervisor = '';
  const opciones = (arr, actual, todas) => `<option value="">${todas}</option>${arr.map((v) => `<option${v === actual ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
  return `
    <div class="card">
      <div class="card-head">
        <div class="seg-btns" role="group" aria-label="Qué sucursales mostrar">
          <button type="button" data-rank="top">Más venden</button>
          <button type="button" data-rank="bottom">Menos venden</button>
          ${suc.avance.size ? '<button type="button" data-rank="riesgo">Lejos del objetivo</button><button type="button" data-rank="mejoran">Más mejoraron</button>' : ''}
          <button type="button" data-rank="todas">Todas</button>
        </div>
        ${exportarHtml('ranking')}
      </div>
      <div class="rank-filtros">
        <input id="suc-buscar" class="suc-buscar" type="search" placeholder="Buscar sucursal" value="${esc(suc.filtro)}" aria-label="Buscar sucursal">
        ${zonas.length ? `<select id="suc-zona" aria-label="Ciudad">${opciones(zonas, suc.zona, 'Todas las ciudades')}</select>` : ''}
        ${supervisores.length ? `<select id="suc-supervisor" aria-label="Supervisor">${opciones(supervisores, suc.supervisor, 'Todos los supervisores')}</select>` : ''}
        ${encargados.length ? `<select id="suc-encargado" aria-label="Encargado">${opciones(encargados, suc.encargado, 'Todos los encargados')}</select>` : ''}
      </div>
      <div class="table-wrap" id="suc-ranking"></div>
      <p class="muted small" id="suc-ranking-pie" style="margin:12px 0 0"></p>
    </div>`;
}

// Sucursales del ranking con puesto general, según buscador, zona y encargado (sin el corte de 10).
export function rankingFiltrado() {
  const q = suc.filtro.trim().toUpperCase();
  return suc.res.sucursales
    .map((s, i) => ({ ...s, puesto: i + 1 }))
    .filter((s) => (!q || s.sucursal.includes(q))
      && (!suc.zona || suc.info.get(s.sucursal)?.zona === suc.zona)
      && (!suc.supervisor || suc.info.get(s.sucursal)?.supervisor === suc.supervisor)
      && (!suc.encargado || suc.info.get(s.sucursal)?.encargado === suc.encargado));
}

export function renderRankingTabla() {
  const res = suc.res;
  if (!res || !$('suc-ranking')) return;
  if ((suc.rank === 'riesgo' || suc.rank === 'mejoran') && !suc.avance.size) suc.rank = 'top';
  document.querySelectorAll('[data-rank]').forEach((b) => b.classList.toggle('active', b.dataset.rank === suc.rank));
  const base = rankingFiltrado();
  const filtrando = Boolean(suc.filtro.trim() || suc.zona || suc.encargado || suc.supervisor);
  if (suc.rank === 'mejoran') { renderMejoras(base, filtrando); return; }
  let lista;
  if (suc.rank === 'riesgo') {
    lista = base.filter((s) => suc.avance.has(s.sucursal)).sort((a, b) => suc.avance.get(a.sucursal).proyeccionPct - suc.avance.get(b.sucursal).proyeccionPct);
    if (!filtrando) lista = lista.slice(0, 10);
  } else if (filtrando || suc.rank === 'todas') lista = base;
  else if (suc.rank === 'bottom') lista = base.slice(-10).reverse();
  else lista = base.slice(0, 10);
  const hayZona = hayCiudades();
  const hayObj = suc.avance.size > 0;
  const top = res.sucursales[0]?.total || 1;
  const filas = lista.map((s) => {
    const a = suc.avance.get(s.sucursal);
    return `
    <tr data-suc="${esc(s.sucursal)}" class="suc-row" tabindex="0">
      <td class="muted">${s.puesto}</td>
      <td><b>${esc(s.sucursal)}</b>${chipCerrada(s.sucursal)}</td>
      ${hayZona ? `<td class="opc muted">${esc(zonaDe(s.sucursal))}</td>` : ''}
      <td class="r">${fmtMillones(s.total)}</td>
      ${hayObj ? `<td class="r">${a ? fmtMillones(a.objetivo) : '—'}</td><td class="r">${a ? fmtPct(a.avance) : '—'}</td><td class="r">${a ? avanceChip(s.sucursal) : '<span class="muted small">sin objetivo</span>'}</td>` : ''}
      <td class="r opc">${fmtPct(s.total / (res.total || 1))}</td>
      <td class="r opc">${fmtMillones(s.total / Math.max(s.diasConVenta, 1))}</td>
      ${hayObj ? '' : `<td class="r opc">${s.diasConVenta}</td>`}
      <td class="col-barra"><div class="rank-bar"><div style="width:${((s.total / top) * 100).toFixed(1)}%"></div></div></td>
    </tr>`;
  }).join('');
  const columnas = 6 + hayZona + (hayObj ? 2 : 0);
  $('suc-ranking').innerHTML = `
    <table class="suc-tabla">
      <thead><tr><th>#</th><th>Sucursal</th>${hayZona ? '<th class="opc">Ciudad</th>' : ''}<th class="r">Venta del mes</th>${hayObj ? '<th class="r" title="Objetivo del mes en guaraníes">Objetivo</th><th class="r" title="Venta hasta el último día completo sobre el objetivo del mes">Avance</th><th class="r" title="Proyección al cierre sobre el objetivo">Proyección</th>' : ''}<th class="r opc">% del total</th><th class="r opc">Prom./día</th>${hayObj ? '' : '<th class="r opc">Días</th>'}<th class="col-barra"></th></tr></thead>
      <tbody>${filas || `<tr><td colspan="${columnas + 1}" class="muted">No hay sucursales con ese filtro.</td></tr>`}</tbody>
    </table>`;
  $('suc-ranking-pie').innerHTML = filtrando
    ? `${lista.length} sucursal${lista.length === 1 ? '' : 'es'} con ese filtro.`
    : `Mostrando ${lista.length} de ${res.sucursales.length} sucursales. Tocá una para ver su detalle.${suc.rank !== 'todas' ? ' <button class="btn-link" type="button" data-rank="todas">Ver todas</button>' : ''}`;
}

// Las que más mejoraron: proyección contra el objetivo hoy vs. hace 7 días (en puntos).
export function mejorasDelMes() {
  const objetivos = (suc.config?.objetivos?.filas || []).filter((o) => !suc.cerradas.has(o.sucursal));
  return mejorasSucursales(suc.res, objetivos, { dias: 7, pesos: pesosDelMes(suc.datos.mes), especiales: especialesDelMes() });
}
export const fmtPuntos = (v) => `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(1).replace('.', ',')} pts`;

export function renderMejoras(base, filtrando) {
  const enFiltro = new Set(base.map((s) => s.sucursal));
  const puesto = new Map(base.map((s) => [s.sucursal, s.puesto]));
  const todas = mejorasDelMes();
  if (!todas.length) {
    $('suc-ranking').innerHTML = '<p class="muted" style="margin:8px 0">Todavía no hay una semana cargada en este mes para comparar. Aparece a partir del día 8.</p>';
    $('suc-ranking-pie').textContent = '';
    return;
  }
  let lista = todas.filter((m) => enFiltro.has(m.sucursal));
  if (!filtrando) lista = lista.slice(0, 10);
  const filas = lista.map((m, i) => `
    <tr data-suc="${esc(m.sucursal)}" class="suc-row" tabindex="0">
      <td class="muted">${i + 1}</td>
      <td><b>${esc(m.sucursal)}</b><small class="muted opc"> · puesto ${puesto.get(m.sucursal)} en venta</small></td>
      <td class="r">${fmtPct(m.antes)}</td>
      <td class="r">${avanceChip(m.sucursal)}</td>
      <td class="r"><b class="${m.cambio >= 0 ? 'var-pos' : 'var-neg'}">${fmtPuntos(m.cambio)}</b></td>
      <td class="r opc">${fmtMillones(m.ventaPeriodo)}</td>
    </tr>`).join('');
  $('suc-ranking').innerHTML = `
    <table class="suc-tabla">
      <thead><tr><th>#</th><th>Sucursal</th><th class="r" title="Proyección contra el objetivo hace 7 días">Hace 7 días</th><th class="r" title="Proyección contra el objetivo hoy">Hoy</th><th class="r" title="Cuánto cambió la proyección contra el objetivo">Cambio</th><th class="r opc" title="Venta de los últimos 7 días">Venta 7 días</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="6" class="muted">No hay sucursales con ese filtro.</td></tr>'}</tbody>
    </table>`;
  $('suc-ranking-pie').innerHTML = `Ordenadas por cuánto subió su proyección contra el objetivo en los últimos 7 días, sin importar cuánto venden: así se ve el esfuerzo de las chicas también.${!filtrando && todas.length > 10 ? ` Mostrando 10 de ${todas.length}.` : ''}`;
}

// ---- Matriz cumplimiento vs crecimiento ----

export async function cargarMensual() {
  try {
    suc.mensual = (await API.getMensualSucursales()).mensual || {};
  } catch (err) {
    suc.mensual = {};
    handleError(err);
  }
  if (suc.sub === 'matriz') $('suc-contenido').innerHTML = matrizHtml();
}

export const CUADRANTES = {
  estrella: { titulo: 'Cumplen y crecen', nota: 'Van bien: reconocerlas.', clase: 'ok' },
  facil: { titulo: 'Cumplen pero no crecen', nota: 'Llegan al objetivo vendiendo menos que antes: revisar si el objetivo fue bajo.', clase: 'warn' },
  empuje: { titulo: 'Crecen pero no llegan', nota: 'Venden más que antes pero no alcanza: un empujón y llegan.', clase: 'warn' },
  atencion: { titulo: 'Ni cumplen ni crecen', nota: 'Atención: venden menos que antes y no llegan al objetivo.', clase: 'risk' },
};

export function matrizHtml() {
  const mes = suc.datos.mes;
  if (!suc.avance.size) return '<div class="card empty">La matriz necesita los objetivos del mes por sucursal. Cargalos en <b>Configurar sucursales</b>.</div>';
  if (!suc.mensual) return '<div class="card empty">Cargando el historial de cada sucursal…</div>';
  const cob = coberturaMatriz(suc.avance, suc.mensual, mes);
  if (!cob.anio && !cob.mes) {
    return `<div class="card empty">Para medir el crecimiento hace falta la venta de cada sucursal del mes anterior o del mismo mes del año anterior. ${isAdmin() ? 'Cargá el historial en <b>Portal de sucursales → Historial por sucursal</b>.' : 'El administrador puede cargar el historial.'}</div>`;
  }
  if (!suc.matrizBase || !cob[suc.matrizBase]) suc.matrizBase = cob.anio >= cob.total / 2 || !cob.mes ? 'anio' : 'mes';
  const base = suc.matrizBase;
  const ref = base === 'anio' ? mesAnioAnterior(mes) : mesPrevioRep(mes);
  const refNombre = nombreMes(fechaDeMes(ref));
  const puntos = matrizSucursales(suc.avance, suc.mensual, mes, base);
  const con = puntos.filter((p) => p.crecimiento !== null);
  const sin = puntos.length - con.length;

  // Escalas: cumplimiento 50%–150% y crecimiento −50%…+50% (lo de afuera se dibuja en el borde).
  const W = 720, H = 420, IZQ = 52, DER = 16, ARR = 16, ABA = 40;
  const X0 = 0.5, X1 = 1.5, Y0 = -0.5, Y1 = 0.5;
  const lim = (v, a, b) => Math.min(Math.max(v, a), b);
  const x = (v) => IZQ + ((lim(v, X0, X1) - X0) / (X1 - X0)) * (W - IZQ - DER);
  const y = (v) => ARR + (1 - (lim(v, Y0, Y1) - Y0) / (Y1 - Y0)) * (H - ARR - ABA);
  const ejeX = [0.5, 0.75, 1, 1.25, 1.5].map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="${ARR}" y2="${H - ABA}" class="${v === 1 ? 'mz-cero' : 'ac-grilla'}"/><text x="${x(v)}" y="${H - ABA + 16}" class="ac-eje" text-anchor="middle">${Math.round(v * 100)}%${v === X0 ? ' o menos' : v === X1 ? ' o más' : ''}</text>`).join('');
  const ejeY = [-0.5, -0.25, 0, 0.25, 0.5].map((v) => `<line x1="${IZQ}" x2="${W - DER}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'mz-cero' : 'ac-grilla'}"/><text x="${IZQ - 6}" y="${y(v) + 4}" class="ac-eje" text-anchor="end">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%</text>`).join('');
  const rotulos = `
    <text x="${W - DER - 6}" y="${ARR + 14}" class="mz-rotulo" text-anchor="end">Cumplen y crecen</text>
    <text x="${W - DER - 6}" y="${H - ABA - 8}" class="mz-rotulo" text-anchor="end">Cumplen sin crecer</text>
    <text x="${IZQ + 6}" y="${ARR + 14}" class="mz-rotulo">Crecen pero no llegan</text>
    <text x="${IZQ + 6}" y="${H - ABA - 8}" class="mz-rotulo mz-rotulo-risk">Ni cumplen ni crecen</text>
    <text x="${(IZQ + W - DER) / 2}" y="${H - 4}" class="ac-eje" text-anchor="middle">Proyección contra el objetivo →</text>`;
  const circulos = con.map((p) => `<circle cx="${x(p.cumplimiento).toFixed(1)}" cy="${y(p.crecimiento).toFixed(1)}" r="6" class="mz-p mz-${estado(p.cumplimiento).clase}" data-suc="${esc(p.sucursal)}"><title>${esc(p.sucursal)}: proyecta ${fmtPct(p.cumplimiento)} del objetivo · ${fmtVar(p.crecimiento)} vs ${esc(refNombre)} (${fmtMillones(p.proyeccion)} vs ${fmtMillones(p.referencia)})</title></circle>`).join('');

  const grupos = Object.entries(CUADRANTES).map(([k, c]) => {
    const lista = con.filter((p) => p.cuadrante === k).sort((a, b) => (k === 'atencion' ? a.cumplimiento - b.cumplimiento : b.cumplimiento - a.cumplimiento));
    return `
      <details class="card zona mz-grupo"${k === 'atencion' && lista.length ? ' open' : ''}>
        <summary>
          <span class="zona-nombre">${c.titulo}<small class="muted">${c.nota}</small></span>
          <span class="chip ${c.clase}">${lista.length}</span>
        </summary>
        <ul class="zona-lista">${lista.map((p) => `
          <li data-suc="${esc(p.sucursal)}" role="button" tabindex="0">
            <span>${esc(p.sucursal)}</span>${avanceChip(p.sucursal)}<b class="${p.crecimiento >= 0 ? 'var-pos' : 'var-neg'}">${fmtVar(p.crecimiento)}</b>
          </li>`).join('') || '<li class="muted">Ninguna.</li>'}</ul>
      </details>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Cumplimiento vs crecimiento</h2>
          <p class="muted small" style="margin:4px 0 0">Cada punto es una sucursal. A la derecha de la línea, proyecta llegar al objetivo; arriba, vende más que en ${esc(refNombre)} (proyección del mes contra ese mes completo). Tocá un punto para ver la sucursal.</p>
        </div>
        <div class="seg-btns" role="group" aria-label="Crecimiento contra">
          <button type="button" data-matriz-base="anio" class="${base === 'anio' ? 'active' : ''}"${cob.anio ? '' : ' disabled'} title="${cob.anio} de ${cob.total} sucursales con dato">Vs. año anterior</button>
          <button type="button" data-matriz-base="mes" class="${base === 'mes' ? 'active' : ''}"${cob.mes ? '' : ' disabled'} title="${cob.mes} de ${cob.total} sucursales con dato">Vs. mes anterior</button>
        </div>
      </div>
      <svg class="mz-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Matriz de cumplimiento contra crecimiento de las sucursales">
        <text x="14" y="${(ARR + H - ABA) / 2}" class="ac-eje" text-anchor="middle" transform="rotate(-90 14 ${(ARR + H - ABA) / 2})">Crecimiento vs ${esc(refNombre)} →</text>
        ${ejeY}${ejeX}${rotulos}${circulos}
      </svg>
      <div class="leyenda" style="margin:6px 0 0">
        <span><i class="sw" style="background:var(--logro)"></i>Proyecta 100% o más</span>
        <span><i class="sw" style="background:#F59E0B"></i>90% a 100%</span>
        <span><i class="sw" style="background:#EF4444"></i>Menos de 90%</span>
        ${sin ? `<span class="muted">${sin} sucursal${sin === 1 ? '' : 'es'} sin venta en ${esc(refNombre)} no aparece${sin === 1 ? '' : 'n'}.</span>` : ''}
      </div>
    </div>
    <div class="zonas mz-grupos">${grupos}</div>`;
}

// ---- Por supervisor ----

// Asigna el supervisor desde el detalle de la sucursal, sin recargar todo el listado.
export async function guardarSupervisor(sucursal, supervisor, btn) {
  btn.disabled = true;
  try {
    const r = await API.asignarSupervisor(sucursal, supervisor);
    suc.config.maestro = r.maestro;
    suc.info = new Map((r.maestro.filas || []).map((m) => [m.sucursal, m]));
    showNotice(supervisor ? `${sucursal}: supervisor ${supervisor}.` : `${sucursal}: sin supervisor.`);
    renderSucursales();
    abrirPanel(sucursal);
  } catch (err) {
    handleError(err);
  } finally {
    btn.disabled = false;
  }
}

export function supervisoresHtml() {
  const maestro = [...suc.info.values()];
  if (!maestro.some((m) => m.supervisor)) {
    return `<div class="card empty">Todavía no hay supervisores asignados.${isAdmin()
      ? ' Asignalos de a uno desde el detalle de cada sucursal (tocá una sucursal en el Ranking), o cargá el listado con la columna <b>Supervisor</b> en <b>Configurar sucursales → Listado de sucursales</b>.'
      : ' El administrador los puede cargar.'}</div>`;
  }
  const grupos = resumenSupervisores(suc.res, suc.avance, maestro);
  const max = Math.max(...grupos.map((g) => g.total), 1);
  const semaforo = (g) => `<span class="sup-semaforo" title="${g.verdes} en verde, ${g.amarillas} en amarillo, ${g.rojas} en rojo${g.sinObjetivo ? `, ${g.sinObjetivo} sin objetivo` : ''}">${g.verdes ? `<span class="chip ok">${g.verdes}</span>` : ''}${g.amarillas ? `<span class="chip warn">${g.amarillas}</span>` : ''}${g.rojas ? `<span class="chip risk">${g.rojas}</span>` : ''}</span>`;
  const tarjetas = grupos.map((g) => {
    const e = g.pct !== null ? estado(g.pct) : null;
    return `
    <details class="card zona">
      <summary>
        <span class="zona-nombre">${esc(g.supervisor)}<small class="muted">${g.sucursales.length} sucursal${g.sucursales.length === 1 ? '' : 'es'}${g.objetivo ? ` · objetivo ${fmtMillones(g.objetivo)}` : ''}</small></span>
        <span class="zona-bar"><span style="width:${((g.total / max) * 100).toFixed(1)}%"></span></span>
        <span class="zona-cifras"><b>${fmtMillones(g.total)}</b>${semaforo(g)}</span>
        ${e ? `<span class="chip ${e.clase}" title="Proyección al cierre de sus sucursales sobre la suma de sus objetivos">${fmtPct(g.pct)}</span>` : ''}
      </summary>
      <ul class="zona-lista">${g.sucursales.map((s) => `
        <li data-suc="${esc(s.sucursal)}" role="button" tabindex="0">
          <span>${esc(s.sucursal)}${chipCerrada(s.sucursal)}</span>${avanceChip(s.sucursal)}<b>${fmtMillones(s.total)}${s.avance ? `<small class="muted zona-obj"> de ${fmtMillones(s.avance.objetivo)}</small>` : ''}</b>
        </li>`).join('')}</ul>
    </details>`;
  }).join('');
  return `
    <div class="card-head" style="margin-bottom:12px">
      <p class="muted small" style="margin:0">Cada supervisor con sus sucursales: cuántas van en verde, amarillo y rojo, y la proyección del grupo contra la suma de sus objetivos. Tocá uno para ver sus sucursales, de la mejor a la peor.</p>
      ${exportarHtml('supervisores')}
    </div>
    <div class="zonas">${tarjetas}</div>`;
}

// ---- Zonas ----

// Zonas del mes con objetivo y proyección sumados (solo de las sucursales con objetivo).
export function zonasDelMes() {
  const maestro = hayCiudades() ? [...suc.info.values()] : suc.res.sucursales.map((s) => ({ sucursal: s.sucursal, zona: zonaSugerida(s.sucursal) }));
  return resumenZonas(suc.res, maestro).map((z) => {
    let objetivo = 0, proyeccion = 0;
    for (const s of z.sucursales) {
      const a = suc.avance.get(s.sucursal);
      if (a) { objetivo += a.objetivo; proyeccion += a.proyeccion; }
    }
    const encargados = [...new Set(z.sucursales.map((s) => suc.info.get(s.sucursal)?.encargado).filter(Boolean))];
    return { ...z, objetivo, proyeccion, encargados };
  });
}

export function zonasHtml() {
  const res = suc.res;
  const zonas = zonasDelMes();
  const max = Math.max(...zonas.map((z) => z.total), 1);
  const tarjetas = zonas.map((z) => {
    const e = z.objetivo ? estado(z.proyeccion / z.objetivo) : null;
    return `
    <details class="card zona">
      <summary>
        <span class="zona-nombre">${esc(z.zona)}<small class="muted">${z.sucursales.length} sucursal${z.sucursales.length === 1 ? '' : 'es'}${z.encargados.length ? ' · ' + esc(z.encargados.join(', ')) : ''}</small></span>
        <span class="zona-bar"><span style="width:${((z.total / max) * 100).toFixed(1)}%"></span></span>
        <span class="zona-cifras"><b>${fmtMillones(z.total)}</b><small class="muted">${z.objetivo ? `objetivo ${fmtMillones(z.objetivo)} · ` : ''}${fmtPct(z.total / (res.total || 1))} del total</small></span>
        ${e ? `<span class="chip ${e.clase}" title="Proyección al cierre sobre el objetivo de la ciudad">${fmtPct(z.proyeccion / z.objetivo)}</span>` : ''}
      </summary>
      <ul class="zona-lista">${z.sucursales.map((s) => `
        <li data-suc="${esc(s.sucursal)}" role="button" tabindex="0">
          <span>${esc(s.sucursal)}${chipCerrada(s.sucursal)}</span>${avanceChip(s.sucursal)}<b>${fmtMillones(s.total)}${suc.avance.get(s.sucursal) ? `<small class="muted zona-obj"> de ${fmtMillones(suc.avance.get(s.sucursal).objetivo)}</small>` : ''}</b>
        </li>`).join('')}</ul>
    </details>`;
  }).join('');
  const aviso = hayCiudades()
    ? ''
    : `<p class="nota" style="margin:0 0 14px">Ciudades sugeridas por el nombre de cada sucursal. ${isAdmin() ? 'Para cargar la ciudad real y el encargado de cada una, cargá el listado en <b>Configurar sucursales</b>.' : 'El administrador puede cargar la ciudad real de cada sucursal.'}</p>`;
  return `
    <div class="card-head" style="margin-bottom:12px">
      <p class="muted small" style="margin:0">Tocá una ciudad para ver sus sucursales.${suc.avance.size ? ' El porcentaje de color es la proyección al cierre contra el objetivo.' : ''}</p>
      ${exportarHtml('zonas')}
    </div>
    ${aviso}
    <div class="zonas">${tarjetas}</div>`;
}

// ---- Alertas ----

export function alertasHtml() {
  const a = suc.alertas;
  const item = (s, extra) => `
    <li data-suc="${esc(s.sucursal)}" role="button" tabindex="0">
      <span>${esc(s.sucursal)}</span>${extra}
    </li>`;
  const lista = (arr, render, vacio) => (arr.length ? `<ul class="alerta-lista">${arr.map(render).join('')}</ul>` : `<p class="muted small" style="margin:10px 0 0">${vacio}</p>`);
  const rango = (r) => (r ? `${fmtDiaMes(r.desde)} al ${fmtDiaMes(r.hasta)}` : '');
  const tendencia = a.reciente
    ? `Participación en la venta del ${rango(a.reciente)} contra la del ${rango(a.previo)}.`
    : 'Se calcula cuando hay al menos 10 días cargados en el mes.';
  return `
    <div class="alertas-grid">
      <div class="card alerta risk">
        <h3>Sin venta en los últimos días</h3>
        <p class="muted small">Sin venta el ${a.ultimas.map(fmtDiaMes).join(' y el ') || '—'} (sin contar lunes). Si el último día está incompleto, puede incluir sucursales que todavía no informaron.</p>
        ${lista(a.sinVentaReciente, (s) => item(s, `<small>${s.ultimaVenta ? 'última venta ' + fmtDiaMes(s.ultimaVenta) : 'sin ventas en el mes'}</small>`), 'Ninguna sucursal.')}
      </div>
      <div class="card alerta warn">
        <h3>Vienen vendiendo menos</h3>
        <p class="muted small">${tendencia} Caída de 20% o más.</p>
        ${lista(a.caidas, (s) => item(s, `<b class="var-neg">${fmtVar(s.variacion)}</b>`), a.reciente ? 'Ninguna sucursal.' : '')}
      </div>
      <div class="card alerta ok">
        <h3>Vienen creciendo</h3>
        <p class="muted small">${tendencia} Suba de 20% o más.</p>
        ${lista(a.crecen, (s) => item(s, `<b class="var-pos">${fmtVar(s.variacion)}</b>`), a.reciente ? 'Ninguna sucursal.' : '')}
      </div>
      <div class="card alerta">
        <h3>Con varios días sin venta</h3>
        <p class="muted small">3 o más días del mes sin venta, sin contar lunes.</p>
        ${lista(a.conDiasSinVenta.slice(0, 15), (s) => item(s, `<small>${s.diasSinVenta} días</small>`), 'Ninguna sucursal.')}
      </div>
    </div>`;
}

// ---- Panel de detalle de una sucursal ----

export function abrirPanel(nombre) {
  const res = suc.res;
  const i = res?.sucursales.findIndex((s) => s.sucursal === nombre);
  if (!res || i < 0) return;
  const s = res.sucursales[i];
  const a = suc.alertas;
  const promSuc = res.total / res.sucursales.length;
  const maxDia = Math.max(...Object.values(s.dias), 1);
  const dias = res.dias.map((x) => {
    const v = s.dias[x.fecha] || 0;
    const wd = wdDe(x.fecha);
    return `<div class="sdd-dia" title="${DIA_CORTO[wd]} ${fmtFecha(x.fecha)}: ${v ? fmtMillones(v) : 'sin venta'}">
      <div class="sdd-bar"><div style="height:${((v / maxDia) * 100).toFixed(1)}%;background:${esFinde(wd) ? COLOR.min.fuerte : 'var(--dia-normal)'}"></div></div>
      <span class="${esFinde(wd) ? 'finde' : ''}">${Number(x.fecha.slice(8))}</span>
      <small>${v ? fmtM1(v) : '0'}</small>
    </div>`;
  }).join('');
  const propios = res.dias.map((x) => ({ fecha: x.fecha, monto: s.dias[x.fecha] || 0 }));
  const { peso, cuenta } = pesoSemana(propios);
  const marcas = [];
  const cierre = suc.cerradas.get(nombre);
  const ultimaVenta = Object.keys(s.dias).filter((f) => s.dias[f] > 0).sort().at(-1);
  if (cierre) marcas.push(`<span class="chip">Cerrada desde el ${fmtFecha(cierre)}</span>`);
  if (a.sinVentaReciente.some((x) => x.sucursal === nombre)) marcas.push('<span class="chip risk">Sin venta en los últimos días</span>');
  const caida = a.caidas.find((x) => x.sucursal === nombre);
  if (caida) marcas.push(`<span class="chip warn">Vende menos: ${fmtVar(caida.variacion)}</span>`);
  const sube = a.crecen.find((x) => x.sucursal === nombre);
  if (sube) marcas.push(`<span class="chip ok">Creciendo: ${fmtVar(sube.variacion)}</span>`);

  const info = suc.info.get(nombre);
  const av = suc.avance.get(nombre);
  const eAv = av ? estado(av.proyeccionPct) : null;
  const objetivoHtml = av ? `
    <div class="panel-obj">
      <div class="card-head" style="margin:0">
        <h3 style="margin:0">Objetivo del mes</h3>
        <span class="chip ${eAv.clase}">${eAv.texto}</span>
      </div>
      <div class="panel-kpis">
        <div><span>Objetivo</span><strong>${fmtMillones(av.objetivo)}</strong></div>
        <div><span>Avance</span><strong>${fmtPct(av.avance)}</strong></div>
        <div><span>Proyección al cierre</span><strong>${fmtMillones(av.proyeccion)}</strong></div>
        <div><span>Proyección / objetivo</span><strong>${fmtPct(av.proyeccionPct)}</strong></div>
      </div>
      ${bar(av.avance, av.proyeccionPct, COLOR.min, true)}
      <p class="muted small" style="margin:6px 0 0">Avance con lo vendido hasta el último día completo. La proyección reparte el mes según el peso de cada día de la semana.</p>
    </div>` : '';

  $('suc-panel-titulo').textContent = nombre;
  $('suc-panel-body').innerHTML = `
    <p class="muted small" style="margin:0 0 12px">${nombreMes(fechaDeMes(suc.datos.mes))} · puesto ${i + 1} de ${res.sucursales.length}${info?.zona ? ` · ${esc(info.zona)}` : ''}${info?.encargado ? ` · encargado: ${esc(info.encargado)}` : ''}${info?.supervisor ? ` · supervisor: <b>${esc(info.supervisor)}</b>` : ''}</p>
    ${isAdmin() ? `<div class="panel-sup">
      <label for="panel-sup" class="small">Supervisor</label>
      <input id="panel-sup" list="panel-sup-lista" value="${esc(info?.supervisor || '')}" maxlength="60" placeholder="Nombre del supervisor" autocomplete="off">
      <datalist id="panel-sup-lista">${[...new Set([...suc.info.values()].map((m) => m.supervisor).filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      <button class="btn btn-sm" type="button" data-sup-guardar="${esc(nombre)}">Guardar</button>
    </div>` : ''}
    <p style="margin:0 0 12px"><a class="btn btn-sm" href="/sucursal.html?ver=${encodeURIComponent(nombre)}&amp;mes=${encodeURIComponent(suc.datos.mes)}" target="_blank" rel="noopener">Ver como la sucursal ↗</a></p>
    ${marcas.length ? `<div class="panel-marcas">${marcas.join('')}</div>` : ''}
    ${objetivoHtml}
    <div class="panel-kpis">
      <div><span>Venta del mes</span><strong>${fmtMillones(s.total)}</strong></div>
      <div><span>% del total</span><strong>${fmtPct(s.total / (res.total || 1))}</strong></div>
      <div><span>Promedio por día</span><strong>${fmtMillones(s.total / Math.max(s.diasConVenta, 1))}</strong></div>
      <div><span>Días con venta</span><strong>${s.diasConVenta} de ${res.dias.length}</strong></div>
    </div>
    <p class="small" style="margin:12px 0 0">Vende ${varHtml(s.total / promSuc - 1)} que el promedio de las sucursales (${fmtMillones(promSuc)}).</p>
    <h3 style="margin-top:20px">Venta por día</h3>
    <div class="sdd">${dias}</div>
    <p class="muted small" style="margin:6px 0 0">Montos en millones. Viernes a domingo en naranja fuerte.</p>
    <h3 style="margin-top:20px">Peso por día de la semana</h3>
    <div class="sp-grid">${pesosSemanaHtml(peso, cuenta)}</div>
    ${isAdmin() ? `
    <div class="panel-cierre">
      ${cierre
        ? `<p class="muted small">Cerrada: lo que vendió cuenta en el mes, pero no genera alertas, no se mide contra objetivo ni se avisa si falta en la planilla.</p>
           <button class="btn btn-sm" type="button" data-cerrar="" data-nombre="${esc(nombre)}">Volver a abrir</button>`
        : `<p class="muted small">Si la sucursal cerró, marcala para que deje de aparecer en las alertas y en los avisos de la planilla. Lo que vendió sigue contando en el mes.</p>
           <button class="btn btn-sm btn-danger" type="button" data-cerrar="${ultimaVenta ? sumarDias(ultimaVenta, 1) : hoyAsuncion()}" data-nombre="${esc(nombre)}">Marcar como cerrada</button>`}
      <div class="alert form-msg" id="panel-cierre-msg" hidden></div>
    </div>` : ''}`;
  $('suc-panel').hidden = false;
  $('suc-panel-fondo').hidden = false;
  document.body.classList.add('panel-abierto');
  $('suc-panel-cerrar').focus();
}

// Marca la sucursal como cerrada desde una fecha (por defecto, el día después de su última venta) o la reabre.
export async function marcarCerrada(nombre, sugerida) {
  let fecha = null;
  if (sugerida) {
    const txt = prompt(`¿Desde qué fecha está cerrada ${nombre}? (día/mes/año)`, fmtFecha(sugerida));
    if (txt === null) return;
    fecha = parseFecha(txt);
    if (!fecha) { showMsg($('panel-cierre-msg'), 'Fecha inválida. Escribila como 23/10/2026.', false); return; }
  } else if (!confirm(`¿Volver a abrir ${nombre}? Va a generar alertas de nuevo si no vende.`)) return;
  try {
    const r = await API.marcarCerrada(nombre, fecha);
    suc.config.cerradas = r.cerradas;
    suc.cerradas = new Map(r.cerradas.map((c) => [c.sucursal, c.fecha]));
    renderSucursales();
    abrirPanel(nombre);
    state.sucAlertas = undefined; // la vista rápida del dashboard se vuelve a calcular
    showNotice(fecha ? `${nombre} quedó marcada como cerrada desde el ${fmtFecha(fecha)}.` : `${nombre} volvió a abrir.`);
  } catch (err) {
    handleError(err, $('panel-cierre-msg'));
  }
}

export function cerrarPanel() {
  if ($('suc-panel').hidden) return;
  $('suc-panel').hidden = true;
  $('suc-panel-fondo').hidden = true;
  document.body.classList.remove('panel-abierto');
}