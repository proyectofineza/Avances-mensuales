import * as API from './api.js';
import {
  UNIDADES, IDS, DIAS_SEMANA, PESOS_MINORISTA, AJUSTE_LLUVIA, parseCorte,
  calcularReporte, estado, diasOperativos, diasUnidad, normalizarReporte, validarReporte, proyeccionLluvia,
  mesAnterior, mismoMesAnioAnterior, fmtMillones, fmtMiles, fmtPct, fmtVar, fmtFecha, fmtDiaMes,
  fmtFechaHora, nombreMes, fmtCI, hoyAsuncion,
} from './calc.js';
import { armarContexto, textoParaCopiar, informeAHtml, MAX_TEXTO } from './informe.js';
import {
  leerPlanilla, resumirMes, alertasSucursales, pesoSemana, compararDias, mismoDiaSemana, ultimoDiaCompleto, ultimasSemanas, NO_MINORISTA,
} from './sucursales.js';

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
    location.replace('index.html');
    return;
  }
  $('user-name').textContent = state.user.nombre;
  $('user-rol').textContent = ROL_TEXTO[state.user.rol] || state.user.rol;
  $('user-avatar').textContent = state.user.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  setupTema();
  setupMenu();
  $('tabs').hidden = false;
  document.querySelectorAll('.solo-admin').forEach((el) => { el.hidden = !isAdmin(); });

  $('btn-salir').addEventListener('click', async () => {
    try { await API.logout(); } finally { location.replace('index.html'); }
  });
  $('notice-close').addEventListener('click', () => { $('notice-wrap').hidden = true; });

  if (isAdmin()) {
    setupVentas();
    setupUsuarios();
  }
  setupSucursales();

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
  $('sidebar-fondo').addEventListener('click', () => abrir(false));
  $('tabs').addEventListener('click', (e) => { if (e.target.closest('.tab')) abrir(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('menu-abierto')) abrir(false); });
}

const TITULO_VISTA = { ventas: 'Cargar ventas', usuarios: 'Usuarios', dashboard: 'Dashboard', sucursales: 'Sucursales' };

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

const VISTAS = ['ventas', 'usuarios', 'dashboard', 'sucursales'];

function currentView() {
  const h = location.hash.slice(1);
  const permitidas = isAdmin() ? VISTAS : ['dashboard', 'sucursales'];
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
  if (view === 'sucursales') loadSucursales();
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

function unidadCell(u) {
  return `
      <td>
        <div class="unidad-nombre">${esc(u.nombre)}</div>
        <div class="unidad-meta">${u.grupo ? 'Canal · ' : ''}${CAL_CORTO[u.calendario]}${u.ponderado ? ' · ponderado' : ''}</div>
      </td>`;
}

const grupoCell = `
      <td>
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
    `<tr class="grupo-row">${grupoCell}<td class="r" id="bar-obj"></td><td class="r" id="bar-real"></td><td class="r" id="av-bar"></td></tr>`,
    (u) => `
      <td class="r">${montoInput('data-campo="obj"', u.id, `Objetivo mensual ${u.nombre}`)}</td>
      <td class="r">${montoInput('data-campo="real"', u.id, `Venta acumulada ${u.nombre}`)}</td>
      <td class="r" id="av-${u.id}"></td>`,
  );

  $('dias-body').innerHTML = filas(
    `<tr class="grupo-row">${grupoCell}<td></td><td></td><td></td></tr>`,
    (u) => `
      <td class="r"><input class="num dias-input" inputmode="numeric" maxlength="2" data-dias="mes" data-id="${u.id}" aria-label="Días del mes ${esc(u.nombre)}"></td>
      <td class="r"><input class="num dias-input" inputmode="numeric" maxlength="2" data-dias="curso" data-id="${u.id}" aria-label="Día en curso ${esc(u.nombre)}"></td>
      <td class="r" id="ri-${u.id}"></td>`,
  );

  $('comp-body').innerHTML = filas(
    `<tr class="grupo-row">${grupoCell}<td class="r" id="comp-bar-ant"></td><td class="r" id="comp-bar-aa"></td></tr>`,
    (u) => `
      <td class="r">${montoInput('data-comp="ant"', u.id, `Venta mes anterior ${u.nombre}`)}</td>
      <td class="r">${montoInput('data-comp="aa"', u.id, `Venta año anterior ${u.nombre}`)}</td>`,
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
    fillVentasForm();
    renderUltimaPub();
    loadTeamsEstado();
  } catch (err) {
    handleError(err, $('ventas-error'));
  }
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

async function publicar() {
  const errEl = $('ventas-error');
  errEl.hidden = true;
  const msg = validarReporte(state.draft);
  if (msg) { showMsg(errEl, msg, false); return; }

  const btn = $('btn-publicar');
  btn.disabled = true;
  try {
    await saveNow();
    const res = await API.publish($('avisar-teams').checked);
    const corte = fmtFecha(res.published.corte);
    if (res.teams === 'enviado') {
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
  $('tab-badge').textContent = n;
  $('tab-badge').hidden = n === 0;
}

function renderPendientes() {
  const pend = state.users.filter((u) => u.pendiente).sort((a, b) => (a.creado || '').localeCompare(b.creado || ''));
  $('pend-card').hidden = pend.length === 0 && $('pend-msg').hidden;
  $('pend-count').textContent = `${pend.length} pendiente${pend.length === 1 ? '' : 's'}`;
  $('pend-body').innerHTML = pend.length
    ? pend.map((u) => `
      <tr>
        <td style="white-space:nowrap">${fmtCI(u.ci)}</td>
        <td>${esc(u.nombre)}</td>
        <td style="white-space:nowrap">${fmtFechaHora(u.creado)}</td>
        <td class="r">
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
        <td style="white-space:nowrap">${fmtCI(u.ci)}</td>
        <td>${esc(u.nombre)}</td>
        <td>${ROL_TEXTO[u.rol] || esc(u.rol)}</td>
        <td><span class="chip ${u.activo ? 'ok' : 'off'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td style="white-space:nowrap">${conexionHtml(u)}</td>
        <td class="r">${acciones}</td>
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
  // Análisis del mes abierto: respuesta de /api/informe, último error y texto que se está editando.
  informe: { mes: null, datos: null, error: null, borrador: null },
};
const fechaDeMes = (mes) => `${mes}-01`;
const esFinde = (wd) => wd === 5 || wd === 6 || wd === 0;
const wdDe = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();

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
    else return;
    renderComparacion();
  });
  $('suc-contenido').addEventListener('click', (e) => {
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
  $('suc-contenido').addEventListener('keydown', (e) => {
    const fila = e.target.closest('[data-suc]');
    if (fila && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirPanel(fila.dataset.suc); }
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
  let r = leerPlanilla(texto);
  if (r.necesitaMes) {
    $('suc-mes-carga-box').hidden = false;
    r = leerPlanilla(texto, $('suc-mes-carga').value);
  } else {
    $('suc-mes-carga-box').hidden = true;
  }
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
  $('suc-preview').textContent = `${fmtMiles(r.filas.length)} filas · ${sucursales} sucursales · del ${fmtFecha(fechas[0])} al ${fmtFecha(fechas.at(-1))} (${meses}) · total ${fmtMillones(total)}`;
  $('suc-guardar').disabled = false;
}

async function guardarPlanilla() {
  const msgEl = $('suc-msg');
  if (!suc.lectura?.filas.length) return;
  const btn = $('suc-guardar');
  btn.disabled = true;
  try {
    const res = await API.saveSucursales(suc.lectura.filas);
    const partes = res.resumen.map((x) => `${nombreMes(fechaDeMes(x.mes))}: ${fmtMiles(x.filas)} filas de ${x.dias} día${x.dias === 1 ? '' : 's'}${x.reemplazadas ? ` (se reemplazaron ${fmtMiles(x.reemplazadas)} filas anteriores de esos días)` : ''}`);
    showMsg(msgEl, `Planilla guardada. ${partes.join(' · ')}.`, true);
    suc.lectura = null;
    $('suc-texto').value = '';
    $('suc-archivo').value = '';
    $('suc-preview').textContent = '';
    $('suc-errores').hidden = true;
    const mes = res.resumen.at(-1).mes;
    suc.informe.mes = null; // que el análisis se vuelva a pedir (puede haber quedado desactualizado)
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
    suc.datos = await API.getSucursales(mes);
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
  suc.alertas = alertasSucursales(suc.res);
  $('suc-sub').textContent = `${nombreMes(fechaDeMes(d.mes))} · actualizado ${fmtFechaHora(d.actualizado)}${d.por ? ' por ' + d.por : ''}`;

  const nAlertas = suc.alertas.sinVentaReciente.length + suc.alertas.caidas.length;
  $('suc-alertas-n').textContent = nAlertas;
  $('suc-alertas-n').hidden = nAlertas === 0;
  $('suc-subtabs').hidden = false;
  if (!['resumen', 'informe', 'ranking', 'calor', 'comparar', 'alertas'].includes(suc.sub)) suc.sub = 'resumen';
  suc.cache[d.mes] = d.filas;
  document.querySelectorAll('#suc-subtabs [data-sub]').forEach((b) => {
    const activa = b.dataset.sub === suc.sub;
    b.classList.toggle('active', activa);
    b.setAttribute('aria-selected', String(activa));
  });

  if (suc.sub === 'ranking') { el.innerHTML = rankingHtml(); renderRankingTabla(); }
  else if (suc.sub === 'calor') el.innerHTML = calorHtml();
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

function pesosSemanaHtml(peso, cuenta) {
  return DIAS_SEMANA.map((x) => `
    <div class="sp-dia${esFinde(x.wd) ? ' finde' : ''}">
      <span>${x.nombre.slice(0, 3)}</span>
      <strong>${cuenta[x.wd] ? fmtPct(peso[x.wd]) : '—'}</strong>
      <small>${cuenta[x.wd]} día${cuenta[x.wd] === 1 ? '' : 's'}</small>
    </div>`).join('');
}

// ---- Ranking: 10 que más venden, 10 que menos, o todas; el buscador busca en todas ----

function rankingHtml() {
  return `
    <div class="card">
      <div class="card-head">
        <div class="seg-btns" role="group" aria-label="Qué sucursales mostrar">
          <button type="button" data-rank="top">Más venden</button>
          <button type="button" data-rank="bottom">Menos venden</button>
          <button type="button" data-rank="todas">Todas</button>
        </div>
        <input id="suc-buscar" class="suc-buscar" type="search" placeholder="Buscar sucursal" value="${esc(suc.filtro)}" aria-label="Buscar sucursal">
      </div>
      <div class="table-wrap" id="suc-ranking"></div>
      <p class="muted small" id="suc-ranking-pie" style="margin:12px 0 0"></p>
    </div>`;
}

function renderRankingTabla() {
  const res = suc.res;
  if (!res || !$('suc-ranking')) return;
  document.querySelectorAll('[data-rank]').forEach((b) => b.classList.toggle('active', b.dataset.rank === suc.rank));
  const todas = res.sucursales.map((s, i) => ({ ...s, puesto: i + 1 }));
  const q = suc.filtro.trim().toUpperCase();
  let lista;
  if (q) lista = todas.filter((s) => s.sucursal.includes(q));
  else if (suc.rank === 'bottom') lista = todas.slice(-10).reverse();
  else if (suc.rank === 'todas') lista = todas;
  else lista = todas.slice(0, 10);
  const top = res.sucursales[0]?.total || 1;
  const filas = lista.map((s) => `
    <tr data-suc="${esc(s.sucursal)}" class="suc-row" tabindex="0">
      <td class="muted">${s.puesto}</td>
      <td><b>${esc(s.sucursal)}</b></td>
      <td class="r">${fmtMillones(s.total)}</td>
      <td class="r">${fmtPct(s.total / (res.total || 1))}</td>
      <td class="r">${fmtMillones(s.total / Math.max(s.diasConVenta, 1))}</td>
      <td class="r">${s.diasConVenta}</td>
      <td style="min-width:120px"><div class="rank-bar"><div style="width:${((s.total / top) * 100).toFixed(1)}%"></div></div></td>
    </tr>`).join('');
  $('suc-ranking').innerHTML = `
    <table class="suc-tabla">
      <thead><tr><th>#</th><th>Sucursal</th><th class="r">Venta del mes</th><th class="r">% del total</th><th class="r">Prom./día</th><th class="r">Días</th><th></th></tr></thead>
      <tbody>${filas || '<tr><td colspan="7" class="muted">No hay sucursales con ese nombre.</td></tr>'}</tbody>
    </table>`;
  $('suc-ranking-pie').innerHTML = q
    ? `${lista.length} resultado${lista.length === 1 ? '' : 's'} para "${esc(suc.filtro.trim())}".`
    : `Mostrando ${lista.length} de ${todas.length} sucursales. Tocá una para ver su detalle.${suc.rank !== 'todas' ? ' <button class="btn-link" type="button" data-rank="todas">Ver todas</button>' : ''}`;
}

// ---- Mapa de calor: sucursales × días, cada sucursal en su propia escala ----

function calorHtml() {
  const res = suc.res;
  const fechas = res.dias.map((x) => x.fecha);
  const cab = fechas.map((f) => `<span class="${esFinde(wdDe(f)) ? 'finde' : ''}" title="${DIA_CORTO[wdDe(f)]} ${fmtFecha(f)}">${Number(f.slice(8))}</span>`).join('');
  const filas = res.sucursales.map((s) => {
    const max = Math.max(...Object.values(s.dias), 1);
    const celdas = fechas.map((f) => {
      const v = s.dias[f] || 0;
      const color = v ? `color-mix(in srgb, var(--calor-alto) ${(Math.min(v / max, 1) * 100).toFixed(0)}%, var(--calor-bajo))` : 'var(--sin-venta)';
      return `<i style="background:${color}" title="${esc(s.sucursal)} · ${DIA_CORTO[wdDe(f)]} ${fmtFecha(f)}: ${v ? fmtMillones(v) : 'sin venta'}"></i>`;
    }).join('');
    return `<div class="calor-fila" data-suc="${esc(s.sucursal)}" role="button" tabindex="0"><span class="calor-nombre">${esc(s.sucursal)}</span>${celdas}</div>`;
  }).join('');
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Mapa de calor</h2>
          <p class="muted small">Cada fila es una sucursal (de la que más vende a la que menos) y cada columna un día. Cada sucursal en su propia escala: más oscuro es su mejor día y gris, sin venta. Tocá una fila para ver el detalle.</p>
        </div>
        <div class="calor-leyenda"><i style="background:var(--sin-venta)"></i>sin venta <i style="background:var(--calor-bajo)"></i>bajo <i style="background:var(--calor-alto)"></i>su mejor día</div>
      </div>
      <div class="calor-wrap">
        <div class="calor" style="--dias:${fechas.length}">
          <div class="calor-fila calor-cab"><span class="calor-nombre"></span>${cab}</div>
          ${filas}
        </div>
      </div>
    </div>`;
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
    html = comparacionParHtml(compararDias(filasA, c.a, filasB, c.b));
  } else if (c.modo === 'semanas') {
    const filas = await filasHastaSemanas(4);
    if (turno !== cmpTurno) return;
    html = comparacionSemanasHtml(ultimasSemanas(filas, ultimoDiaCompleto(suc.res.dias).fecha, 4));
  } else {
    html = comparacionSemanaHtml(mismoDiaSemana(suc.datos.filas, c.wd));
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
      <td class="r ${s.diferencia >= 0 ? 'var-pos' : 'var-neg'}">${s.diferencia >= 0 ? '+' : '−'}${fmtM1(Math.abs(s.diferencia))} M</td>
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
          <thead><tr><th>Sucursal</th><th class="r">${etiquetaDia(r.fechaA)}</th><th class="r">${etiquetaDia(r.fechaB)}</th><th class="r">Diferencia</th><th class="r">Variación</th></tr></thead>
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
      ${s.valores.map((v) => `<td class="r">${v ? fmtM1(v) : '<span class="muted">0</span>'}</td>`).join('')}
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
          <thead><tr><th>Sucursal</th>${r.semanas.map((s) => `<th class="r">${rangoSemana(s)}</th>`).join('')}<th class="r">${colVar}</th></tr></thead>
          <tbody>${filas || `<tr><td colspan="${r.semanas.length + 2}" class="muted">No hay sucursales para mostrar.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="muted small" style="margin:12px 0 0">Montos en millones. La variación por sucursal compara las dos últimas semanas completas.${filtradas ? ` ${lista.length} resultado${lista.length === 1 ? '' : 's'}.` : suc.cmp.orden === 'todas' ? '' : ' Se muestran las 10 con mayor cambio.'}</p>
    </div>`;
}

function comparacionSemanaHtml(r) {
  const nombre = DIAS_SEMANA.find((x) => x.wd === suc.cmp.wd)?.nombre || '';
  if (!r.fechas.length) return `<div class="card empty">No hay ${nombre.toLowerCase()}s cargados en este mes.</div>`;
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
      ${s.valores.map((v) => `<td class="r">${v ? fmtM1(v) : '<span class="muted">0</span>'}</td>`).join('')}
      <td class="r">${s.ultimaVariacion === null ? '—' : varHtml(s.ultimaVariacion)}</td>
    </tr>`).join('');
  return `
    <div class="card" style="margin-bottom:16px">
      <h3>Todos los ${nombre.toLowerCase()}s del mes</h3>
      <p class="muted small" style="margin:4px 0 0">Total de las sucursales cada ${nombre.toLowerCase()} y variación contra el ${nombre.toLowerCase()} anterior.</p>
      <div class="cmp-sem">${columnas}</div>
    </div>
    <div class="card">
      ${controlesTabla(r.sucursales.length)}
      <div class="table-wrap">
        <table class="suc-tabla">
          <thead><tr><th>Sucursal</th>${r.fechas.map((f) => `<th class="r">${fmtDiaMes(f)}</th>`).join('')}<th class="r">${ultimas || 'Variación'}</th></tr></thead>
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
  if (a.sinVentaReciente.some((x) => x.sucursal === nombre)) marcas.push('<span class="chip risk">Sin venta en los últimos días</span>');
  const caida = a.caidas.find((x) => x.sucursal === nombre);
  if (caida) marcas.push(`<span class="chip warn">Vende menos: ${fmtVar(caida.variacion)}</span>`);
  const sube = a.crecen.find((x) => x.sucursal === nombre);
  if (sube) marcas.push(`<span class="chip ok">Creciendo: ${fmtVar(sube.variacion)}</span>`);

  $('suc-panel-titulo').textContent = nombre;
  $('suc-panel-body').innerHTML = `
    <p class="muted small" style="margin:0 0 12px">${nombreMes(fechaDeMes(suc.datos.mes))} · puesto ${i + 1} de ${res.sucursales.length}</p>
    ${marcas.length ? `<div class="panel-marcas">${marcas.join('')}</div>` : ''}
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
    <div class="sp-grid">${pesosSemanaHtml(peso, cuenta)}</div>`;
  $('suc-panel').hidden = false;
  $('suc-panel-fondo').hidden = false;
  document.body.classList.add('panel-abierto');
  $('suc-panel-cerrar').focus();
}

function cerrarPanel() {
  if ($('suc-panel').hidden) return;
  $('suc-panel').hidden = true;
  $('suc-panel-fondo').hidden = true;
  document.body.classList.remove('panel-abierto');
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

async function refreshDashboard(force = false) {
  try {
    const [dash, climaNuevo] = await Promise.all([API.getDashboard(), cargarClima()]);
    if (climaNuevo) force = true;
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

function unidadCard(titulo, calendario, c, color, manual, extra = '') {
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
        <td class="r">${c.diasRestantes}</td>
        <td class="r">${fmtM1(c.promedioDia)}</td>
        <td class="r ${alto ? 'necesario-alto' : 'necesario-ok'}">${fmtM1(c.necesarioDia)}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="dash-head">
      <h1>Avance de ventas · ${nombreMes(p.corte)}</h1>
      <p class="muted">Corte al ${fmtFecha(p.corte)} · Publicado ${fmtFechaHora(p.publicadoEn)} por ${esc(p.por)}${r.manual ? ' · Días cargados a mano' : ''}</p>
    </div>

    ${proyeccionHtml(r, p.corte)}

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

    <div class="unidades">
      ${unidadCard('Baratote', 'lun-dom', r.baratote, COLOR.bar, r.manual, `<div class="canales"><div class="unidad-meta" style="font-weight:600">Por canal</div>${canal(u.may)}${canal(u.min)}</div>`)}
      ${unidadCard('Fineglass', 'lun-vie', u.fgl, COLOR.fgl, r.manual)}
      ${unidadCard('Fineboats', 'lun-dom', u.fbt, COLOR.fbt, r.manual)}
    </div>
    <div class="leyenda">
      <span><i class="sw" style="background:var(--text-2)"></i>Venta real (color de la unidad)</span>
      <span><i class="sw" style="background:var(--track-fuerte)"></i>Proyección al cierre (tono claro)</span>
      <span><i class="sw target"></i>Objetivo (100%)</span>
    </div>

    ${climaHtml(r, p)}

    <div class="dash-bottom">
      ${evolucionHtml()}
      ${composicionHtml(r)}
    </div>

    <div class="dash-bottom" style="margin-top:16px">
      ${comparativaHtml(r, p.corte)}
      <div class="card">
        <h2>Ritmo necesario para llegar</h2>
        <p class="muted small" style="margin:4px 0 12px">Montos en millones de guaraníes.</p>
        <div class="table-wrap">
          <table class="ritmo">
            <thead>
              <tr><th>Unidad</th><th class="r">Faltante</th><th class="r">Días</th><th class="r">Prom./día</th><th class="r">Necesario/día</th></tr>
            </thead>
            <tbody>${ritmoRows}</tbody>
          </table>
        </div>
        <p class="nota">Necesario/día en <span class="necesario-alto">naranja</span>: hay que vender por día más que el promedio actual para llegar al objetivo. En <span class="necesario-ok">azul</span>: con el ritmo actual alcanza.</p>
      </div>
    </div>`;
  contarNumeros(el);
}

init();
