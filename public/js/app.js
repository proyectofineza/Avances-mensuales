import * as API from './api.js';
import {
  UNIDADES, IDS, DIAS_SEMANA, PESOS_MINORISTA, AJUSTE_LLUVIA, parseCorte, fraccionPonderada,
  calcularReporte, estado, diasOperativos, diasUnidad, normalizarReporte, validarReporte, proyeccionLluvia,
  mesAnterior, mismoMesAnioAnterior, fmtMillones, fmtMiles, fmtPct, fmtVar, fmtFecha, fmtDiaMes,
  fmtFechaHora, nombreMes, fmtCI, hoyAsuncion, ultimoDiaDelMes, esUltimoDiaDelMes,
} from './calc.js';
import { armarContexto, textoParaCopiar, informeAHtml, MAX_TEXTO } from './informe.js';
import { VISTAS_UNIDAD, resumenAnual, tablaVariaciones, faltaParaIgualar } from './anual.js';
import { leerHistorialSucursales, fmtDistancia as fmtMetros } from './portal-sucursal.js';
import {
  leerPlanillaMensual, NEGOCIOS, leerPlanillaObjetivos, registrosPorMes, totales, variacion, diferenciasTotales, calcularSugerido, TOPE_TENDENCIA,
} from './objetivos.js';
import {
  leerPlanilla, resumirMes, alertasSucursales, pesoSemana, compararDias, mismoDiaSemana, ultimoDiaCompleto, ultimasSemanas, NO_MINORISTA,
  leerMaestro, leerObjetivos, parseFecha, avanceSucursales, resumenZonas, controlMaestro, zonaSugerida, normalizarSucursal,
} from './sucursales.js';
import { leerPlanillaHoras, tieneHora, minutos, NOMBRES_DIA, resumenPorHora, etiquetaHora } from './dia-comercial.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROL_TEXTO = { admin: 'Administrador', comercial: 'Comercial' };
const CAL_CORTO = { 'lun-dom': 'lun a lun', 'lun-vie': 'lun a vie' };
const CAL_LARGO = { 'lun-dom': 'lunes a lunes', 'lun-vie': 'lunes a viernes' };

// Color de cada unidad: fuerte = venta real, claro = proyección (el mismo color, translúcido,
// para que funcione en el tema oscuro y en el claro). Los valores viven en el CSS.
const tono = (fuerte) => ({ fuerte, claro: `color-mix(in srgb, ${fuerte} 38%, transparent)` });
const COLOR = {
  bar: tono('var(--c-may)'),
  may: tono('var(--c-may)'),
  min: tono('var(--c-min)'),
  fgl: tono('var(--c-fgl)'),
  fbt: tono('var(--c-fbt)'),
  total: tono('var(--text)'),
};

// Íconos de línea para los indicadores (mismo trazo que el menú).
const ICONOS = {
  venta: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  objetivo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  avance: '<path d="M4 18l6-6 4 4 6-8"/><path d="M14 8h6v6"/>',
  tienda: '<path d="M3 9l1.6-5h14.8L21 9"/><path d="M4 9v11h16V9"/><path d="M9.5 20v-5.5h5V20"/>',
  calendario: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
};
const icono = (nombre) => `<span class="kpi-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[nombre]}</svg></span>`;

const state = {
  user: null,
  published: null,
  history: [],
  draft: null,
  users: [],
};

// ---------- Inicio ----------

async function init() {
  try {
    state.user = await API.me();
  } catch {
    location.replace(`index.html${location.hash}`); // después de ingresar vuelve a la misma sección
    return;
  }
  $('user-name').textContent = state.user.nombre;
  $('user-rol').textContent = ROL_TEXTO[state.user.rol] || state.user.rol;
  $('user-avatar').textContent = state.user.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  setupTema();
  setupMenu();
  $('tabs').hidden = false;
  document.querySelectorAll('.solo-admin').forEach((el) => { el.hidden = !isAdmin(); });
  // En la barra del celular, los comerciales usan el lugar de Cargar y Usuarios para el Comparativo anual.
  document.querySelectorAll('.solo-comercial').forEach((el) => { el.hidden = isAdmin(); });

  $('btn-salir').addEventListener('click', async () => {
    try { await API.logout(); } finally { location.replace('index.html'); }
  });
  $('notice-close').addEventListener('click', () => { $('notice-wrap').hidden = true; });
  // Saltos a secciones del dashboard (sin tocar el hash, que maneja las vistas).
  $('dash').addEventListener('click', (e) => {
    const b = e.target.closest('[data-salto]');
    if (b) $(b.dataset.salto)?.scrollIntoView({ behavior: sinMovimiento() ? 'auto' : 'smooth', block: 'start' });
    const t = e.target.closest('[data-dash-detalle]');
    if (t) {
      const det = $('dash-detalle');
      det.hidden = !det.hidden;
      guardarPref('dash-detalle', det.hidden ? 'no' : 'si');
      t.textContent = det.hidden ? 'Ver el detalle completo' : 'Ocultar el detalle';
      if (!det.hidden) contarNumeros(det);
    }
  });

  if (isAdmin()) {
    setupVentas();
    setupUsuarios();
  }
  setupSucursales();
  setupCierre();
  setupAnual();
  if (isAdmin()) setupObjetivos();

  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentView() === 'dashboard') refreshDashboard();
  });
  setInterval(() => {
    if (!document.hidden && currentView() === 'dashboard') refreshDashboard();
  }, 60000);

  route();
}

const isAdmin = () => state.user?.rol === 'admin';

// ---------- Tema y menú ----------

function setupTema() {
  const pintar = () => {
    const claro = document.documentElement.dataset.tema === 'claro';
    $('tema-txt').textContent = claro ? 'Tema oscuro' : 'Tema claro';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', claro ? '#EEF1F5' : '#0E1217');
  };
  $('tema-btn').addEventListener('click', () => {
    const claro = document.documentElement.dataset.tema !== 'claro';
    if (claro) document.documentElement.dataset.tema = 'claro';
    else delete document.documentElement.dataset.tema;
    guardarPref('tema', claro ? 'claro' : 'oscuro');
    pintar();
  });
  pintar();
}

// En celular el menú lateral se abre y cierra con el botón del encabezado.
function setupMenu() {
  const abrir = (si) => {
    document.body.classList.toggle('menu-abierto', si);
    $('sidebar-fondo').hidden = !si;
    $('menu-btn').setAttribute('aria-expanded', String(si));
  };
  $('menu-btn').addEventListener('click', () => abrir(!document.body.classList.contains('menu-abierto')));
  $('nav-mas').addEventListener('click', () => abrir(true));
  $('sidebar-fondo').addEventListener('click', () => abrir(false));
  $('tabs').addEventListener('click', (e) => { if (e.target.closest('.tab')) abrir(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('menu-abierto')) abrir(false); });
}

const TITULO_VISTA = { ventas: 'Cargar ventas', usuarios: 'Usuarios', dashboard: 'Dashboard', sucursales: 'Sucursales', cierre: 'Cierre de mes', objetivos: 'Objetivo sugerido', anual: 'Comparativo anual' };

// Números grandes que "cuentan" hasta su valor al aparecer (respeta "reducir movimiento").
const sinMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function contarNumeros(raiz) {
  if (sinMovimiento()) return;
  raiz.querySelectorAll('[data-contar]').forEach((el) => {
    const texto = el.textContent;
    const m = /(-?\d{1,3}(?:\.\d{3})*|-?\d+)(,\d+)?/.exec(texto);
    if (!m) return;
    const decimales = m[2] ? m[2].length - 1 : 0;
    const final = Number(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2].slice(1) : ''));
    if (!Number.isFinite(final) || final === 0) return;
    const antes = texto.slice(0, m.index), despues = texto.slice(m.index + m[0].length);
    const fmt = (v) => v.toLocaleString('es-PY', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    const inicio = performance.now(), dur = 900;
    const paso = (t) => {
      const p = Math.min((t - inicio) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = antes + fmt(final * e) + despues;
      if (p < 1) requestAnimationFrame(paso);
      else el.textContent = texto;
    };
    requestAnimationFrame(paso);
  });
}

const VISTAS = ['ventas', 'usuarios', 'dashboard', 'sucursales', 'cierre', 'objetivos', 'anual'];

function currentView() {
  const h = location.hash.slice(1);
  const permitidas = isAdmin() ? VISTAS : ['dashboard', 'sucursales', 'cierre', 'anual'];
  if (permitidas.includes(h)) return h;
  return isAdmin() ? 'ventas' : 'dashboard';
}

function route() {
  const view = currentView();
  if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
  for (const v of VISTAS) $(`view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  $('topbar-titulo').textContent = TITULO_VISTA[view] || '';
  if (view === 'ventas') loadVentas();
  if (view === 'usuarios') loadUsuarios();
  if (view === 'dashboard') refreshDashboard(true);
  if (view === 'sucursales') { loadSucursales(suc.mesPedido); suc.mesPedido = undefined; } // mesPedido: desde el cierre
  if (view === 'cierre') loadCierre(cierre.datos?.mes);
  if (view === 'objetivos') loadObjetivos($('obj-mes').value);
  if (view === 'anual') loadAnual();
}

function showNotice(text, isError = false) {
  $('notice-text').textContent = text;
  $('notice').classList.toggle('error', isError);
  $('notice-wrap').hidden = false;
}

function showMsg(el, text, ok) {
  el.textContent = text;
  el.className = `alert form-msg ${ok ? 'alert-ok' : 'alert-error'}`;
  el.hidden = false;
}

function handleError(err, el) {
  if (err.status === 401) { location.replace('index.html'); return; }
  if (el) showMsg(el, err.message, false);
  else showNotice(err.message, true);
}

// ---------- Cargar ventas ----------

let saveTimer = null;
let savePromise = Promise.resolve();

const montoInput = (attr, id, label) =>
  `<input class="num" inputmode="numeric" ${attr} data-id="${id}" aria-label="${esc(label)}">`;

// En celular cada fila se ve como tarjeta: la unidad es el título y cada celda lleva su
// rótulo (data-label).
function unidadCell(u) {
  return `
      <td class="t-titulo">
        <div class="unidad-nombre">${esc(u.nombre)}</div>
        <div class="unidad-meta">${u.grupo ? 'Canal · ' : ''}${CAL_CORTO[u.calendario]}${u.ponderado ? ' · ponderado' : ''}</div>
      </td>`;
}

const grupoCell = `
      <td class="t-titulo">
        <div class="unidad-nombre">Baratote</div>
        <div class="unidad-meta">Unidad de negocio · ${CAL_CORTO['lun-dom']}</div>
      </td>`;

// Filas con Baratote como unidad (suma, solo lectura) y sus canales debajo.
function filas(grupoRow, unidadRow) {
  return UNIDADES.map((u) => `${u.id === 'may' ? grupoRow : ''}
    <tr${u.grupo ? ' class="sub-row"' : ''}>${unidadCell(u)}${unidadRow(u)}</tr>`).join('');
}

function setupVentas() {
  $('ventas-body').innerHTML = filas(
    `<tr class="grupo-row">${grupoCell}<td class="r" id="bar-obj" data-label="Objetivo mensual"></td><td class="r" id="bar-real" data-label="Venta acumulada"></td><td class="r" id="av-bar" data-label="Avance"></td></tr>`,
    (u) => `
      <td class="r" data-label="Objetivo mensual (Gs.)">${montoInput('data-campo="obj"', u.id, `Objetivo mensual ${u.nombre}`)}</td>
      <td class="r" data-label="Venta acumulada (Gs.)">${montoInput('data-campo="real"', u.id, `Venta acumulada ${u.nombre}`)}</td>
      <td class="r" id="av-${u.id}" data-label="Avance"></td>`,
  );

  $('dias-body').innerHTML = filas(
    `<tr class="grupo-row solo-escritorio">${grupoCell}<td></td><td></td><td></td></tr>`,
    (u) => `
      <td class="r" data-label="Días del mes"><input class="num dias-input" inputmode="numeric" maxlength="2" data-dias="mes" data-id="${u.id}" aria-label="Días del mes ${esc(u.nombre)}"></td>
      <td class="r" data-label="Día en curso"><input class="num dias-input" inputmode="numeric" maxlength="2" data-dias="curso" data-id="${u.id}" aria-label="Día en curso ${esc(u.nombre)}"></td>
      <td class="r" id="ri-${u.id}" data-label="Ritmo ideal"></td>`,
  );

  $('comp-body').innerHTML = filas(
    `<tr class="grupo-row">${grupoCell}<td class="r" id="comp-bar-ant" data-label="Mes anterior"></td><td class="r" id="comp-bar-aa" data-label="Año anterior"></td></tr>`,
    (u) => `
      <td class="r" data-label="Mes anterior (Gs.)">${montoInput('data-comp="ant"', u.id, `Venta mes anterior ${u.nombre}`)}</td>
      <td class="r" data-label="Año anterior (Gs.)">${montoInput('data-comp="aa"', u.id, `Venta año anterior ${u.nombre}`)}</td>`,
  );

  $('pesos-grid').innerHTML = DIAS_SEMANA.map((d) => `
    <label class="peso">
      <span>${d.nombre}</span>
      <span class="peso-input"><input class="num" inputmode="decimal" maxlength="5" data-peso="${d.k}" aria-label="Peso del ${d.nombre} en %"><i>%</i></span>
    </label>`).join('');

  $('btn-pesos-reset').addEventListener('click', () => {
    state.draft.pesos = { ...PESOS_MINORISTA };
    fillPesos();
    onDraftChange();
  });

  $('view-ventas').addEventListener('input', (e) => {
    const el = e.target;
    const id = el.dataset.id;
    const numero = () => Number(el.value.replace(/\D/g, '')) || 0;
    if (el.dataset.peso) {
      el.value = el.value.replace(/[^\d,.]/g, '');
      state.draft.pesos[el.dataset.peso] = Number(el.value.replace(',', '.')) || 0;
    } else if (el.dataset.campo) {
      formatearInput(el);
      state.draft[el.dataset.campo][id] = numero();
    } else if (el.dataset.comp) {
      formatearInput(el);
      state.draft.comp[el.dataset.comp][id] = numero();
    } else if (el.dataset.dias) {
      el.value = el.value.replace(/\D/g, '').slice(0, 2);
      state.draft.dias[id][el.dataset.dias] = numero();
    } else {
      return;
    }
    onDraftChange();
  });

  $('corte').addEventListener('change', () => {
    state.draft.corte = $('corte').value;
    $('corte-aviso').hidden = true;
    fillDias();
    onDraftChange();
  });

  document.querySelectorAll('input[name="dias-modo"]').forEach((radio) => radio.addEventListener('change', () => {
    const d = state.draft;
    d.dias.modo = radio.value;
    // Al pasar a manual, arranca con los días del calendario.
    if (d.dias.modo === 'manual') {
      for (const u of UNIDADES) {
        if (!d.dias[u.id].mes) {
          const a = diasOperativos(d.corte, u.calendario);
          d.dias[u.id] = { mes: a.mes, curso: a.operados };
        }
      }
    }
    fillDias();
    onDraftChange();
  }));

  $('btn-descartar').addEventListener('click', async () => {
    state.draft = normalizarReporte(state.published || { corte: hoyAsuncion() });
    fillVentasForm();
    $('ventas-error').hidden = true;
    await saveNow().catch(() => {});
  });

  $('btn-publicar').addEventListener('click', publicar);

  $('btn-teams-test').addEventListener('click', async () => {
    const btn = $('btn-teams-test');
    const msgEl = $('teams-msg');
    btn.disabled = true;
    try {
      const res = await API.testTeams();
      showMsg(msgEl, `Aviso de prueba enviado${res.canal ? ' al canal ' + res.canal : ''}. Revisá Teams.`, true);
    } catch (err) {
      handleError(err, msgEl);
    } finally {
      btn.disabled = false;
    }
  });
}

async function loadTeamsEstado() {
  const el = $('teams-estado');
  try {
    const t = await API.getTeams();
    el.innerHTML = t.configurado
      ? `<span class="chip ok">Configurado</span> ${t.canal ? 'Canal: ' + esc(t.canal) : ''}`
      : '<span class="chip warn">Sin configurar</span> Falta cargar TEAMS_WEBHOOK_URL en Netlify.';
    $('btn-teams-test').disabled = !t.configurado;
  } catch {
    el.textContent = 'No se pudo verificar la configuración.';
  }
}

// Formatea con separador de miles manteniendo la posición del cursor.
function formatearInput(el) {
  const pos = el.selectionStart ?? el.value.length;
  const digitosAntes = el.value.slice(0, pos).replace(/\D/g, '').length;
  const digitos = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  el.value = digitos ? fmtMiles(Number(digitos)) : '';
  let n = 0, i = 0;
  while (i < el.value.length && n < digitosAntes) { if (/\d/.test(el.value[i])) n++; i++; }
  el.setSelectionRange(i, i);
}

async function loadVentas() {
  $('ventas-error').hidden = true;
  try {
    const [draft, dash] = await Promise.all([API.getDraft(), API.getDashboard()]);
    state.draft = normalizarReporte(draft);
    state.published = dash.published;
    state.history = dash.history;
    if (draft.actualizado) $('draft-saved').textContent = `Borrador guardado ${fmtFechaHora(draft.actualizado)}${draft.por ? ' por ' + draft.por : ''}.`;
    else $('draft-saved').textContent = '';
    sugerirCorte();
    fillVentasForm();
    renderUltimaPub();
    loadTeamsEstado();
  } catch (err) {
    handleError(err, $('ventas-error'));
  }
}

// Si la fecha de corte quedó vieja (de una carga anterior), propone la de ayer, que es hasta
// donde suelen llegar las ventas. Al empezar un mes, primero propone cerrar el anterior
// (fecha = su último día); con el anterior ya cerrado, avisa que hay que pasar al mes nuevo.
function sugerirCorte() {
  const d = state.draft;
  const ayer = sumarDias(hoyAsuncion(), -1);
  const aviso = $('corte-aviso');
  aviso.hidden = true;
  if (!d.corte || d.corte >= ayer) return;
  const mesCorte = nombreMes(d.corte).split(' ')[0].toLowerCase();
  if (d.corte.slice(0, 7) === ayer.slice(0, 7)) {
    aviso.innerHTML = `La fecha de corte era el <b>${fmtFecha(d.corte)}</b> (de la carga anterior): la cambié a <b>${fmtFecha(ayer)}</b>, ayer. Si tus cifras llegan hasta otro día, cambiala.`;
    d.corte = ayer;
    onDraftChange();
  } else if (!esUltimoDiaDelMes(d.corte)) {
    const fin = ultimoDiaDelMes(d.corte);
    aviso.innerHTML = `<b>Falta cerrar ${esc(mesCorte)}.</b> Cambié la fecha de corte a <b>${fmtFecha(fin)}</b>, el último día del mes: cargá las ventas finales de ${esc(mesCorte)} y publicá. Después cambiá la fecha para empezar el mes nuevo.`;
    d.corte = fin;
    onDraftChange();
  } else {
    aviso.innerHTML = `${esc(mesCorte[0].toUpperCase() + mesCorte.slice(1))} ya tiene cargado el cierre (${fmtFecha(d.corte)}). Para empezar ${esc(nombreMes(ayer).split(' ')[0].toLowerCase())}, cambiá la fecha de corte y cargá las cifras y objetivos del mes nuevo.`;
  }
  aviso.hidden = false;
}

function fillVentasForm() {
  const d = state.draft;
  $('corte').value = d.corte || '';
  document.querySelectorAll('#ventas-body input').forEach((el) => {
    const v = d[el.dataset.campo][el.dataset.id];
    el.value = v ? fmtMiles(v) : '';
  });
  document.querySelectorAll('#comp-body input').forEach((el) => {
    const v = d.comp[el.dataset.comp][el.dataset.id];
    el.value = v ? fmtMiles(v) : '';
  });
  fillDias();
  fillPesos();
  updateVentasCalc();
}

const fmtPeso = (v) => String(Math.round((Number(v) || 0) * 10) / 10).replace('.', ',');

function fillPesos() {
  document.querySelectorAll('#pesos-grid input').forEach((el) => {
    el.value = fmtPeso(state.draft.pesos[el.dataset.peso]);
  });
}

// En automático muestra los días del calendario (solo lectura); en manual, los cargados.
function fillDias() {
  const d = state.draft;
  const manual = d.dias.modo === 'manual';
  document.querySelectorAll('input[name="dias-modo"]').forEach((r) => { r.checked = r.value === d.dias.modo; });
  document.querySelectorAll('#dias-body input').forEach((el) => {
    const u = UNIDADES.find((x) => x.id === el.dataset.id);
    let v;
    if (manual) {
      v = d.dias[u.id][el.dataset.dias];
    } else {
      const a = diasOperativos(d.corte, u.calendario);
      v = el.dataset.dias === 'mes' ? a.mes : a.operados;
    }
    el.value = v ? String(v) : '';
    el.disabled = !manual;
  });
  $('lbl-ant').textContent = mesAnterior(d.corte) || '—';
  $('lbl-aa').textContent = mismoMesAnioAnterior(d.corte) || '—';
}

function updateVentasCalc() {
  const d = state.draft;
  const suma = (src, ids) => ids.reduce((s, id) => s + (src[id] || 0), 0);
  const pct = (a, b) => (b > 0 ? fmtPct(a / b) : '—');
  const BAR = ['may', 'min'];

  for (const id of IDS) $(`av-${id}`).textContent = pct(d.real[id], d.obj[id]);
  $('bar-obj').textContent = fmtMiles(suma(d.obj, BAR));
  $('bar-real').textContent = fmtMiles(suma(d.real, BAR));
  $('av-bar').textContent = pct(suma(d.real, BAR), suma(d.obj, BAR));
  $('tot-obj').textContent = fmtMiles(suma(d.obj, IDS));
  $('tot-real').textContent = fmtMiles(suma(d.real, IDS));
  $('tot-av').textContent = pct(suma(d.real, IDS), suma(d.obj, IDS));

  for (const u of UNIDADES) {
    const x = diasUnidad(d, u);
    const ritmo = x.fraccion ?? (x.mes > 0 ? x.operados / x.mes : null);
    $(`ri-${u.id}`).textContent = ritmo === null ? '—' : fmtPct(ritmo);
  }

  const p = d.pesos;
  const totPesos = DIAS_SEMANA.reduce((s, x) => s + (Number(p[x.k]) || 0), 0);
  const finde = (Number(p.vie) || 0) + (Number(p.sab) || 0) + (Number(p.dom) || 0);
  $('pesos-total').innerHTML = totPesos > 0
    ? `Total ${fmtPeso(totPesos)}%${Math.abs(totPesos - 100) > 0.5 ? ' <span class="necesario-alto">(no suma 100%: se reparte en proporción)</span>' : ''} · Viernes a domingo: <b>${fmtPct(finde / totPesos)}</b> de la semana`
    : '<span class="necesario-alto">Cargá al menos un peso.</span>';

  const montoOVacio = (v) => (v ? fmtMiles(v) : '—');
  $('comp-bar-ant').textContent = montoOVacio(suma(d.comp.ant, BAR));
  $('comp-bar-aa').textContent = montoOVacio(suma(d.comp.aa, BAR));
  $('comp-tot-ant').textContent = montoOVacio(suma(d.comp.ant, IDS));
  $('comp-tot-aa').textContent = montoOVacio(suma(d.comp.aa, IDS));

  const chip = $('draft-status');
  const alDia = state.published && JSON.stringify(normalizarReporte(d)) === JSON.stringify(normalizarReporte(state.published));
  chip.textContent = alDia ? 'Al día con lo publicado' : 'Cambios sin publicar';
  chip.className = `chip ${alDia ? 'ok' : 'warn'}`;
}

function onDraftChange() {
  updateVentasCalc();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}

// Guarda el borrador en el servidor; los guardados se encadenan en orden.
function saveNow() {
  clearTimeout(saveTimer);
  const snapshot = JSON.parse(JSON.stringify(state.draft));
  const p = savePromise.catch(() => {}).then(() => API.saveDraft(snapshot)).then((d) => {
    $('draft-saved').textContent = `Borrador guardado ${fmtFechaHora(d.actualizado)}.`;
  });
  savePromise = p;
  p.catch((err) => handleError(err, $('ventas-error')));
  return p;
}

// Avisos antes de publicar: fecha de corte vieja o futura, o cifras iguales a la publicación anterior.
function dudasAntesDePublicar(d) {
  const hoy = hoyAsuncion();
  const ayer = sumarDias(hoy, -1);
  const dudas = [];
  const esCierre = esUltimoDiaDelMes(d.corte) && d.corte.slice(0, 7) < hoy.slice(0, 7); // cierre de un mes terminado
  if (d.corte > hoy) dudas.push(`La fecha de corte (${fmtFecha(d.corte)}) es posterior a hoy.`);
  else if (d.corte < ayer && !esCierre) {
    const dias = Math.round((new Date(`${hoy}T12:00:00Z`) - new Date(`${d.corte}T12:00:00Z`)) / 864e5);
    dudas.push(`La fecha de corte es el ${fmtFecha(d.corte)}, hace ${dias} días. La proyección se calcula con esa fecha: si tus ventas llegan hasta ayer (${fmtFecha(ayer)}), cambiala antes de publicar.`);
  }
  const p = state.published;
  if (p && p.corte !== d.corte && IDS.every((id) => Number(p.real?.[id]) === Number(d.real?.[id]))) {
    dudas.push(`Las ventas son las mismas que en la publicación del ${fmtFecha(p.corte)}, pero con otra fecha de corte. ¿Actualizaste las cifras?`);
  }
  return dudas;
}

async function publicar() {
  const errEl = $('ventas-error');
  errEl.hidden = true;
  const msg = validarReporte(state.draft);
  if (msg) { showMsg(errEl, msg, false); return; }
  const dudas = dudasAntesDePublicar(state.draft);
  if (dudas.length && !confirm(`${dudas.join('\n\n')}\n\n¿Publicar igual?`)) return;

  const btn = $('btn-publicar');
  btn.disabled = true;
  try {
    await saveNow();
    const res = await API.publish($('avisar-teams').checked);
    const corte = fmtFecha(res.published.corte);
    if (res.actualizaDashboard === false) {
      showNotice(`Se guardó el cierre de ${nombreMes(res.published.corte)} (ventas hasta el ${corte}). El dashboard sigue mostrando el mes en curso.${res.teams === 'enviado' ? ' Aviso enviado a Teams.' : ''}`);
    } else if (res.teams === 'enviado') {
      showNotice(`Reporte publicado con corte al ${corte}. Aviso enviado al canal de Teams${res.canal ? ' ' + res.canal : ''}.`);
    } else if (res.teams === 'error') {
      showNotice('Publicado, pero no se pudo enviar el aviso a Teams.', true);
    } else {
      showNotice(`Reporte publicado con corte al ${corte}. Sin aviso a Teams.`);
    }
    await loadVentas();
  } catch (err) {
    handleError(err, errEl);
  } finally {
    btn.disabled = false;
  }
}

function renderUltimaPub() {
  const p = state.published;
  const el = $('ultima-pub');
  if (!p) {
    el.innerHTML = '<p class="muted small">Todavía no se publicó ningún reporte.</p>';
    return;
  }
  const r = calcularReporte(p);
  el.innerHTML = `
    <div class="kv">
      <div><span>Corte</span><strong>${fmtFecha(p.corte)}</strong></div>
      <div><span>Publicado</span><strong>${fmtFechaHora(p.publicadoEn)}</strong></div>
      <div><span>Por</span><strong>${esc(p.por)}</strong></div>
      <div><span>Días</span><strong>${r.manual ? 'Manual' : 'Automático'}</strong></div>
      <div><span>Avance total</span><strong>${fmtPct(r.total.avance)}</strong></div>
    </div>`;
}

// ---------- Usuarios ----------

let resetCi = null;

function setupUsuarios() {
  for (const id of ['alta-ci', 'alta-pin']) {
    $(id).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
  }

  $('alta-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = $('alta-msg');
    const ci = $('alta-ci').value.trim();
    const nombre = $('alta-nombre').value.trim();
    const pin = $('alta-pin').value.trim();
    const rol = $('alta-rol').value;
    if (ci.length < 5) return showMsg(msgEl, 'La cédula debe tener al menos 5 dígitos.', false);
    if (state.users.some((u) => u.ci === ci)) return showMsg(msgEl, 'Ya existe un usuario con esa cédula.', false);
    if (!nombre) return showMsg(msgEl, 'Indicá el nombre y apellido.', false);
    if (!/^\d{4,6}$/.test(pin)) return showMsg(msgEl, 'El PIN debe tener de 4 a 6 dígitos.', false);
    try {
      const res = await API.createUser({ ci, nombre, pin, rol });
      showMsg(msgEl, res.mensaje, true);
      $('alta-form').reset();
      await loadUsuarios();
    } catch (err) {
      handleError(err, msgEl);
    }
  });

  $('users-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const ci = btn.dataset.ci;
    const accion = btn.dataset.accion;
    const msgEl = $('users-msg');

    if (accion === 'reset') { resetCi = ci; renderUsers(); $('reset-pin')?.focus(); return; }
    if (accion === 'cancelar') { resetCi = null; renderUsers(); return; }
    if (accion === 'eliminar' && !confirm(`¿Eliminar a ${btn.dataset.nombre}? Esta acción no se puede deshacer: para volver a darle acceso habría que crearlo de nuevo.`)) return;

    btn.disabled = true;
    try {
      let res;
      if (accion === 'guardar-pin') {
        const pin = $('reset-pin').value.trim();
        if (!/^\d{4,6}$/.test(pin)) { showMsg(msgEl, 'El PIN debe tener de 4 a 6 dígitos.', false); btn.disabled = false; return; }
        res = await API.updateUser(ci, { pin });
        resetCi = null;
      } else if (accion === 'eliminar') {
        res = await API.eliminarUsuario(ci);
      } else {
        res = await API.updateUser(ci, { activo: accion === 'activar' });
      }
      showMsg(msgEl, res.mensaje, true);
      await loadUsuarios();
    } catch (err) {
      btn.disabled = false;
      handleError(err, msgEl);
    }
  });

  $('pend-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const { ci, accion, nombre } = btn.dataset;
    const msgEl = $('pend-msg');
    if (accion === 'rechazar' && !confirm(`¿Rechazar la solicitud de ${nombre}? Se borra y tendría que volver a pedir acceso.`)) return;
    btn.disabled = true;
    try {
      const res = accion === 'aprobar' ? await API.updateUser(ci, { aprobar: true }) : await API.rechazarSolicitud(ci);
      showMsg(msgEl, res.mensaje, true);
      await loadUsuarios();
    } catch (err) {
      btn.disabled = false;
      handleError(err, msgEl);
    }
  });

  // Contador de solicitudes en la pestaña, aunque se entre por otra vista.
  API.getUsers().then((users) => { state.users = users; actualizarBadge(); }).catch(() => {});

  $('users-body').addEventListener('input', (e) => {
    if (e.target.id === 'reset-pin') e.target.value = e.target.value.replace(/\D/g, '');
  });
  $('users-body').addEventListener('keydown', (e) => {
    if (e.target.id === 'reset-pin' && e.key === 'Enter') document.querySelector('[data-accion="guardar-pin"]')?.click();
  });
}

async function loadUsuarios() {
  try {
    state.users = await API.getUsers();
    renderUsers();
  } catch (err) {
    handleError(err, $('users-msg'));
  }
}

// "hace 5 min", "hace 3 h", "ayer 14:20", o fecha y hora completas.
function haceCuanto(iso) {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60e3);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  if (min < 12 * 60) return `hace ${Math.floor(min / 60)} h`;
  const [fecha, hora] = fmtFechaHora(iso).split(' ');
  const ayer = fmtFechaHora(new Date(Date.now() - 86400e3).toISOString()).split(' ')[0];
  const hoy = fmtFechaHora(new Date().toISOString()).split(' ')[0];
  if (fecha === hoy) return `hoy ${hora}`;
  if (fecha === ayer) return `ayer ${hora}`;
  return `${fecha} ${hora}`;
}

function conexionHtml(u) {
  const ultima = [u.ultimaActividad, u.ultimoIngreso].filter(Boolean).sort().pop();
  if (!ultima) return '<span class="muted small">Nunca ingresó</span>';
  const detalle = `Último ingreso con PIN: ${u.ultimoIngreso ? fmtFechaHora(u.ultimoIngreso) : '—'} · Última actividad: ${u.ultimaActividad ? fmtFechaHora(u.ultimaActividad) : '—'}`;
  const dias = (Date.now() - Date.parse(ultima)) / 86400e3;
  return `<div title="${esc(detalle)}"${dias > 7 ? ' class="conexion-vieja"' : ''}>${haceCuanto(ultima)}</div>
    <div class="muted small">${u.ingresos} ingreso${u.ingresos === 1 ? '' : 's'}</div>`;
}

function actualizarBadge() {
  const n = state.users.filter((u) => u.pendiente).length;
  for (const id of ['tab-badge', 'tab-badge-inf']) {
    $(id).textContent = n;
    $(id).hidden = n === 0;
  }
}

function renderPendientes() {
  const pend = state.users.filter((u) => u.pendiente).sort((a, b) => (a.creado || '').localeCompare(b.creado || ''));
  $('pend-card').hidden = pend.length === 0 && $('pend-msg').hidden;
  $('pend-count').textContent = `${pend.length} pendiente${pend.length === 1 ? '' : 's'}`;
  $('pend-body').innerHTML = pend.length
    ? pend.map((u) => `
      <tr>
        <td style="white-space:nowrap" data-label="Cédula">${fmtCI(u.ci)}</td>
        <td class="t-titulo">${esc(u.nombre)}</td>
        <td style="white-space:nowrap" data-label="Solicitado">${fmtFechaHora(u.creado)}</td>
        <td class="r t-acciones">
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-primary btn-sm" data-accion="aprobar" data-ci="${esc(u.ci)}" data-nombre="${esc(u.nombre)}">Aprobar</button>
            <button class="btn btn-sm" data-accion="rechazar" data-ci="${esc(u.ci)}" data-nombre="${esc(u.nombre)}">Rechazar</button>
          </div>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="muted">No quedan solicitudes pendientes.</td></tr>';
}

function renderUsers() {
  actualizarBadge();
  renderPendientes();
  const users = state.users.filter((u) => !u.pendiente).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const activos = users.filter((u) => u.activo).length;
  $('users-count').textContent = `${users.length} usuario${users.length === 1 ? '' : 's'} · ${activos} activo${activos === 1 ? '' : 's'}`;
  $('users-body').innerHTML = users.map((u) => {
    let acciones;
    if (resetCi === u.ci) {
      acciones = `
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <input id="reset-pin" inputmode="numeric" maxlength="6" placeholder="Nuevo PIN" style="width:120px;height:36px" autocomplete="off">
          <button class="btn btn-primary btn-sm" data-accion="guardar-pin" data-ci="${esc(u.ci)}">Guardar</button>
          <button class="btn btn-sm" data-accion="cancelar" data-ci="${esc(u.ci)}">Cancelar</button>
        </div>`;
    } else {
      const toggle = u.ci === state.user.ci
        ? '<span class="muted small">Sesión actual</span>'
        : `<button class="btn btn-sm" data-accion="${u.activo ? 'desactivar' : 'activar'}" data-ci="${esc(u.ci)}">${u.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="btn btn-sm btn-danger" data-accion="eliminar" data-ci="${esc(u.ci)}" data-nombre="${esc(u.nombre)}">Eliminar</button>`;
      acciones = `
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <button class="btn btn-sm" data-accion="reset" data-ci="${esc(u.ci)}">Restablecer PIN</button>
          ${toggle}
        </div>`;
    }
    return `
      <tr>
        <td style="white-space:nowrap" data-label="Cédula">${fmtCI(u.ci)}</td>
        <td class="t-titulo">${esc(u.nombre)}</td>
        <td data-label="Rol">${ROL_TEXTO[u.rol] || esc(u.rol)}</td>
        <td class="t-chip"><span class="chip ${u.activo ? 'ok' : 'off'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td style="white-space:nowrap" data-label="Última conexión">${conexionHtml(u)}</td>
        <td class="r t-acciones">${acciones}</td>
      </tr>`;
  }).join('');
}

// ---------- Ventas por sucursal ----------

// Preferencias de vista por navegador (si el almacenamiento no está disponible, se usa el valor por defecto).
function leerPref(clave, porDefecto) {
  try { return localStorage.getItem(clave) || porDefecto; } catch { return porDefecto; }
}
function guardarPref(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

const suc = {
  datos: null, lectura: null, filtro: '', sub: leerPref('suc-sub', 'resumen'), rank: 'top', res: null, alertas: null,
  // Comparar días: modo 'par' (un día contra otro) o 'semana' (todos los mismos días del mes).
  cmp: { modo: 'par', a: null, b: null, wd: null, orden: 'caidas', filtro: '' },
  cache: {}, // filas por mes, para comparar contra otros meses
  // Mapa de calor: escala ('propio' = vs. lo habitual de la sucursal, 'monto') y si muestra todas.
  calor: { modo: 'propio', todas: false },
  // Listado maestro y objetivos del mes (/api/sucursales-config); filtros del ranking.
  config: { maestro: null, objetivos: null }, info: new Map(), cerradas: new Map(), cfgObj: null, avance: new Map(), zona: '', encargado: '',
  // Análisis del mes abierto: respuesta de /api/informe, último error y texto que se está editando.
  informe: { mes: null, datos: null, error: null, borrador: null },
  // Venta por hora (días cargados con hora): detalle del mes y filtro ('' | 'z:ZONA' | 's:SUCURSAL').
  horas: { mes: null, datos: null, error: null, filtro: '', escala: 'dia' },
};
const fechaDeMes = (mes) => `${mes}-01`;
const esFinde = (wd) => wd === 5 || wd === 6 || wd === 0;
const wdDe = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();
// "jueves" → "jueves", "sábado" → "sábados".
const pluralDia = (nombre) => (nombre.endsWith('s') ? nombre : `${nombre}s`);
// Pesos por día de la semana de Minorista: los publicados si el reporte es de ese mes.
const pesosDelMes = (mes) => (suc.published?.corte?.startsWith(mes) && suc.published.pesos) || PESOS_MINORISTA;
// Zona de una sucursal: la del listado maestro o, si no hay listado, la sugerida por el nombre.
const zonaDe = (nombre) => suc.info.get(nombre)?.zona || (suc.info.size ? 'SIN ZONA' : zonaSugerida(nombre));

const chipCerrada = (nombre) => (suc.cerradas.has(nombre)
  ? ` <span class="chip" title="Cerrada desde el ${fmtFecha(suc.cerradas.get(nombre))}: no genera alertas ni se mide contra objetivo">Cerrada</span>`
  : '');

// Estado contra el objetivo de la sucursal (proyección ponderada al cierre).
function avanceChip(nombre) {
  const a = suc.avance.get(nombre);
  if (!a) return '';
  const e = estado(a.proyeccionPct);
  return `<span class="chip ${e.clase}" title="Avance ${fmtPct(a.avance)} · proyecta ${fmtMillones(a.proyeccion)} de ${fmtMillones(a.objetivo)}">${fmtPct(a.proyeccionPct)}</span>`;
}

function setupSucursales() {
  $('suc-mes').addEventListener('change', () => loadSucursales($('suc-mes').value));
  $('suc-subtabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sub]');
    if (!b) return;
    suc.sub = b.dataset.sub;
    guardarPref('suc-sub', suc.sub);
    renderSucursales();
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
    else if (id === 'hr-filtro') { suc.horas.filtro = e.target.value; $('suc-contenido').innerHTML = horasHtml(); return; }
    else if (id === 'suc-zona' || id === 'suc-encargado') {
      suc[id === 'suc-zona' ? 'zona' : 'encargado'] = e.target.value;
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
    const hrEscala = e.target.closest('[data-hr-escala]');
    if (hrEscala) { suc.horas.escala = hrEscala.dataset.hrEscala; $('suc-contenido').innerHTML = horasHtml(); return; }
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
      suc.sub = ir.dataset.ir;
      if (ir.dataset.rank) suc.rank = ir.dataset.rank;
      guardarPref('suc-sub', suc.sub);
      renderSucursales();
      return;
    }
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
  });
  $('suc-panel-cerrar').addEventListener('click', cerrarPanel);
  $('suc-panel-fondo').addEventListener('click', cerrarPanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('suc-panel').hidden) cerrarPanel(); });
  if (!isAdmin()) return;

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

// ---- Portal de sucursales (admin): PIN, equipos autorizados, ubicación e historial ----

let accesosSuc = [];

function setupPortalSucursales() {
  $('sa-link').textContent = `${location.origin}/sucursal.html`;
  $('sa-pin').addEventListener('input', () => { $('sa-pin').value = $('sa-pin').value.replace(/\D/g, ''); });
  $('sa-card').addEventListener('toggle', () => { if ($('sa-card').open) cargarAccesos(); });
  $('sa-pin-btn').addEventListener('click', async () => {
    const sucursal = $('sa-suc').value.trim().toUpperCase();
    const pin = $('sa-pin').value;
    if (!sucursal) return showMsg($('sa-msg'), 'Elegí la sucursal.', false);
    if (!/^\d{4,6}$/.test(pin)) return showMsg($('sa-msg'), 'El PIN debe tener de 4 a 6 números.', false);
    if (!nombresConocidos().includes(sucursal) && !confirm(`"${sucursal}" no figura entre las sucursales con ventas ni en el listado. ¿Crear el acceso igual?`)) return;
    await accionAcceso({ tipo: 'pin', sucursal, pin }, () => { $('sa-pin').value = ''; });
  });
  $('sa-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sa]');
    if (!b) return;
    const sucursal = b.dataset.suc;
    const a = accesosSuc.find((x) => x.sucursal === sucursal);
    if (b.dataset.sa === 'codigo') generarCodigo(sucursal);
    else if (b.dataset.sa === 'ubicacion') editarUbicacion(a);
    else if (b.dataset.sa === 'activo') accionAcceso({ tipo: 'activo', sucursal, activo: !a.activo });
    else if (b.dataset.sa === 'gps') accionAcceso({ tipo: 'equipo', sucursal, id: b.dataset.id, exigeGps: b.dataset.valor === '1' });
    else if (b.dataset.sa === 'quitar' && confirm(`¿Quitar el equipo "${b.dataset.nombre}" de ${sucursal}? Ya no va a poder ingresar desde ahí.`)) {
      accionAcceso({ tipo: 'equipo', sucursal, id: b.dataset.id, quitar: true });
    } else if (b.dataset.sa === 'restablecer' && confirm(`¿Restablecer el acceso de ${sucursal}?\n\nSe borran el PIN y todos los equipos autorizados, y se cierran las sesiones abiertas. La ubicación se mantiene.\nDespués asignale un PIN nuevo y autorizá el equipo otra vez.`)) {
      accionAcceso({ tipo: 'restablecer', sucursal });
    } else if (b.dataset.sa === 'eliminar' && confirm(`¿Eliminar el acceso de ${sucursal}?\n\nSe borran el PIN, los equipos y la ubicación, y la sucursal sale de esta lista. El historial de ventas no se toca.`)) {
      accionAcceso({ tipo: 'eliminar', sucursal });
    }
  });
  $('sa-hist-texto').addEventListener('input', () => { $('sa-hist-anio-box').hidden = true; });
  $('sa-hist-archivo').addEventListener('change', async () => {
    const f = $('sa-hist-archivo').files[0];
    if (!f) return;
    $('sa-hist-texto').value = await leerArchivo(f);
    $('sa-hist-anio-box').hidden = true;
    guardarHistorialSucursales();
  });
  $('sa-hist-btn').addEventListener('click', guardarHistorialSucursales);
}

async function cargarAccesos() {
  $('sa-suc-lista').innerHTML = nombresConocidos().map((n) => `<option value="${esc(n)}">`).join('');
  try {
    const d = await API.getAccesosSucursal();
    accesosSuc = d.accesos;
    pintarAccesos();
    $('sa-hist-estado').textContent = d.historia.meses.length
      ? `Cargado: ${d.historia.sucursales} sucursales, de ${nombreMes(fechaDeMes(d.historia.meses[0]))} a ${nombreMes(fechaDeMes(d.historia.meses.at(-1)))}.`
      : 'Todavía no hay historial cargado.';
  } catch (err) {
    handleError(err, $('sa-msg'));
  }
}

function pintarAccesos() {
  if (!accesosSuc.length) {
    $('sa-body').innerHTML = '<tr><td colspan="5" class="muted">Todavía ninguna sucursal tiene acceso. Asigná un PIN para empezar.</td></tr>';
    return;
  }
  const mapa = (u) => `https://www.google.com/maps?q=${u.lat},${u.lng}`;
  $('sa-body').innerHTML = accesosSuc.map((a) => {
    const u = a.ubicacion;
    const ubic = u
      ? `<a href="${mapa(u)}" target="_blank" rel="noopener">Ver en el mapa</a><br><span class="muted small">${u.fuente === 'manual' ? 'cargada a mano' : 'tomada al autorizar · revisala'} · radio ${a.radio} m</span>`
      : '<span class="chip warn">Sin ubicación</span>';
    const equipos = a.equipos.length ? `<div class="sa-equipos">${a.equipos.map((e) => `
      <div class="sa-equipo">
        <b>${esc(e.nombre)}</b>
        <span class="chip ${e.exigeGps ? 'ok' : 'warn'}">${e.exigeGps ? 'Con GPS' : 'Sin GPS'}</span>
        ${e.exigeGps && e.distanciaAlta !== null && e.distanciaAlta > a.radio ? `<span class="chip risk" title="Distancia a la sucursal cuando se autorizó">autorizado a ${fmtMetros(e.distanciaAlta)}</span>` : ''}
        ${!e.exigeGps && e.precisionAlta ? `<span class="muted small" title="Sin GPS, el navegador estima la ubicación por internet y puede errar varios km. Este equipo entra solo con el PIN.">ubicación aproximada (±${fmtMetros(e.precisionAlta)})</span>` : ''}
        <span class="muted small">${e.ultimoIngreso ? `último ingreso ${fmtFechaHora(e.ultimoIngreso)}` : `autorizado ${fmtFechaHora(e.creado)}`}</span>
        <button class="btn-link small" type="button" data-sa="gps" data-suc="${esc(a.sucursal)}" data-id="${esc(e.id)}" data-valor="${e.exigeGps ? '0' : '1'}">${e.exigeGps ? 'No exigir ubicación' : 'Exigir ubicación'}</button>
        <button class="btn-link small" type="button" data-sa="quitar" data-suc="${esc(a.sucursal)}" data-id="${esc(e.id)}" data-nombre="${esc(e.nombre)}">Quitar</button>
      </div>`).join('')}</div>` : '<span class="muted small">Ninguno: generá un código y autorizá el equipo en el local.</span>';
    const ult = a.ingresos[0];
    const intento = ult
      ? `<span class="chip ${ult.ok ? 'ok' : 'risk'}">${ult.ok ? 'Ingresó' : 'Rechazado'}</span> <span class="muted small">${fmtFechaHora(ult.fecha)}${ult.distancia !== null && ult.distancia !== undefined ? ` · a ${ult.distancia} m` : ''}${ult.ok ? '' : `<br>${esc(ult.motivo)}`}</span>`
      : '<span class="muted small">—</span>';
    return `<tr>
      <td><b>${esc(a.sucursal)}</b>${a.activo ? '' : ' <span class="chip risk">Desactivada</span>'}${a.conPin ? '' : ' <span class="chip warn">Sin PIN</span>'}</td>
      <td>${ubic}</td><td>${equipos}</td><td>${intento}</td>
      <td class="r"><div class="actions" style="justify-content:flex-end;margin:0">
        <button class="btn btn-sm btn-primary" type="button" data-sa="codigo" data-suc="${esc(a.sucursal)}">Código para equipo</button>
        <button class="btn btn-sm" type="button" data-sa="ubicacion" data-suc="${esc(a.sucursal)}">Ubicación</button>
        <button class="btn btn-sm" type="button" data-sa="activo" data-suc="${esc(a.sucursal)}">${a.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-sm" type="button" data-sa="restablecer" data-suc="${esc(a.sucursal)}" title="Borra el PIN y los equipos autorizados; mantiene la ubicación">Restablecer</button>
        <button class="btn btn-sm btn-danger" type="button" data-sa="eliminar" data-suc="${esc(a.sucursal)}" title="Borra el acceso de la sucursal; el historial de ventas no se toca">Eliminar</button>
      </div></td></tr>`;
  }).join('');
}

async function accionAcceso(datos, alTerminar) {
  try {
    const r = await API.accionAccesoSucursal(datos);
    alTerminar?.();
    await cargarAccesos();
    showMsg($('sa-msg'), r.mensaje, true);
  } catch (err) {
    handleError(err, $('sa-msg'));
  }
}

async function generarCodigo(sucursal) {
  try {
    const r = await API.accionAccesoSucursal({ tipo: 'codigo', sucursal });
    const el = $('sa-msg');
    el.className = 'alert form-msg alert-ok';
    el.innerHTML = `Código para autorizar un equipo de <b>${esc(sucursal)}</b>: <div class="sa-codigo">${r.codigo.replace(/(\d{4})(\d{4})/, '$1 $2')}</div>
      Vale por ${r.minutos} minutos y se usa una sola vez. En el local, abrí <b>${esc(location.origin)}/sucursal.html</b> en el equipo, permití la ubicación y cargá el código.`;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (err) {
    handleError(err, $('sa-msg'));
  }
}

function editarUbicacion(a) {
  const actual = a.ubicacion ? `${a.ubicacion.lat}, ${a.ubicacion.lng}` : '';
  const texto = prompt(`Ubicación de ${a.sucursal}: copiala de Google Maps (clic derecho sobre el local → las coordenadas).\nEjemplo: -25.2637, -57.5759`, actual);
  if (texto === null) return;
  const m = texto.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return showMsg($('sa-msg'), 'No entendí la ubicación. Tiene que ser latitud, longitud (por ejemplo -25.2637, -57.5759).', false);
  const radio = prompt('Radio permitido alrededor del local, en metros (50 a 5.000):', String(a.radio || 300));
  if (radio === null) return;
  accionAcceso({ tipo: 'ubicacion', sucursal: a.sucursal, lat: Number(m[1]), lng: Number(m[2]), radio: Number(radio) });
}

async function guardarHistorialSucursales() {
  const msgEl = $('sa-hist-msg');
  const texto = $('sa-hist-texto').value;
  if (!texto.trim()) return showMsg(msgEl, 'Pegá la planilla.', false);
  const anio = Number($('sa-hist-anio').value) || undefined;
  const r = leerHistorialSucursales(texto, anio);
  if (r.necesitaAnio) {
    $('sa-hist-anio-box').hidden = false;
    $('sa-hist-anio').focus();
    return showMsg(msgEl, 'La planilla no tiene columna Año: indicá a qué año corresponde y volvé a tocar Revisar y guardar.', false);
  }
  const meses = Object.keys(r.registros).sort();
  if (!meses.length) return showMsg(msgEl, r.errores[0]?.motivo || 'No encontré datos.', false);
  const sucursales = new Set(meses.flatMap((m) => Object.keys(r.registros[m])));
  const conocidas = new Set(nombresConocidos());
  const raras = conocidas.size ? [...sucursales].filter((n) => !conocidas.has(n)) : [];
  const avisos = [
    r.errores.length ? `${r.errores.length} problema${r.errores.length === 1 ? '' : 's'} no se van a guardar (línea ${r.errores[0].linea}: ${r.errores[0].motivo})` : '',
    raras.length ? `${raras.length} no coinciden con ninguna sucursal con ventas: ${raras.slice(0, 8).join(', ')}${raras.length > 8 ? '…' : ''}` : '',
  ].filter(Boolean);
  const detalle = `${sucursales.size} sucursales, de ${nombreMes(fechaDeMes(meses[0]))} a ${nombreMes(fechaDeMes(meses.at(-1)))}`;
  if (!confirm(`Se va a guardar el historial: ${detalle}.${avisos.length ? '\n\n' + avisos.join('\n') : ''}\n\n¿Guardar?`)) return;
  try {
    await API.accionAccesoSucursal({ tipo: 'historial', registros: r.registros });
    $('sa-hist-texto').value = '';
    $('sa-hist-archivo').value = '';
    $('sa-hist-anio-box').hidden = true;
    await cargarAccesos();
    showMsg(msgEl, `Guardado: ${detalle}.${avisos.length ? ' ' + avisos.join('. ') + '.' : ''}`, true);
  } catch (err) {
    handleError(err, msgEl);
  }
}

// ---- Configurar sucursales (admin): listado maestro y objetivos por mes ----

function setupConfigSucursales() {
  $('cfg-obj-mes').value = hoyAsuncion().slice(0, 7);
  $('cfg-obj-mes').addEventListener('change', cargarObjetivosConfig);
  for (const pre of ['cfg-maestro', 'cfg-obj']) {
    $(`${pre}-archivo`).addEventListener('change', async () => {
      const f = $(`${pre}-archivo`).files[0];
      if (f) $(`${pre}-texto`).value = await leerArchivo(f);
    });
  }
  $('suc-config').addEventListener('click', (e) => {
    const base = e.target.closest('[data-cfg-base]');
    if (base) descargarBase(base.dataset.cfgBase);
    const g = e.target.closest('[data-cfg-guardar]');
    if (g) { if (g.dataset.cfgGuardar === 'horario') guardarHorario(); else guardarConfig(g.dataset.cfgGuardar); }
  });
  $('hc-body').addEventListener('input', pintarCruces);
}

// ---- Horario comercial (día comercial de las cargas con hora) ----

const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const quitarTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function pintarHorario() {
  const h = suc.config?.horario;
  if (!h) return;
  $('hc-body').innerHTML = ORDEN_DIAS.map((wd) => `<tr>
    <td>${NOMBRES_DIA[wd]}</td>
    <td><input type="time" id="hc-ap-${wd}" value="${h.general[wd].apertura}" aria-label="Apertura ${NOMBRES_DIA[wd]}"></td>
    <td><input type="time" id="hc-ci-${wd}" value="${h.general[wd].cierre}" aria-label="Cierre ${NOMBRES_DIA[wd]}"> <span class="hc-cruza" id="hc-x-${wd}"></span></td>
  </tr>`).join('');
  pintarCruces();
  $('hc-propios').value = Object.entries(h.sucursales || {})
    .flatMap(([s, dias]) => Object.entries(dias).map(([wd, d]) => [s, NOMBRES_DIA[wd], d.apertura, d.cierre].join(';'))).join('\n');
  const propias = Object.keys(h.sucursales || {}).length;
  $('hc-estado').textContent = h.actualizado
    ? `Actualizado ${fmtFechaHora(h.actualizado)}${h.por ? ` por ${h.por}` : ''}${propias ? ` · ${propias} sucursal${propias === 1 ? '' : 'es'} con horario propio` : ''}.`
    : 'Es el horario sugerido: revisalo y guardalo.';
}

// "cierra al día siguiente" al lado de cada cierre menor o igual que la apertura.
function pintarCruces() {
  for (const wd of ORDEN_DIAS) {
    const ap = minutos($(`hc-ap-${wd}`)?.value), ci = minutos($(`hc-ci-${wd}`)?.value);
    const el = $(`hc-x-${wd}`);
    if (el) el.textContent = ap !== null && ci !== null && ci <= ap ? `del ${NOMBRES_DIA[(wd + 1) % 7].toLowerCase()}` : '';
  }
}

// "LUQUE 1;Viernes;16:00;03:00" (o Todos) → { SUC: { wd: { apertura, cierre } } }.
function leerHorariosPropios(texto) {
  const dias = NOMBRES_DIA.map((n) => quitarTildes(n.toLowerCase()));
  const sucursales = {}, errores = [];
  String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l, i) => {
    const c = l.split(/\t|;|,/).map((x) => x.trim());
    if (i === 0 && /sucursal/i.test(c[0])) return;
    const suc = normalizarSucursal(c[0]);
    const dia = quitarTildes(String(c[1] || '').toLowerCase());
    const wds = dia === 'todos' ? [0, 1, 2, 3, 4, 5, 6] : [dias.findIndex((d) => d === dia || d.slice(0, 3) === dia.slice(0, 3))];
    if (!suc || wds[0] < 0 || minutos(c[2]) === null || minutos(c[3]) === null) { errores.push(`línea ${i + 1}: "${l}"`); return; }
    for (const wd of wds) (sucursales[suc] ||= {})[wd] = { apertura: c[2], cierre: c[3] };
  });
  return { sucursales, errores };
}

async function guardarHorario() {
  const msgEl = $('hc-msg');
  const general = {};
  for (const wd of ORDEN_DIAS) {
    const apertura = $(`hc-ap-${wd}`).value, cierre = $(`hc-ci-${wd}`).value;
    if (minutos(apertura) === null || minutos(cierre) === null) { showMsg(msgEl, `Completá la apertura y el cierre del ${NOMBRES_DIA[wd].toLowerCase()}.`, false); return; }
    general[wd] = { apertura, cierre };
  }
  const { sucursales, errores } = leerHorariosPropios($('hc-propios').value);
  if (errores.length) { showMsg(msgEl, `Revisá los horarios propios (Sucursal;Día;Apertura;Cierre): ${errores.slice(0, 3).join(', ')}.`, false); return; }
  const n = Object.keys(sucursales).length;
  if (!confirm(`Se va a guardar el horario comercial${n ? ` y ${n} sucursal${n === 1 ? '' : 'es'} con horario propio` : ''}.\n\nSe aplica en las próximas cargas con hora; lo ya cargado no cambia hasta que vuelvas a cargar esos días.\n\n¿Guardar?`)) return;
  try {
    await API.saveHorarioComercial(general, sucursales);
    suc.config = await API.getSucursalesConfig(suc.datos?.mes || hoyAsuncion().slice(0, 7));
    pintarHorario();
    showMsg(msgEl, 'Horario guardado. Se usa en las próximas cargas con hora.', true);
  } catch (err) {
    handleError(err, msgEl);
  }
}

function pintarEstadoConfig() {
  const m = suc.config?.maestro;
  $('cfg-maestro-estado').textContent = m?.filas?.length
    ? `Hay ${m.filas.length} sucursales cargadas (actualizado ${fmtFechaHora(m.actualizado)}).`
    : 'Todavía no está cargado.';
  const mes = $('cfg-obj-mes').value;
  const o = suc.cfgObj;
  $('cfg-obj-estado').textContent = !mes ? '' : o?.filas?.length
    ? `${nombreMes(fechaDeMes(mes))}: ${o.filas.length} sucursales con objetivo, total ${fmtMillones(o.filas.reduce((s, f) => s + f.objetivo, 0))}.`
    : `${nombreMes(fechaDeMes(mes))}: sin objetivos cargados.`;
}

async function cargarObjetivosConfig() {
  const mes = $('cfg-obj-mes').value;
  if (!mes) return;
  try { suc.cfgObj = (await API.getSucursalesConfig(mes)).objetivos; } catch { suc.cfgObj = null; }
  pintarEstadoConfig();
}

// Sucursales conocidas: las del mes abierto más las del listado.
function nombresConocidos() {
  return [...new Set([...(suc.res?.sucursales || []).map((s) => s.sucursal), ...suc.info.keys()])].sort();
}

function descargarBase(tipo) {
  const nombres = nombresConocidos();
  const msgEl = $(tipo === 'maestro' ? 'cfg-maestro-msg' : 'cfg-obj-msg');
  if (!nombres.length) { showMsg(msgEl, 'Primero cargá una planilla de ventas para conocer las sucursales.', false); return; }
  if (tipo === 'maestro') {
    descargarCsv('sucursales-zonas.csv', [['Sucursal', 'Zona', 'Encargado'],
      ...nombres.map((n) => [n, suc.info.get(n)?.zona || zonaSugerida(n), suc.info.get(n)?.encargado || ''])]);
    showMsg(msgEl, 'La zona viene sugerida por el nombre: corregila y completá el encargado.', true);
  } else {
    const mes = $('cfg-obj-mes').value;
    const obj = new Map((suc.cfgObj?.filas || []).map((f) => [f.sucursal, f.objetivo]));
    descargarCsv(`objetivos-sucursales-${mes}.csv`, [['Sucursal', 'Objetivo'], ...nombres.map((n) => [n, obj.get(n) ?? ''])]);
    showMsg(msgEl, 'Completá el objetivo de cada sucursal; las que quedan vacías no se cargan.', true);
  }
}

async function guardarConfig(tipo) {
  const pre = tipo === 'maestro' ? 'cfg-maestro' : 'cfg-obj';
  const msgEl = $(`${pre}-msg`);
  const texto = $(`${pre}-texto`).value;
  const mes = $('cfg-obj-mes').value;
  if (!texto.trim()) { showMsg(msgEl, 'Subí un archivo o pegá las filas.', false); return; }
  if (tipo === 'objetivos' && !mes) { showMsg(msgEl, 'Elegí el mes de los objetivos.', false); return; }
  const r = tipo === 'maestro' ? leerMaestro(texto) : leerObjetivos(texto);
  if (!r.filas.length) { showMsg(msgEl, r.errores[0]?.motivo || 'No encontré filas con datos.', false); return; }

  const conocidas = new Set(nombresConocidos());
  const raras = conocidas.size ? r.filas.map((f) => f.sucursal).filter((n) => !conocidas.has(n)) : [];
  const detalle = tipo === 'maestro'
    ? `${r.filas.length} sucursales en ${new Set(r.filas.map((f) => f.zona).filter(Boolean)).size} zonas`
    : `${r.filas.length} sucursales, total ${fmtMillones(r.filas.reduce((s, f) => s + f.objetivo, 0))} para ${nombreMes(fechaDeMes(mes))}`;
  const avisos = [
    r.errores.length ? `${r.errores.length} línea${r.errores.length === 1 ? '' : 's'} con problemas no se van a guardar (línea ${r.errores[0].linea}: ${r.errores[0].motivo})` : '',
    raras.length ? `${raras.length} no coinciden con ninguna sucursal con ventas: ${raras.slice(0, 8).join(', ')}${raras.length > 8 ? '…' : ''}` : '',
  ].filter(Boolean);
  if (!confirm(`Se va a reemplazar ${tipo === 'maestro' ? 'el listado' : 'los objetivos del mes'}: ${detalle}.${avisos.length ? '\n\n' + avisos.join('\n') : ''}\n\n¿Guardar?`)) return;

  try {
    if (tipo === 'maestro') await API.saveMaestro(r.filas);
    else await API.saveObjetivosSucursal(mes, r.filas);
    $(`${pre}-texto`).value = '';
    $(`${pre}-archivo`).value = '';
    if (tipo === 'objetivos' && mes !== suc.datos?.mes) await cargarObjetivosConfig();
    else await loadSucursales(suc.datos?.mes || undefined);
    showMsg(msgEl, `Guardado: ${detalle}.${avisos.length ? ' ' + avisos.join('. ') + '.' : ''}`, true);
  } catch (err) {
    handleError(err, msgEl);
  }
}

// ---- Exportar: Excel (CSV con ; y BOM, que Excel en español abre directo), PDF y compartir ----

const csvCelda = (v) => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function descargarCsv(nombre, filas) {
  const texto = '﻿' + filas.map((f) => f.map(csvCelda).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// PDF: el diálogo de imprimir del navegador ("Guardar como PDF"), en tema claro y sin menús.
function imprimir(titulo) {
  const html = document.documentElement;
  const tema = html.dataset.tema;
  const previo = document.title;
  html.dataset.tema = 'claro';
  document.title = titulo; // nombre sugerido del archivo
  const volver = () => {
    if (tema) html.dataset.tema = tema; else delete html.dataset.tema;
    document.title = previo;
  };
  window.addEventListener('afterprint', volver, { once: true });
  window.print();
}

// Compartir: el menú del teléfono (WhatsApp, Teams, correo…); en la compu se copia el texto.
async function compartirTexto(titulo, texto) {
  if (navigator.share) {
    try { await navigator.share({ title: titulo, text: texto }); } catch { /* cancelado */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(texto);
    showNotice('Resumen copiado: pegalo en WhatsApp, Teams o un correo.');
  } catch {
    showNotice('No se pudo copiar el resumen.', true);
  }
}

const lineaSuc = (s, i) => `${i + 1}. ${s.sucursal} — ${fmtMillones(s.total)}`;

// Datos de cada vista para exportar: { titulo, archivo, tabla?, texto }.
function datosExportar(que) {
  const mes = suc.datos.mes;
  const mesNombre = nombreMes(fechaDeMes(mes));
  const res = suc.res;
  if (que === 'ranking') {
    let lista = rankingFiltrado();
    if (suc.rank === 'riesgo') lista = lista.filter((s) => suc.avance.has(s.sucursal)).sort((a, b) => suc.avance.get(a.sucursal).proyeccionPct - suc.avance.get(b.sucursal).proyeccionPct);
    const filtro = [suc.zona && `zona ${suc.zona}`, suc.encargado && `encargado ${suc.encargado}`, suc.filtro.trim() && `"${suc.filtro.trim()}"`].filter(Boolean).join(', ');
    const tabla = [['Puesto', 'Sucursal', 'Zona', 'Encargado', 'Venta del mes', '% del total', 'Promedio por día', 'Días con venta', 'Objetivo', 'Avance', 'Proyección al cierre', 'Estado'],
      ...lista.map((s) => {
        const a = suc.avance.get(s.sucursal);
        return [s.puesto, s.sucursal, zonaDe(s.sucursal), suc.info.get(s.sucursal)?.encargado || '', s.total, fmtPct(s.total / (res.total || 1)),
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
    const tabla = [['Zona', 'Sucursales', 'Venta del mes', '% del total', 'Objetivo', 'Proyección al cierre', 'Proyección / objetivo'],
      ...zonas.map((z) => [z.zona, z.sucursales.length, z.total, fmtPct(z.total / (res.total || 1)), z.objetivo || '', z.objetivo ? Math.round(z.proyeccion) : '', z.objetivo ? fmtPct(z.proyeccion / z.objetivo) : ''])];
    const texto = [`Venta por zona · Baratote Minorista · ${mesNombre}`, '',
      ...zonas.map((z) => `- ${z.zona}: ${fmtMillones(z.total)} (${fmtPct(z.total / (res.total || 1))}, ${z.sucursales.length} suc.)${z.objetivo ? ` · proyecta ${fmtPct(z.proyeccion / z.objetivo)} del objetivo` : ''}`)].join('\n');
    return { titulo: `Ventas por zona ${mesNombre}`, archivo: `zonas-${mes}`, tabla, texto };
  }
  if (que === 'comparar') return datosExportarComparacion();
  if (que === 'horas') {
    if (!suc.horas.datos) return null;
    const r = resumenPorHora(suc.horas.datos, filtroHoras());
    const f = suc.horas.filtro;
    const quien = f ? ` · ${f.slice(2)}` : '';
    const tabla = [['Hora', ...r.fechas.map((x) => `${DIA_CORTO[wdDe(x)]} ${fmtFecha(x)}`), 'Total', '% del total'],
      ...r.horas.map((x, i) => [etiquetaHora(x), ...r.fechas.map((d) => r.celda(x, d)), r.porHora[i], fmtPct(r.porHora[i] / (r.total || 1))]),
      ['Total', ...r.fechas.map((d) => r.porDia[d]), r.total, '100%']];
    const top = r.horas.map((x, i) => [x, r.porHora[i]]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const texto = [`Venta por hora · Baratote Minorista · ${mesNombre}${quien}`,
      `Total: ${fmtMillones(r.total)} en ${r.fechas.length} días comerciales (del ${fmtFecha(r.fechas[0])} al ${fmtFecha(r.fechas.at(-1))}).`,
      '', 'Horas que más venden:', ...top.map(([x, v], i) => `${i + 1}. ${etiquetaHora(x)} — ${fmtMillones(v)} (${fmtPct(v / (r.total || 1))})`)].join('\n');
    return { titulo: `Venta por hora ${mesNombre}${quien}`, archivo: `venta-por-hora-${mes}${f ? '-' + f.slice(2).replace(/\W+/g, '-').toLowerCase() : ''}`, tabla, texto };
  }
  if (que === 'informe') {
    const info = suc.informe.datos?.informe;
    if (!info) return null;
    return { titulo: `Análisis ${mesNombre}`, archivo: `analisis-${mes}`, texto: `Análisis del mes · ${mesNombre}\n\n${info.texto}` };
  }
  return null;
}

function datosExportarComparacion() {
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

function exportar(que, formato) {
  const d = datosExportar(que);
  if (!d) { showNotice('No hay datos para exportar.', true); return; }
  if (formato === 'excel' && d.tabla) descargarCsv(`${d.archivo}.csv`, d.tabla);
  else if (formato === 'pdf') imprimir(d.titulo);
  else compartirTexto(d.titulo, d.texto);
}

// Los CSV de Excel en Windows suelen venir en Windows-1252 (Ñ, tildes): si UTF-8 falla, se reintenta.
async function leerArchivo(archivo) {
  const buf = await archivo.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

function revisarPlanilla() {
  const msgEl = $('suc-msg');
  msgEl.hidden = true;
  const texto = $('suc-texto').value;
  if (!texto.trim()) { showMsg(msgEl, 'Subí un archivo o pegá las filas de la planilla.', false); return; }
  // Con hora: se consolida por día comercial según el horario configurado.
  const conHora = tieneHora(texto);
  const leer = (mes) => (conHora ? leerPlanillaHoras(texto, mes, suc.config?.horario) : leerPlanilla(texto, mes));
  let r = leer();
  if (r.necesitaMes) {
    $('suc-mes-carga-box').hidden = false;
    r = leer($('suc-mes-carga').value);
  } else {
    $('suc-mes-carga-box').hidden = true;
  }
  r.conHora = conHora;
  suc.lectura = r;

  const errEl = $('suc-errores');
  errEl.hidden = !r.errores.length;
  errEl.innerHTML = r.errores.length
    ? `<li><b>${r.errores.length} línea${r.errores.length === 1 ? '' : 's'} con problemas (no se van a guardar):</b></li>`
      + r.errores.slice(0, 10).map((e) => `<li>Línea ${e.linea}: ${esc(e.motivo)}</li>`).join('')
      + (r.errores.length > 10 ? `<li>… y ${r.errores.length - 10} más.</li>` : '')
    : '';

  if (!r.filas.length) {
    $('suc-guardar').disabled = true;
    $('suc-preview').textContent = '';
    return;
  }
  const fechas = r.filas.map((f) => f.fecha).sort();
  const sucursales = new Set(r.filas.map((f) => f.sucursal)).size;
  const total = r.filas.reduce((s, f) => s + f.monto, 0);
  const meses = [...new Set(fechas.map((f) => f.slice(0, 7)))].map((m) => nombreMes(fechaDeMes(m))).join(', ');
  $('suc-preview').textContent = r.conHora
    ? `${fmtMiles(r.registros)} ventas con hora → ${fmtMiles(r.filas.length)} filas por día comercial · ${sucursales} sucursales · del ${fmtFecha(fechas[0])} al ${fmtFecha(fechas.at(-1))} (${meses}) · total ${fmtMillones(total)}`
    : `${fmtMiles(r.filas.length)} filas · ${sucursales} sucursales · del ${fmtFecha(fechas[0])} al ${fmtFecha(fechas.at(-1))} (${meses}) · total ${fmtMillones(total)}`;
  $('suc-guardar').disabled = false;
  // Con hora, el último día del archivo puede traer solo la madrugada: el control se hace sobre el último día con venta normal.
  let ultimoControl = fechas.at(-1);
  if (r.conHora) {
    const porDia = new Map();
    for (const f of r.filas) porDia.set(f.fecha, (porDia.get(f.fecha) || 0) + 1);
    const maximo = Math.max(...porDia.values());
    ultimoControl = [...porDia].filter(([, n]) => n >= maximo / 2).map(([f]) => f).sort().at(-1) || ultimoControl;
  }
  pintarControlMaestro(r.filas, ultimoControl);
  if (r.conHora) pintarResumenComercial(r);
}

// Qué hizo el día comercial con la planilla: madrugada movida, días que solo traen la madrugada, fuera de horario.
function pintarResumenComercial(r) {
  const el = $('suc-control');
  const partes = [];
  const pct = (v) => fmtPct(v / (r.total || 1));
  partes.push(`<p><b>Día comercial:</b> ${fmtMiles(r.madrugada.registros)} ventas de madrugada (${fmtMillones(r.madrugada.monto)}, ${pct(r.madrugada.monto)}) pasan al día que abrió la noche anterior. Lo vendido hasta el cierre cuenta para ese día y no se repite en el siguiente.</p>`);
  if (r.anteriores.length) {
    const monto = r.filas.filter((f) => r.anteriores.includes(f.fecha)).reduce((s, f) => s + f.monto, 0);
    partes.push(`<p><b>${r.anteriores.map((f) => `${DIA_CORTO[wdDe(f)]} ${fmtFecha(f)}`).join(', ')}:</b> la planilla trae solo su madrugada (${fmtMillones(monto)}). Se <b>suma</b> a lo que ya tenía ese día, sin reemplazarlo; si volvés a cargar esta planilla, se actualiza sin duplicar.</p>`);
  }
  if (r.fuera.registros) {
    partes.push(`<p>${fmtMiles(r.fuera.registros)} ventas fuera del horario comercial (${fmtMillones(r.fuera.monto)}) en ${r.fuera.sucursales.length} sucursal${r.fuera.sucursales.length === 1 ? '' : 'es'}: se cuentan igual, en su día. ${esc(r.fuera.sucursales.slice(0, 12).join(', '))}${r.fuera.sucursales.length > 12 ? '…' : ''}</p>`);
  }
  if (r.precision === 'hora') {
    partes.push('<p><b>Ojo:</b> la planilla viene agrupada por hora en punto (sin minutos). Las ventas de la hora del cierre (por ejemplo 00:00 a 00:59 con cierre a las 00:30) no se pueden partir y van completas al día anterior. Si podés, exportá con la hora exacta.</p>');
  }
  const previo = el.hidden ? '' : el.innerHTML;
  el.innerHTML = previo + partes.join('');
  el.className = `suc-control ${r.precision === 'hora' ? 'warn' : el.className.includes('warn') ? 'warn' : 'ok'}`;
  el.hidden = false;
}

// Contra el listado maestro: qué sucursales no vinieron el último día de la planilla y cuáles no están en el listado.
function pintarControlMaestro(filas, ultima) {
  const el = $('suc-control');
  const maestro = suc.config?.maestro?.filas;
  if (!maestro?.length) { el.hidden = true; return; }
  const cerradas = [...suc.cerradas.keys()];
  const { faltan } = controlMaestro(maestro, filas.filter((f) => f.fecha === ultima).map((f) => f.sucursal), NO_MINORISTA, cerradas);
  const { nuevas } = controlMaestro(maestro, filas.map((f) => f.sucursal), NO_MINORISTA, cerradas);
  const nombres = (arr) => esc(arr.slice(0, 25).join(', ')) + (arr.length > 25 ? ` y ${arr.length - 25} más` : '');
  const partes = [];
  if (faltan.length) partes.push(`<p><b>Faltan ${faltan.length} sucursal${faltan.length === 1 ? '' : 'es'} del listado el ${DIA_CORTO[wdDe(ultima)]} ${fmtFecha(ultima)}</b>${wdDe(ultima) === 1 ? ' (es lunes: varias no abren)' : ''}: ${nombres(faltan)}.</p>`);
  if (nuevas.length) partes.push(`<p><b>${nuevas.length} no figura${nuevas.length === 1 ? '' : 'n'} en el listado</b> (¿nueva o escrita distinto?): ${nombres(nuevas)}.</p>`);
  el.innerHTML = partes.length ? partes.join('') : `<p>Están todas las sucursales del listado (${maestro.length}).</p>`;
  el.className = `suc-control ${partes.length ? 'warn' : 'ok'}`;
  el.hidden = false;
}

async function guardarPlanilla() {
  const msgEl = $('suc-msg');
  if (!suc.lectura?.filas.length) return;
  // Una planilla sin hora sobre días que ya estaban por día comercial mezcla criterios: se pide confirmar.
  const comerciales = new Set(suc.datos?.comerciales || []);
  const pisa = suc.lectura.conHora ? [] : [...new Set(suc.lectura.filas.map((f) => f.fecha))].filter((f) => comerciales.has(f));
  if (pisa.length && !confirm(`${pisa.length} día${pisa.length === 1 ? '' : 's'} de esta planilla (${pisa.slice(0, 5).map(fmtFecha).join(', ')}${pisa.length > 5 ? '…' : ''}) ya estaba${pisa.length === 1 ? '' : 'n'} cargado${pisa.length === 1 ? '' : 's'} por día comercial (con hora).\n\nEsta planilla no trae la hora: esos días van a quedar por día calendario y se pierde su detalle por hora.\n\n¿Guardar igual?`)) return;
  const btn = $('suc-guardar');
  btn.disabled = true;
  try {
    const avisar = !$('suc-teams-box').hidden && $('suc-teams').checked;
    const l = suc.lectura;
    const res = await API.saveSucursales(l.filas, avisar, l.conHora ? { horas: l.horas, anteriores: l.anteriores, ultimaFecha: l.ultimaFecha } : null);
    const partes = res.resumen.map((x) => {
      const dias = x.dias ? `${fmtMiles(x.filas)} filas de ${x.dias} día${x.dias === 1 ? '' : 's'}` : '';
      const madrugada = x.parciales ? `${dias ? ' y ' : ''}se sumó la madrugada de ${x.parciales === 1 ? 'su último día' : `${x.parciales} días`}` : '';
      return `${nombreMes(fechaDeMes(x.mes))}: ${dias}${madrugada}${x.reemplazadas ? ` (se reemplazaron ${fmtMiles(x.reemplazadas)} filas anteriores de esos días)` : ''}`;
    });
    const teams = res.teams ? (res.teams.ok ? ' Se avisó en Teams.' : ` No se pudo avisar en Teams: ${res.teams.detalle}`) : '';
    showMsg(msgEl, `Planilla guardada. ${partes.join(' · ')}.${teams}`, true);
    suc.lectura = null;
    $('suc-texto').value = '';
    $('suc-archivo').value = '';
    $('suc-preview').textContent = '';
    $('suc-errores').hidden = true;
    $('suc-control').hidden = true;
    const mes = res.resumen.at(-1).mes;
    suc.informe.mes = null; // que el análisis se vuelva a pedir (puede haber quedado desactualizado)
    suc.horas.mes = null; // y la venta por hora
    await loadSucursales(mes);
    msgEl.textContent += ' Para actualizar el análisis del mes, andá a la pestaña Informe IA.';
  } catch (err) {
    btn.disabled = false;
    handleError(err, msgEl);
  }
}

async function borrarMesSucursales() {
  const mes = suc.datos?.mes;
  if (!mes || !confirm(`¿Borrar todas las ventas por sucursal de ${nombreMes(fechaDeMes(mes))}? No se puede deshacer.`)) return;
  try {
    await API.deleteSucursalesMes(mes);
    showMsg($('suc-msg'), `Se borraron las ventas de ${nombreMes(fechaDeMes(mes))}.`, true);
    await loadSucursales();
  } catch (err) {
    handleError(err, $('suc-msg'));
  }
}

async function loadSucursales(mes) {
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

function renderSucursales() {
  const d = suc.datos;
  const el = $('suc-contenido');
  if (!d?.mes || !d.filas.length) {
    $('suc-sub').textContent = '';
    $('suc-subtabs').hidden = true;
    if (isAdmin()) $('suc-carga').open = true;
    el.innerHTML = `<div class="card empty">Todavía no hay ventas por sucursal cargadas.${isAdmin() ? ' Cargá la primera planilla arriba.' : ''}</div>`;
    return;
  }
  suc.res = resumirMes(d.filas);
  suc.alertas = alertasSucursales(suc.res, { cerradas: suc.cerradas.keys() });
  const objetivos = (suc.config?.objetivos?.filas || []).filter((o) => !suc.cerradas.has(o.sucursal));
  suc.avance = avanceSucursales(suc.res, objetivos, ultimoDiaCompleto(suc.res.dias).fecha, pesosDelMes(d.mes));
  const com = d.comerciales || [];
  const criterio = !com.length ? '' : ` · por día comercial ${com.length === 1 ? `el ${fmtDiaMes(com[0])}` : `del ${fmtDiaMes(com[0])} al ${fmtDiaMes(com.at(-1))}`}`;
  $('suc-sub').textContent = `${nombreMes(fechaDeMes(d.mes))} · actualizado ${fmtFechaHora(d.actualizado)}${d.por ? ' por ' + d.por : ''}${criterio}`;
  $('suc-sub').title = com.length ? 'Días cargados con hora: lo vendido después de medianoche y hasta el cierre cuenta para el día que abrió la noche anterior.' : '';

  const nAlertas = suc.alertas.sinVentaReciente.length + suc.alertas.caidas.length;
  $('suc-alertas-n').textContent = nAlertas;
  $('suc-alertas-n').hidden = nAlertas === 0;
  $('suc-subtabs').hidden = false;
  if (!['resumen', 'informe', 'ranking', 'zonas', 'calor', 'horas', 'comparar', 'alertas'].includes(suc.sub)) suc.sub = 'resumen';
  suc.cache[d.mes] = d.filas;
  document.querySelectorAll('#suc-subtabs [data-sub]').forEach((b) => {
    const activa = b.dataset.sub === suc.sub;
    b.classList.toggle('active', activa);
    b.setAttribute('aria-selected', String(activa));
  });

  if (suc.sub === 'ranking') { el.innerHTML = rankingHtml(); renderRankingTabla(); }
  else if (suc.sub === 'zonas') el.innerHTML = zonasHtml();
  else if (suc.sub === 'calor') el.innerHTML = calorHtml();
  else if (suc.sub === 'horas') { el.innerHTML = horasHtml(); if (suc.horas.mes !== d.mes) cargarHoras(d.mes); }
  else if (suc.sub === 'comparar') { el.innerHTML = compararHtml(); renderComparacion(); }
  else if (suc.sub === 'informe') { el.innerHTML = informeHtml(); if (suc.informe.mes !== d.mes) cargarInforme(d.mes); }
  else if (suc.sub === 'alertas') el.innerHTML = alertasHtml();
  else el.innerHTML = resumenSucHtml();
  contarNumeros(el);
}

function resumenSucHtml() {
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
function avanceAcumuladoHtml() {
  const mes = suc.datos.mes;
  const res = suc.res;
  const c = parseCorte(fechaDeMes(mes));
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  const pub = suc.published?.corte?.startsWith(mes) ? suc.published : null;
  const pesos = pesosDelMes(mes);
  const objetivo = pub ? Number(pub.obj?.min) || 0 : 0;
  const fecha = (d) => `${mes}-${String(d).padStart(2, '0')}`;
  const frac = (d) => fraccionPonderada(fecha(d), pesos) || 0;

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

function pesosSemanaHtml(peso, cuenta) {
  return DIAS_SEMANA.map((x) => `
    <div class="sp-dia${esFinde(x.wd) ? ' finde' : ''}">
      <span>${x.nombre.slice(0, 3)}</span>
      <strong>${cuenta[x.wd] ? fmtPct(peso[x.wd]) : '—'}</strong>
      <small>${cuenta[x.wd]} día${cuenta[x.wd] === 1 ? '' : 's'}</small>
    </div>`).join('');
}

// ---- Ranking: 10 que más venden, 10 que menos, o todas; el buscador busca en todas ----

// Botones de exportar de una vista: data-exp = qué se exporta.
const exportarHtml = (que, excel = true) => `
  <div class="exportar" role="group" aria-label="Exportar">
    ${excel ? `<button class="btn btn-sm" type="button" data-exp="${que}" data-formato="excel" title="Descargar para Excel">Excel</button>` : ''}
    <button class="btn btn-sm" type="button" data-exp="${que}" data-formato="pdf" title="Imprimir o guardar como PDF">PDF</button>
    <button class="btn btn-sm" type="button" data-exp="${que}" data-formato="compartir" title="Compartir el resumen">Compartir</button>
  </div>`;

function rankingHtml() {
  const zonas = [...new Set([...suc.info.values()].map((m) => m.zona).filter(Boolean))].sort();
  const encargados = [...new Set([...suc.info.values()].map((m) => m.encargado).filter(Boolean))].sort();
  if (!zonas.includes(suc.zona)) suc.zona = '';
  if (!encargados.includes(suc.encargado)) suc.encargado = '';
  const opciones = (arr, actual, todas) => `<option value="">${todas}</option>${arr.map((v) => `<option${v === actual ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
  return `
    <div class="card">
      <div class="card-head">
        <div class="seg-btns" role="group" aria-label="Qué sucursales mostrar">
          <button type="button" data-rank="top">Más venden</button>
          <button type="button" data-rank="bottom">Menos venden</button>
          ${suc.avance.size ? '<button type="button" data-rank="riesgo">Lejos del objetivo</button>' : ''}
          <button type="button" data-rank="todas">Todas</button>
        </div>
        ${exportarHtml('ranking')}
      </div>
      <div class="rank-filtros">
        <input id="suc-buscar" class="suc-buscar" type="search" placeholder="Buscar sucursal" value="${esc(suc.filtro)}" aria-label="Buscar sucursal">
        ${zonas.length ? `<select id="suc-zona" aria-label="Zona">${opciones(zonas, suc.zona, 'Todas las zonas')}</select>` : ''}
        ${encargados.length ? `<select id="suc-encargado" aria-label="Encargado">${opciones(encargados, suc.encargado, 'Todos los encargados')}</select>` : ''}
      </div>
      <div class="table-wrap" id="suc-ranking"></div>
      <p class="muted small" id="suc-ranking-pie" style="margin:12px 0 0"></p>
    </div>`;
}

// Sucursales del ranking con puesto general, según buscador, zona y encargado (sin el corte de 10).
function rankingFiltrado() {
  const q = suc.filtro.trim().toUpperCase();
  return suc.res.sucursales
    .map((s, i) => ({ ...s, puesto: i + 1 }))
    .filter((s) => (!q || s.sucursal.includes(q))
      && (!suc.zona || suc.info.get(s.sucursal)?.zona === suc.zona)
      && (!suc.encargado || suc.info.get(s.sucursal)?.encargado === suc.encargado));
}

function renderRankingTabla() {
  const res = suc.res;
  if (!res || !$('suc-ranking')) return;
  if (suc.rank === 'riesgo' && !suc.avance.size) suc.rank = 'top';
  document.querySelectorAll('[data-rank]').forEach((b) => b.classList.toggle('active', b.dataset.rank === suc.rank));
  const base = rankingFiltrado();
  const filtrando = Boolean(suc.filtro.trim() || suc.zona || suc.encargado);
  let lista;
  if (suc.rank === 'riesgo') {
    lista = base.filter((s) => suc.avance.has(s.sucursal)).sort((a, b) => suc.avance.get(a.sucursal).proyeccionPct - suc.avance.get(b.sucursal).proyeccionPct);
    if (!filtrando) lista = lista.slice(0, 10);
  } else if (filtrando || suc.rank === 'todas') lista = base;
  else if (suc.rank === 'bottom') lista = base.slice(-10).reverse();
  else lista = base.slice(0, 10);
  const hayZona = suc.info.size > 0;
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
      ${hayObj ? `<td class="r">${a ? fmtPct(a.avance) : '—'}</td><td class="r">${a ? avanceChip(s.sucursal) : '<span class="muted small">sin objetivo</span>'}</td>` : ''}
      <td class="r opc">${fmtPct(s.total / (res.total || 1))}</td>
      <td class="r opc">${fmtMillones(s.total / Math.max(s.diasConVenta, 1))}</td>
      ${hayObj ? '' : `<td class="r opc">${s.diasConVenta}</td>`}
      <td class="col-barra"><div class="rank-bar"><div style="width:${((s.total / top) * 100).toFixed(1)}%"></div></div></td>
    </tr>`;
  }).join('');
  const columnas = 6 + hayZona + (hayObj ? 1 : 0);
  $('suc-ranking').innerHTML = `
    <table class="suc-tabla">
      <thead><tr><th>#</th><th>Sucursal</th>${hayZona ? '<th class="opc">Zona</th>' : ''}<th class="r">Venta del mes</th>${hayObj ? '<th class="r" title="Venta hasta el último día completo sobre el objetivo del mes">Avance</th><th class="r" title="Proyección al cierre sobre el objetivo">Proyección</th>' : ''}<th class="r opc">% del total</th><th class="r opc">Prom./día</th>${hayObj ? '' : '<th class="r opc">Días</th>'}<th class="col-barra"></th></tr></thead>
      <tbody>${filas || `<tr><td colspan="${columnas + 1}" class="muted">No hay sucursales con ese filtro.</td></tr>`}</tbody>
    </table>`;
  $('suc-ranking-pie').innerHTML = filtrando
    ? `${lista.length} sucursal${lista.length === 1 ? '' : 'es'} con ese filtro.`
    : `Mostrando ${lista.length} de ${res.sucursales.length} sucursales. Tocá una para ver su detalle.${suc.rank !== 'todas' ? ' <button class="btn-link" type="button" data-rank="todas">Ver todas</button>' : ''}`;
}

// ---- Zonas ----

// Zonas del mes con objetivo y proyección sumados (solo de las sucursales con objetivo).
function zonasDelMes() {
  const maestro = suc.info.size ? [...suc.info.values()] : suc.res.sucursales.map((s) => ({ sucursal: s.sucursal, zona: zonaSugerida(s.sucursal) }));
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

function zonasHtml() {
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
        <span class="zona-cifras"><b>${fmtMillones(z.total)}</b><small class="muted">${fmtPct(z.total / (res.total || 1))} del total</small></span>
        ${e ? `<span class="chip ${e.clase}" title="Proyección al cierre sobre el objetivo de la zona">${fmtPct(z.proyeccion / z.objetivo)}</span>` : ''}
      </summary>
      <ul class="zona-lista">${z.sucursales.map((s) => `
        <li data-suc="${esc(s.sucursal)}" role="button" tabindex="0">
          <span>${esc(s.sucursal)}${chipCerrada(s.sucursal)}</span>${avanceChip(s.sucursal)}<b>${fmtMillones(s.total)}</b>
        </li>`).join('')}</ul>
    </details>`;
  }).join('');
  const aviso = suc.info.size
    ? ''
    : `<p class="nota" style="margin:0 0 14px">Zonas sugeridas por el nombre de cada sucursal. ${isAdmin() ? 'Para definir las zonas reales y los encargados, cargá el listado en <b>Configurar sucursales</b>.' : 'El administrador puede cargar las zonas reales.'}</p>`;
  return `
    <div class="card-head" style="margin-bottom:12px">
      <p class="muted small" style="margin:0">Tocá una zona para ver sus sucursales.${suc.avance.size ? ' El porcentaje de color es la proyección al cierre contra el objetivo.' : ''}</p>
      ${exportarHtml('zonas')}
    </div>
    ${aviso}
    <div class="zonas">${tarjetas}</div>`;
}

// ---- Mapa de calor ----
// Modo "propio": cada día contra lo que esa sucursal vende normalmente ese día de la semana
// (verde = mejor que lo habitual, rojo = peor). Modo "monto": todas en la misma escala.

const LETRA_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const CALOR_TOPE = 0.4; // ±40% ya es el color más fuerte
const CALOR_INICIAL = 30;

// Promedio de cada sucursal por día de la semana (solo días con venta).
function promediosPorDiaSemana(s) {
  const suma = Array(7).fill(0), n = Array(7).fill(0);
  for (const [f, v] of Object.entries(s.dias)) {
    if (!v) continue;
    const wd = wdDe(f);
    suma[wd] += v;
    n[wd]++;
  }
  return suma.map((x, i) => (n[i] ? x / n[i] : 0));
}

function colorCalor(v, ref, modo) {
  if (!v) return 'var(--sin-venta)';
  if (modo === 'monto') return `color-mix(in srgb, var(--calor-alto) ${(Math.min(v / ref, 1) * 100).toFixed(0)}%, var(--calor-bajo))`;
  if (!ref) return 'var(--calor-neutro)';
  const t = Math.max(-1, Math.min(1, (v / ref - 1) / CALOR_TOPE));
  return t >= 0
    ? `color-mix(in srgb, var(--pos) ${(t * 100).toFixed(0)}%, var(--calor-neutro))`
    : `color-mix(in srgb, var(--neg) ${(-t * 100).toFixed(0)}%, var(--calor-neutro))`;
}

function calorHtml() {
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
function mostrarCeldaCalor(i) {
  const v = Number(i.dataset.v), p = Number(i.dataset.p), f = i.dataset.f;
  const nombreDia = DIAS_SEMANA.find((x) => x.wd === wdDe(f)).nombre.toLowerCase();
  const comp = v && p ? ` · ${varHtml(v / p - 1)} vs. sus ${pluralDia(nombreDia)} (${fmtM1Gs(p)})` : '';
  $('calor-info').innerHTML = `<b>${esc(i.dataset.s)}</b> · ${DIA_CORTO[wdDe(f)]} ${fmtFecha(f)}: ${v ? `<b>${fmtM1Gs(v)}</b>${comp}` : 'sin venta'}`;
  document.querySelectorAll('.calor i.sel').forEach((x) => x.classList.remove('sel'));
  i.classList.add('sel');
}

// ---- Venta por hora (días cargados con hora, por día comercial) ----


async function cargarHoras(mes) {
  suc.horas = { ...suc.horas, mes, datos: null, error: null };
  try {
    suc.horas.datos = (await API.getHorasSucursales(mes)).horas || {};
  } catch (err) {
    suc.horas.error = err.message;
  }
  if (suc.sub === 'horas' && suc.datos?.mes === mes) $('suc-contenido').innerHTML = horasHtml();
}

function filtroHoras() {
  const f = suc.horas.filtro;
  if (f.startsWith('s:')) return (s) => s === f.slice(2);
  if (f.startsWith('z:')) return (s) => zonaDe(s) === f.slice(2);
  return () => true;
}

function horasHtml() {
  const h = suc.horas;
  const cab = (cuerpo) => `<div class="card"><div class="card-head" style="margin-bottom:10px"><div><h2>Venta por hora</h2>
    <p class="muted small">Cuánto se vendió en cada hora de cada día comercial. Las filas <b>(+1)</b> son la madrugada del día siguiente, que cuenta para el día que abrió la noche anterior.</p></div></div>${cuerpo}</div>`;
  if (h.error) return cab(`<div class="alert alert-error">${esc(h.error)}</div>`);
  if (!h.datos) return cab('<p class="muted">Cargando…</p>');
  const nombres = [...new Set(Object.values(h.datos).flatMap((d) => Object.keys(d)))].sort();
  if (!nombres.length) {
    return cab(`<div class="empty">Este mes no tiene ventas cargadas con hora.${isAdmin() ? ' Cargá la planilla con la columna <b>HORA</b> (por ejemplo <code>SUCURSAL, HORA, Día, Suma de MONTO</code>) en <b>Cargar planilla</b>.' : ''}</div>`);
  }
  if (h.filtro.startsWith('s:') && !nombres.includes(h.filtro.slice(2))) h.filtro = '';
  const r = resumenPorHora(h.datos, filtroHoras());
  const zonas = [...new Set(nombres.map(zonaDe))].sort();
  const opciones = `<option value="">Todas las sucursales (${nombres.length})</option>
    <optgroup label="Zona">${zonas.map((z) => `<option value="z:${esc(z)}"${h.filtro === `z:${z}` ? ' selected' : ''}>${esc(z)}</option>`).join('')}</optgroup>
    <optgroup label="Sucursal">${nombres.map((s) => `<option value="s:${esc(s)}"${h.filtro === `s:${s}` ? ' selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`;
  const filtro = `<div class="hr-filtros"><label for="hr-filtro">Ver</label><select id="hr-filtro">${opciones}</select>
    ${exportarHtml('horas')}</div>`;
  if (!r.total) return cab(`${filtro}<p class="muted">Sin ventas con hora para este filtro.</p>`);

  const pct = (v) => fmtPct(v / (r.total || 1));
  const suma = (cond) => r.horas.reduce((s, x, i) => s + (cond(x) ? r.porHora[i] : 0), 0);
  const madrugada = suma((x) => x >= 24), tarde = suma((x) => x >= 16 && x < 24), antes = suma((x) => x < 16);
  const kpis = `<div class="hr-kpis">
    <div><span class="muted small">Total con hora</span><b>${fmtMillones(r.total)}</b><span class="muted small">${r.fechas.length} día${r.fechas.length === 1 ? '' : 's'}</span></div>
    <div><span class="muted small">Hora pico</span><b>${etiquetaHora(r.pico.hora).replace(' (+1)', '')}${r.pico.hora >= 24 ? ' <small>(madrugada)</small>' : ''}</b><span class="muted small">${pct(r.pico.monto)} de la venta</span></div>
    <div><span class="muted small">Antes de las 16:00</span><b>${pct(antes)}</b><span class="muted small">${fmtMillones(antes)}</span></div>
    <div><span class="muted small">16:00 a medianoche</span><b>${pct(tarde)}</b><span class="muted small">${fmtMillones(tarde)}</span></div>
    <div><span class="muted small">Madrugada (+1)</span><b>${pct(madrugada)}</b><span class="muted small">${fmtMillones(madrugada)}</span></div>
  </div>`;

  // Semáforo: cada hora contra la mejor hora del mismo día (o del mes, según la escala elegida).
  const maxCelda = Math.max(...r.horas.flatMap((x) => r.fechas.map((f) => r.celda(x, f))), 1);
  const maxDia = Object.fromEntries(r.fechas.map((f) => [f, Math.max(...r.horas.map((x) => r.celda(x, f)), 1)]));
  const refDe = (f) => (h.escala === 'mes' ? maxCelda : maxDia[f]);
  const maxHora = Math.max(...r.porHora, 1);
  const cabDias = r.fechas.map((f) => `<th class="${esFinde(wdDe(f)) ? 'finde' : ''}">${DIA_CORTO[wdDe(f)]}<br>${fmtDiaMes(f)}</th>`).join('');
  const filas = r.horas.map((x, i) => `<tr class="${x >= 24 ? 'hr-madrugada' : ''}">
      <th scope="row">${etiquetaHora(x)}</th>
      ${r.fechas.map((f) => {
        const v = r.celda(x, f);
        const ref = refDe(f);
        const nivel = v ? (v / ref >= 2 / 3 ? 'bien' : v / ref >= 1 / 3 ? 'regular' : 'poco') : '';
        const comp = v ? ` · ${fmtPct(v / ref)} de la mejor hora ${h.escala === 'mes' ? 'del mes' : 'del día'} (${nivel === 'bien' ? 'vende bien' : nivel === 'regular' ? 'regular' : 'vende poco'})` : '';
        const titulo = `${DIA_CORTO[wdDe(f)]} ${fmtFecha(f)} · ${etiquetaHora(x)}: ${v ? `Gs. ${fmtMiles(v)}` : 'sin venta'}${comp}`;
        return `<td class="hr-celda" title="${titulo}">${v ? `<span class="hr-pill ${nivel}">${v < 50000 ? '&lt;0,1' : fmtM1(v)}</span>` : ''}</td>`;
      }).join('')}
      <td class="hr-total"><span class="hr-barra" style="width:${(r.porHora[i] / maxHora * 100).toFixed(0)}%"></span><b>${fmtM1(r.porHora[i])}</b></td>
      <td class="hr-pct">${pct(r.porHora[i])}</td>
    </tr>`).join('');
  const pie = `<tr class="hr-pie"><th scope="row">Total</th>${r.fechas.map((f) => `<td>${fmtM1(r.porDia[f])}</td>`).join('')}<td class="hr-total"><b>${fmtM1(r.total)}</b></td><td class="hr-pct">100%</td></tr>`;
  return cab(`${filtro}${kpis}
    <div class="hr-semaforo">
      <div class="hr-leyenda"><span><i class="bien"></i>vende bien</span><span><i class="regular"></i>regular</span><span><i class="poco"></i>vende poco</span></div>
      <div class="seg-btns" role="group" aria-label="Comparar cada hora con">
        <button type="button" data-hr-escala="dia" class="${h.escala !== 'mes' ? 'active' : ''}">Dentro de cada día</button>
        <button type="button" data-hr-escala="mes" class="${h.escala === 'mes' ? 'active' : ''}">Todo el mes</button>
      </div>
    </div>
    <p class="muted small" style="margin:0 0 8px">Montos en millones de guaraníes. ${h.escala === 'mes'
      ? 'Cada hora se compara con la hora que más vendió en todo el mes: los días flojos quedan en rojo.'
      : 'Cada hora se compara con la hora que más vendió <b>ese mismo día</b>: verde, cerca de la mejor hora; amarillo, a mitad; rojo, vende poco.'}</p>
    <div class="hr-wrap"><table class="hr-tabla">
      <thead><tr><th>Hora</th>${cabDias}<th>Total</th><th>%</th></tr></thead>
      <tbody>${filas}${pie}</tbody>
    </table></div>`);
}

// ---- Informe IA ----

// El administrador copia un resumen de los datos, lo consulta en su chat de IA y pega
// acá la respuesta; los comerciales ven el análisis publicado.

async function cargarInforme(mes) {
  suc.informe = { mes, datos: null, error: null, borrador: null };
  try {
    suc.informe.datos = await API.getInforme(mes);
  } catch (err) {
    suc.informe.error = err.message;
  }
  if (suc.sub === 'informe' && suc.datos?.mes === mes) $('suc-contenido').innerHTML = informeHtml();
}

function pintarInforme() {
  if (suc.sub === 'informe') $('suc-contenido').innerHTML = informeHtml();
}

// Copia al portapapeles el texto para el chat: instrucciones + datos del mes resumidos.
async function copiarParaIA() {
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

async function publicarInforme() {
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

async function borrarInformeMes() {
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

function informeHtml() {
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

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const etiquetaDia = (fecha) => `${DIA_CORTO[wdDe(fecha)]} ${fmtDiaMes(fecha)}`;

// Filas de un mes (las del mes abierto ya están; otros meses se piden una vez).
async function filasMes(mes) {
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

const fmtM1Gs = (v) => `Gs. ${fmtM1(v)} M`;

function compararHtml() {
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

let cmpTurno = 0;

async function renderComparacion() {
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
function ordenarPorVariacion(lista, clave) {
  const conVar = lista.filter((s) => s[clave] !== null);
  if (suc.cmp.orden === 'caidas') return conVar.sort((x, y) => x[clave] - y[clave]).slice(0, 10);
  if (suc.cmp.orden === 'subas') return conVar.sort((x, y) => y[clave] - x[clave]).slice(0, 10);
  return lista;
}

function controlesTabla(total) {
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

function filtrarCmp(lista) {
  const q = suc.cmp.filtro.trim().toUpperCase();
  return q ? lista.filter((s) => s.sucursal.includes(q)) : null;
}

function comparacionParHtml(r) {
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
async function filasHastaSemanas(n) {
  const hasta = ultimoDiaCompleto(suc.res.dias).fecha;
  const lunes = sumarDias(hasta, -((wdDe(hasta) + 6) % 7) - 7 * (n - 1));
  const meses = [...new Set([lunes.slice(0, 7), hasta.slice(0, 7)])];
  return (await Promise.all(meses.map(filasMes))).flat();
}

const rangoSemana = (s) => `${fmtDiaMes(s.desde)}–${fmtDiaMes(s.hasta)}`;
// En celular, de varias columnas de fechas solo se muestran las dos últimas.
const opcSi = (i, n) => (i < n - 2 ? ' opc' : '');

function comparacionSemanasHtml(r) {
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

function comparacionSemanaHtml(r) {
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

// ---- Alertas ----

function alertasHtml() {
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

function abrirPanel(nombre) {
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
    <p class="muted small" style="margin:0 0 12px">${nombreMes(fechaDeMes(suc.datos.mes))} · puesto ${i + 1} de ${res.sucursales.length}${info?.zona ? ` · zona ${esc(info.zona)}` : ''}${info?.encargado ? ` · encargado: ${esc(info.encargado)}` : ''}</p>
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
async function marcarCerrada(nombre, sugerida) {
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

function cerrarPanel() {
  if ($('suc-panel').hidden) return;
  $('suc-panel').hidden = true;
  $('suc-panel-fondo').hidden = true;
  document.body.classList.remove('panel-abierto');
}

// ---------- Comparativo anual ----------
// El año en curso resaltado contra los dos anteriores: mes a mes o acumulado, con la variación
// de cada mes contra el año anterior y una tabla de calor por unidad.

const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const anual = { datos: null, u: leerPref('anual-u', 'total'), modo: leerPref('anual-modo', 'mes'), cmp: leerPref('anual-cmp', '0-1'), ver: leerPref('anual-ver', 'pct'), puntos: null };

function setupAnual() {
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

async function loadAnual() {
  try {
    anual.datos = await API.getAnual();
    renderAnual();
  } catch (err) {
    handleError(err);
  }
}

const nombreUnidad = (u) => VISTAS_UNIDAD.find((x) => x.id === u)?.nombre || '';
// En el celular los gráficos se dibujan a su ancho, así el texto no queda diminuto.
const anualMovil = matchMedia('(max-width: 600px)');
// DER deja lugar para el nombre de cada año al final de su línea.
const medidasAnual = () => (anualMovil.matches ? { W: 360, IZQ: 40, DER: 34 } : { W: 720, IZQ: 50, DER: 44 });
anualMovil.addEventListener('change', () => { if (currentView() === 'anual' && anual.datos) renderAnual(); });
const acumular = (s) => { let t = 0; return s.map((v) => (v === null ? null : (t += v))); };

function renderAnual() {
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
function lineasAnualHtml(r) {
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

function mostrarMesAnual(i) {
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
function barrasAnualHtml(r) {
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
function calorAnualHtml(meses, Y, n) {
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
function faltaAnualHtml(d, Y, n) {
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

function exportarAnual(formato) {
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

async function guardarMesesAnual() {
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

// ---------- Objetivo sugerido (admin) ----------
// Mismo mes de los dos años anteriores, el mes anterior y el sugerido editable;
// confirmarlo lo copia como objetivo en Cargar ventas.

const objetivos = { datos: null, calculado: null, turno: 0 };
const nombreCorto = (mes) => nombreMes(`${mes}-01`).split(' ')[0].toLowerCase();

function setupObjetivos() {
  $('obj-mes').value = hoyAsuncion().slice(0, 7);
  $('obj-mes').addEventListener('change', () => { if ($('obj-mes').value) loadObjetivos($('obj-mes').value); });
  $('obj-leer').addEventListener('click', guardarPlanillaObjetivos);
  const el = $('obj-contenido');
  el.addEventListener('input', (e) => {
    if (e.target.matches('input[data-neg]')) { formatearInput(e.target); recalcularSugerido(); }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-obj]');
    if (!b) return;
    if (b.dataset.obj === 'crecer') aplicarCrecimiento();
    else if (b.dataset.obj === 'guardar') guardarSugeridoUI();
    else if (b.dataset.obj === 'confirmar') confirmarSugeridoUI();
  });
}

async function loadObjetivos(mes) {
  const turno = ++objetivos.turno;
  try {
    const datos = await API.getObjetivos(mes);
    if (turno !== objetivos.turno) return;
    objetivos.datos = datos;
    renderObjetivos();
  } catch (err) {
    handleError(err);
  }
}

// Valores del sugerido escritos en la tabla (sin formato).
function leerSugeridoUI() {
  const v = {};
  document.querySelectorAll('#obj-contenido input[data-neg]').forEach((el) => {
    const n = el.value.replace(/\D/g, '');
    if (n) v[el.dataset.neg] = Number(n);
  });
  return v;
}

function renderObjetivos() {
  const d = objetivos.datos;
  const [y] = d.mes.split('-').map(Number);
  const nombre = nombreMes(`${d.mes}-01`);
  const enCurso = d.mes === d.mesEnCurso;
  const s = d.sugerido;
  const h1 = d.historia[y - 1]?.valores || null;
  const h2 = d.historia[y - 2]?.valores || null;
  const ant = d.anterior?.valores || null;
  // Lo que calcula el portal según el movimiento; si todavía no hay sugerido guardado, arranca con eso.
  const calc = calcularSugerido(h1, d.movimiento);
  objetivos.calculado = calc;
  const guardado = s?.valores && Object.keys(s.valores).length ? s.valores : null;
  const sug = guardado || calc.valores;
  const editable = enCurso || d.mes > d.mesEnCurso;

  $('obj-titulo').textContent = `Objetivo sugerido · ${nombre}`;
  $('obj-sub').innerHTML = s?.confirmado
    ? `<span class="chip ok">Confirmado</span> el ${fmtFechaHora(s.confirmado)} por ${esc(s.confirmadoPor)}: es el objetivo cargado en Cargar ventas.`
    : guardado
      ? `<span class="chip warn">Sin confirmar</span> Guardado ${fmtFechaHora(s.actualizado)} por ${esc(s.por)}.`
      : Object.keys(calc.valores).length
        ? '<span class="chip">Calculado</span> El sugerido de abajo lo calculó el portal según el movimiento de las ventas: revisalo, ajustalo si hace falta y confirmalo.'
        : 'Todavía no hay datos para calcular el sugerido: pegá tu planilla abajo.';

  const fuente = (h) => (h?.fuente === 'portal' ? ' <small class="muted" title="Del cierre publicado en el portal">(portal)</small>' : '');
  const monto = (v) => (v === undefined || v === null ? '<span class="muted">—</span>' : fmtMiles(v));
  const varCelda = (a, b) => { const v = variacion(a, b); return v === null ? '<span class="muted">—</span>' : varHtml(v); };
  const conVar = (a, b) => `${monto(a)}${b !== null && b !== undefined && a !== undefined && a !== null ? `<small class="obj-var">${varCelda(a, b)}</small>` : ''}`;

  const filaNegocio = (n) => `
    <tr class="${n.id === 'min' || n.id === 'may' ? 'sub-row' : ''}">
      <td data-label="Negocio">${esc(n.nombre)}</td>
      <td class="r opc" data-label="${y - 2}">${monto(h2?.[n.id])}</td>
      <td class="r" data-label="${y - 1}">${conVar(h1?.[n.id], h2?.[n.id])}</td>
      <td class="r opc" data-label="Mes anterior">${monto(ant?.[n.id])}</td>
      <td class="r" data-label="Calculado">${conVar(calc.valores[n.id], h1?.[n.id])}</td>
      <td class="r obj-sug" data-label="Sugerido ${y}"><input type="text" inputmode="numeric" data-neg="${n.id}" value="${sug[n.id] !== undefined ? fmtMiles(sug[n.id]) : ''}" aria-label="Sugerido ${esc(n.nombre)} ${y}"${editable ? '' : ' disabled'}></td>
      <td class="r" data-label="vs ${y - 1}" data-var="${n.id}">${varCelda(sug[n.id], h1?.[n.id])}</td>
    </tr>`;
  const filaTotal = (clave, titulo, clase) => {
    const t = (v) => (v && Object.keys(v).length ? totales(v)[clave] : null);
    return `
    <tr class="${clase}">
      <td data-label="Negocio">${titulo}</td>
      <td class="r opc" data-label="${y - 2}">${monto(t(h2))}</td>
      <td class="r" data-label="${y - 1}">${conVar(t(h1), t(h2))}</td>
      <td class="r opc" data-label="Mes anterior">${monto(t(ant))}</td>
      <td class="r" data-label="Calculado">${conVar(t(calc.valores), t(h1))}</td>
      <td class="r" data-label="Sugerido ${y}" data-total="${clave}">${monto(t(sug))}</td>
      <td class="r" data-label="vs ${y - 1}" data-var="${clave}">${varCelda(t(sug), t(h1))}</td>
    </tr>`;
  };
  const neg = (id) => NEGOCIOS.find((n) => n.id === id);
  const mesAnt = sumarDias(`${d.mes}-01`, -1).slice(0, 7);
  const sinHistoria = !h1 && !h2;

  // Explicación del cálculo, unidad por unidad.
  const mesesTxt = (ms) => ms.map((m) => `${nombreCorto(m)} ${m.slice(0, 4)}`).join(', ');
  const explicacion = Object.entries(calc.detalle).map(([id, x]) => {
    const mov = x.tendencia === null
      ? 'sin meses para comparar: queda igual'
      : `${fmtVar(x.aplicada)} (${mesesTxt(x.meses)} contra el año anterior${x.topeada ? `: fue ${fmtVar(x.tendencia)}, se limitó a ${fmtVar(x.aplicada)}` : ''})`;
    return `<li><b>${esc(neg(id).nombre)}:</b> ${esc(nombreCorto(d.mes))} ${y - 1} ${fmtMillones(x.base)} × ${mov} = <b>${fmtMillones(calc.valores[id])}</b></li>`;
  }).join('');

  $('obj-contenido').innerHTML = `
    ${sinHistoria ? `<p class="nota" style="margin:0 0 14px">No hay datos de ${esc(nombreCorto(d.mes))} de ${y - 2} ni de ${y - 1}. Pegá tu planilla abajo para poder calcular el sugerido.</p>` : ''}
    <div class="card">
      <div class="table-wrap">
        <table class="obj-tabla tarjetas">
          <thead><tr>
            <th>Negocio</th>
            <th class="r opc">${y - 2}${fuente(d.historia[y - 2])}</th>
            <th class="r">${y - 1}${fuente(d.historia[y - 1])}</th>
            <th class="r opc">${esc(nombreMes(`${mesAnt}-01`))}${fuente(d.anterior)}</th>
            <th class="r" title="Calculado por el portal según el movimiento de las ventas">Calculado</th>
            <th class="r">Sugerido ${y}</th>
            <th class="r">vs ${y - 1}</th>
          </tr></thead>
          <tbody>
            ${filaTotal('baratote', 'Baratote', 'grupo-row')}
            ${filaNegocio(neg('min'))}
            ${filaNegocio(neg('may'))}
            ${filaNegocio(neg('fgl'))}
            ${filaNegocio(neg('fbt'))}
            ${filaTotal('general', 'General', 'total-row')}
          </tbody>
        </table>
      </div>
      <p class="muted small" style="margin:12px 0 0">Baratote = Minorista + Mayorista. General = las cuatro unidades. Debajo de ${y - 1} y de Calculado, la variación contra el año anterior.</p>
      ${explicacion ? `
      <details class="obj-explica" open>
        <summary>Cómo se calculó</summary>
        <p class="small" style="margin:8px 0 6px">Para cada unidad: lo que vendió en ${esc(nombreCorto(d.mes))} del año pasado, movido según cómo vienen las ventas de los últimos meses cerrados contra los mismos meses del año anterior (hasta 3 meses; el movimiento se limita a ±${Math.round(TOPE_TENDENCIA * 100)}%). Redondeado al millón.</p>
        <ul class="small">${explicacion}</ul>
      </details>` : ''}
      ${editable ? `
      <div class="obj-acciones">
        <div class="obj-crecer">
          <label for="obj-crec" class="small">Usar lo calculado con un ajuste de</label>
          <div><input type="text" inputmode="decimal" id="obj-crec" value="0" aria-label="Ajuste en porcentaje"><span>%</span>
          <button class="btn btn-sm" type="button" data-obj="crecer"${Object.keys(calc.valores).length ? '' : ' disabled title="No hay datos para calcular"'}>Aplicar</button></div>
        </div>
        <div class="actions" style="margin:0">
          <button class="btn" type="button" data-obj="guardar">Guardar sugerido</button>
          ${enCurso ? `<button class="btn btn-primary" type="button" data-obj="confirmar">Confirmar como objetivo de ${esc(nombreCorto(d.mes))}</button>` : ''}
        </div>
      </div>
      ${enCurso ? '' : `<p class="muted small" style="margin:10px 0 0">Es un mes que todavía no empezó: guardá el sugerido y confirmalo cuando arranque ${esc(nombreCorto(d.mes))}.</p>`}`
    : `<p class="muted small" style="margin:12px 0 0">${esc(nombre)} ya terminó: el sugerido queda solo como referencia.</p>`}
      <div class="alert form-msg" id="obj-msg" hidden></div>
    </div>`;
}

// Al escribir en el sugerido: totales y variaciones al día, sin repintar la tabla.
function recalcularSugerido() {
  const d = objetivos.datos;
  const [y] = d.mes.split('-').map(Number);
  const h1 = d.historia[y - 1]?.valores || null;
  const v = leerSugeridoUI();
  const t = totales(v);
  const pintarVar = (clave, a, b) => {
    const el = document.querySelector(`#obj-contenido [data-var="${clave}"]`);
    const x = variacion(a, b);
    if (el) el.innerHTML = x === null ? '<span class="muted">—</span>' : varHtml(x);
  };
  for (const n of NEGOCIOS) pintarVar(n.id, v[n.id], h1?.[n.id]);
  for (const clave of ['baratote', 'general']) {
    document.querySelector(`#obj-contenido [data-total="${clave}"]`).textContent = t[clave] ? fmtMiles(t[clave]) : '—';
    pintarVar(clave, t[clave] || null, h1 ? totales(h1)[clave] : null);
  }
}

// Pone en el sugerido lo calculado por el portal, con un ajuste opcional (por ejemplo +3%).
function aplicarCrecimiento() {
  const calc = objetivos.calculado?.valores || {};
  const g = Number(String($('obj-crec').value).replace(',', '.')) || 0;
  document.querySelectorAll('#obj-contenido input[data-neg]').forEach((el) => {
    const base = calc[el.dataset.neg];
    if (base !== undefined) el.value = fmtMiles(Math.round((base * (1 + g / 100)) / 1e6) * 1e6);
  });
  recalcularSugerido();
}

async function guardarSugeridoUI(silencioso = false) {
  const d = objetivos.datos;
  try {
    const r = await API.guardarSugerido(d.mes, leerSugeridoUI());
    d.sugerido = r.sugerido;
    if (!silencioso) { renderObjetivos(); showMsg($('obj-msg'), 'Sugerido guardado.', true); }
    return true;
  } catch (err) {
    handleError(err, $('obj-msg'));
    return false;
  }
}

async function confirmarSugeridoUI() {
  const d = objetivos.datos;
  const v = leerSugeridoUI();
  const falta = NEGOCIOS.filter((n) => !(v[n.id] > 0));
  if (falta.length) { showMsg($('obj-msg'), `Completá el sugerido de ${falta.map((n) => n.nombre).join(', ')}.`, false); return; }
  let draft = null;
  try { draft = await API.getDraft(); } catch { /* sin borrador */ }
  const mesCarga = draft?.corte?.slice(0, 7);
  const lineas = [
    `Se va a cargar como objetivo de ${nombreMes(`${d.mes}-01`)}:`,
    ...NEGOCIOS.map((n) => `• ${n.nombre}: ${fmtMillones(v[n.id])}`),
    `Total: ${fmtMillones(NEGOCIOS.reduce((s, n) => s + v[n.id], 0))}`,
  ];
  if (mesCarga && mesCarga !== d.mes) {
    lineas.push('', `La carga de ventas pasa de ${nombreCorto(mesCarga)} a ${nombreCorto(d.mes)}, con las ventas en cero.`);
    if (mesCarga < d.mes && !esUltimoDiaDelMes(draft.corte)) lineas.push(`Ojo: ${nombreCorto(mesCarga)} todavía no tiene el cierre cargado (último corte: ${fmtFecha(draft.corte)}). Si falta publicarlo, hacelo antes de confirmar.`);
  }
  lineas.push('', 'La comparativa (mes anterior y año anterior) se completa con los datos de esta tabla.', '', '¿Confirmar?');
  if (!confirm(lineas.join('\n'))) return;
  if (!(await guardarSugeridoUI(true))) return;
  try {
    const r = await API.confirmarSugerido(d.mes);
    d.sugerido = r.sugerido;
    renderObjetivos();
    showMsg($('obj-msg'), `Listo: es el objetivo de ${nombreCorto(d.mes)} en Cargar ventas${r.mesNuevo ? ', con la fecha de corte en ' + fmtFecha(r.draft.corte) + ' y las ventas en cero' : ''}. Cargá las ventas y publicá para que lo vean los comerciales.`, true);
  } catch (err) {
    handleError(err, $('obj-msg'));
  }
}

async function guardarPlanillaObjetivos() {
  const msgEl = $('obj-planilla-msg');
  const difEl = $('obj-diferencias');
  difEl.hidden = true;
  const texto = $('obj-texto').value;
  if (!texto.trim()) { showMsg(msgEl, 'Pegá la planilla.', false); return; }
  const mesElegido = Number($('obj-mes').value.slice(5)) || null;
  const r = leerPlanillaObjetivos(texto, mesElegido);
  const registros = registrosPorMes(r.bloques);
  const meses = Object.keys(registros).sort();
  if (!meses.length) { showMsg(msgEl, r.errores[0]?.motivo || 'No encontré datos. La planilla tiene que empezar con la fila AÑO.', false); return; }

  const enCurso = hoyAsuncion().slice(0, 7);
  const historia = meses.filter((m) => m < enCurso);
  const sugeridos = meses.filter((m) => m >= enCurso);
  const dif = diferenciasTotales(r.bloques);
  if (dif.length) {
    difEl.innerHTML = `<p><b>Totales de la planilla que no coinciden con la suma de sus negocios</b> (el portal usa la suma):</p><ul>${dif.map((x) => `<li>${esc(nombreMes(`${x.anio}-${String(x.mes).padStart(2, '0')}-01`))} · ${x.campo === 'baratote' ? 'Baratote' : 'General'}: la planilla dice ${fmtMiles(x.planilla)}, la suma da ${fmtMiles(x.calculado)} (${x.planilla > x.calculado ? '+' : '−'}${fmtMiles(Math.abs(x.planilla - x.calculado))}).</li>`).join('')}</ul>`;
    difEl.hidden = false;
  }
  const lista = (arr) => arr.map((m) => nombreMes(`${m}-01`)).join(', ');
  const aviso = [
    historia.length ? `Historia (meses terminados): ${lista(historia)}.` : '',
    sugeridos.length ? `Sugerido: ${lista(sugeridos)}${sugeridos.some((m) => objetivos.datos?.sugerido?.confirmado && m === objetivos.datos.mes) ? ' (reemplaza el sugerido confirmado: vas a tener que confirmarlo de nuevo)' : ''}.` : '',
    r.errores.length ? `${r.errores.length} problema${r.errores.length === 1 ? '' : 's'} en la planilla (no se guarda esa celda): ${r.errores[0].motivo}` : '',
    dif.length ? 'Hay totales que no coinciden (ver abajo).' : '',
  ].filter(Boolean);
  if (!confirm(`${aviso.join('\n\n')}\n\n¿Guardar?`)) return;
  try {
    await API.guardarPlanillaObjetivos(registros);
    showMsg(msgEl, `Planilla guardada. ${aviso.slice(0, 2).join(' ')}`, true);
    $('obj-texto').value = '';
    await loadObjetivos($('obj-mes').value);
  } catch (err) {
    handleError(err, msgEl);
  }
}

// ---------- Cierre de mes ----------
// Resumen final de un mes ya terminado: por defecto el anterior al actual.

const cierre = { datos: null, suc: null, informe: null, turno: 0 };

function setupCierre() {
  $('cierre-mes').addEventListener('change', () => loadCierre($('cierre-mes').value));
  $('cierre-contenido').addEventListener('click', (e) => {
    const exp = e.target.closest('[data-cexp]');
    if (exp) { exportarCierre(exp.dataset.cexp); return; }
    const ir = e.target.closest('[data-cierre-suc]');
    if (ir) { suc.mesPedido = cierre.datos.mes; location.hash = 'sucursales'; return; }
    if (e.target.closest('[data-cargar-cierre]')) location.hash = 'ventas';
  });
}

async function loadCierre(mes) {
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
function estadoCierre(pct, completo) {
  if (!completo) return estado(pct);
  if (pct >= 1) return { texto: 'Cumplido', clase: 'ok' };
  if (pct >= 0.9) return { texto: 'Cerca', clase: 'warn' };
  return { texto: 'No cumplido', clase: 'risk' };
}

function cierreDatos() {
  const d = cierre.datos;
  const rep = d.reporte;
  const fin = ultimoDiaDelMes(fechaDeMes(d.mes));
  return { d, rep, r: calcularReporte(rep), fin, completo: rep.corte >= fin, nombre: nombreMes(fechaDeMes(d.mes)) };
}

function renderCierre() {
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
function cierreSucursales() {
  const { filas, cfg } = cierre.suc;
  const cerradas = new Set((cfg.cerradas || []).map((c) => c.sucursal));
  const res = resumirMes(filas);
  const abiertas = res.sucursales.filter((s) => !cerradas.has(s.sucursal));
  const hasta = res.dias.at(-1).fecha;
  const objetivos = (cfg.objetivos?.filas || []).filter((o) => !cerradas.has(o.sucursal));
  const avance = avanceSucursales(res, objetivos, hasta, cierre.datos.reporte?.pesos || PESOS_MINORISTA);
  const zonas = cfg.maestro?.filas?.length ? resumenZonas(res, cfg.maestro.filas) : [];
  return { res, abiertas, cerradas, avance, zonas, hasta };
}

function cierreSucursalesHtml() {
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
        ${zonas.length ? `<div><h3>Por zona</h3><ol class="cierre-lista">${zonas.map((z) => `<li><span>${esc(z.zona)}</span><b>${fmtMillones(z.total)}</b></li>`).join('')}</ol></div>` : ''}
      </div>
    </div>`;
}

function cierreInformeHtml() {
  if (!cierre.informe) return '';
  return `
    <details class="card informe cierre-informe-card">
      <summary><h2>Análisis del mes (IA)</h2><span class="muted small">Publicado ${fmtFechaHora(cierre.informe.publicado)} · tocá para ver</span></summary>
      <div class="informe-texto">${informeAHtml(cierre.informe.texto)}</div>
    </details>`;
}

function exportarCierre(formato) {
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
function avisoCierreHtml(p) {
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

// ---------- Dashboard ----------

let dashKey = null;
let climaPedido = 0;

// El pronóstico se pide como mucho cada 30 min (el servidor lo guarda 3 h).
async function cargarClima() {
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
let sucAlertasPedido = 0;
async function cargarAlertasSucursales() {
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

async function refreshDashboard(force = false) {
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

// Escala de la barra: 0–120%, el objetivo (100%) queda en 83,3%.
const barW = (p) => (Math.min(Math.max(p, 0), 1.2) / 1.2) * 100;

function bar(avance, proyeccionPct, color, thin = false) {
  return `
    <div class="bar${thin ? ' thin' : ''}">
      <div class="proj" style="width:${barW(proyeccionPct).toFixed(2)}%;background:${color.claro}"></div>
      <div class="real" style="width:${barW(avance).toFixed(2)}%;background:${color.fuerte}"></div>
      <div class="target"></div>
    </div>`;
}

const chipEstado = (p) => { const e = estado(p); return `<span class="chip ${e.clase}">${e.texto}</span>`; };
const varClase = (v) => (v === null ? 'var-na' : v >= 0 ? 'var-pos' : 'var-neg');
const varHtml = (v) => `<b class="${varClase(v)}">${fmtVar(v)}</b>`;

// Etiqueta para unidades cuya proyección lineal es solo orientativa (Fineboats).
const tagRef = (c) => (c.referencial ? ' <span class="tag-ref" title="Sus ventas no siguen un ritmo diario: tomá la proyección como orientativa.">Referencial</span>' : '');

// ---- 2. Mini gráfico: avance de la unidad en las últimas publicaciones del mes ----
function sparklineHtml(serie, color) {
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

function unidadCard(titulo, calendario, c, color, manual, extra = '', serie = []) {
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

function canal(c) {
  return `
    <div>
      <div class="canal-head">
        <strong><i class="dot" style="background:${COLOR[c.id].fuerte}"></i>${esc(c.nombre)}${c.ponderada ? ' <span class="tag-ref" title="Proyección ponderada por el peso de cada día de la semana.">Ponderada</span>' : ''}</strong>
        <span>${fmtPct(c.avance)} · proy. ${fmtPct(c.proyeccionPct)} · ${fmtMillones(c.real)} de ${fmtMillones(c.objetivo)}</span>
      </div>
      ${bar(c.avance, c.proyeccionPct, COLOR[c.id], true)}
    </div>`;
}

const fmtM1 = (v) => ((Number(v) || 0) / 1e6).toLocaleString('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Columnas apiladas por unidad: cada tramo es su venta sobre el objetivo total.
// 100% del objetivo = 82% del alto.
function evolucionHtml() {
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
function composicionHtml(r) {
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
function comparativaHtml(r, corte) {
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

// Medidor semicircular 0–120%; la marca blanca es el objetivo (100%).
// El arco se dibuja en CSS desde 0 hasta --ang (animado); el color sale del estado.
function gauge(p, clase) {
  const ang = (Math.min(Math.max(p, 0), 1.2) / 1.2) * 180;
  return `
    <div class="gauge gauge-${clase}" role="img" aria-label="Proyección ${fmtPct(p)} del objetivo">
      <div class="gauge-arc" style="--ang:${ang.toFixed(1)}deg"></div>
      <div class="gauge-target"></div>
      <div class="gauge-text"><strong data-contar>${fmtPct(p)}</strong><span>del objetivo</span></div>
    </div>`;
}

// Sección destacada: proyección al cierre del mes.
function proyeccionHtml(r, corte) {
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
function iconoClima(simbolo = '') {
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

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Clima de lo que queda del mes y proyección de Minorista ajustada por lluvia (referencial).
function climaHtml(r, p) {
  const c = parseCorte(p.corte);
  const ultimo = new Date(Date.UTC(c.y, c.m, 0)).getUTCDate();
  if (c.d >= ultimo) return '';
  const clima = state.clima || { dias: [] };
  const porFecha = new Map((clima.dias || []).map((d) => [d.fecha, d]));
  const pesos = p.pesos || PESOS_MINORISTA;
  const pesoWd = Object.fromEntries(DIAS_SEMANA.map((d) => [d.wd, Number(pesos[d.k]) || 0]));
  let pesoMes = 0;
  for (let d = 1; d <= ultimo; d++) pesoMes += pesoWd[new Date(Date.UTC(c.y, c.m - 1, d)).getUTCDay()];

  const tiles = [];
  for (let d = c.d + 1; d <= ultimo; d++) {
    const fecha = `${c.y}-${String(c.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const wd = new Date(Date.UTC(c.y, c.m - 1, d)).getUTCDay();
    const x = porFecha.get(fecha);
    const fuerte = wd === 5 || wd === 6 || wd === 0;
    const llueve = x && x.lluvia >= AJUSTE_LLUVIA.umbralMm;
    const peso = pesoMes > 0 ? pesoWd[wd] / pesoMes : 0;
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
function rapidoHtml(r, p) {
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

function renderDashboard() {
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
        <td class="r">${fmtM1(c.promedioDia)}</td>
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
              <tr><th>Unidad</th><th class="r">Faltante</th><th class="r opc">Días</th><th class="r">Prom./día</th><th class="r">Necesario/día</th></tr>
            </thead>
            <tbody>${ritmoRows}</tbody>
          </table>
        </div>
        <p class="nota">Necesario/día en <span class="necesario-alto">naranja</span>: hay que vender por día más que el promedio actual para llegar al objetivo. En <span class="necesario-ok">azul</span>: con el ritmo actual alcanza.</p>
      </div>
    </div>
    </div>`;
  contarNumeros(el);
}

init();
