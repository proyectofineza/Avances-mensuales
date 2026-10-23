import * as API from './api.js';
import {
  UNIDADES, IDS, DIAS_SEMANA, PESOS_MINORISTA, AJUSTE_LLUVIA, parseCorte,
  calcularReporte, estado, diasOperativos, diasUnidad, normalizarReporte, validarReporte, proyeccionLluvia,
  mesAnterior, mismoMesAnioAnterior, fmtMillones, fmtMiles, fmtPct, fmtVar, fmtFecha, fmtDiaMes,
  fmtFechaHora, nombreMes, fmtCI, hoyAsuncion,
} from './calc.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROL_TEXTO = { admin: 'Administrador', comercial: 'Comercial' };
const CAL_CORTO = { 'lun-dom': 'lun a lun', 'lun-vie': 'lun a vie' };
const CAL_LARGO = { 'lun-dom': 'lunes a lunes', 'lun-vie': 'lunes a viernes' };

// Color de cada unidad: fuerte = venta real, claro = proyección.
const COLOR = {
  bar: { fuerte: '#DC2626', claro: '#FECACA' },
  may: { fuerte: '#DC2626', claro: '#FECACA' },
  min: { fuerte: '#F59E0B', claro: '#FDE68A' },
  fgl: { fuerte: '#0D9488', claro: '#99F6E4' },
  fbt: { fuerte: '#1D4ED8', claro: '#BFD0F7' },
  total: { fuerte: '#111827', claro: '#D1D5DB' },
};

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
  $('tabs').hidden = !isAdmin();

  $('btn-salir').addEventListener('click', async () => {
    try { await API.logout(); } finally { location.replace('index.html'); }
  });
  $('notice-close').addEventListener('click', () => { $('notice-wrap').hidden = true; });

  if (isAdmin()) {
    setupVentas();
    setupUsuarios();
  }

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

function currentView() {
  const h = location.hash.slice(1);
  if (!isAdmin()) return 'dashboard';
  return ['ventas', 'usuarios', 'dashboard'].includes(h) ? h : 'ventas';
}

function route() {
  const view = currentView();
  if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
  for (const v of ['ventas', 'usuarios', 'dashboard']) $(`view-${v}`).hidden = v !== view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  if (view === 'ventas') loadVentas();
  if (view === 'usuarios') loadUsuarios();
  if (view === 'dashboard') refreshDashboard(true);
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
      <div class="u-big"><strong style="color:${color.fuerte}">${fmtPct(c.avance)}</strong><span>de avance · proyecta ${fmtPct(c.proyeccionPct)}${c.referencial ? ' (referencial)' : ''}</span></div>
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
  const fondo = t.real > 0 ? `conic-gradient(${stops})` : '#EEF0F3';
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
        <div class="donut" style="background:${fondo}">
          <div class="donut-hole"><strong>${fmtMillones(t.real)}</strong><span>venta total</span></div>
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
        ${b('Mes ant.', c.ant, '#94A3B8')}
        ${b('Año ant.', c.aa, '#CBD5E1')}
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
const GAUGE_COLOR = { ok: '#60A5FA', warn: '#FBBF24', risk: '#F87171' };

function gauge(p, clase) {
  const ang = (Math.min(Math.max(p, 0), 1.2) / 1.2) * 180;
  return `
    <div class="gauge" role="img" aria-label="Proyección ${fmtPct(p)} del objetivo">
      <div class="gauge-arc" style="background:conic-gradient(from 270deg, ${GAUGE_COLOR[clase]} 0deg ${ang.toFixed(1)}deg, rgba(255,255,255,.14) ${ang.toFixed(1)}deg 180deg, transparent 180deg 360deg)"></div>
      <div class="gauge-hole"></div>
      <div class="gauge-target"></div>
      <div class="gauge-text"><strong>${fmtPct(p)}</strong><span>del objetivo</span></div>
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
          <div class="proy-amount">${fmtMillones(t.proyeccion)}</div>
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
        ${unidad('Fineboats', r.unidades.fbt, '#60A5FA')}
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
      <div class="card kpi" style="border-top:4px solid #1D4ED8">
        <span class="kpi-label">Venta acumulada</span>
        <span class="kpi-value">${fmtMillones(t.real)}</span>
        <span class="kpi-sub">Al corte del ${fmtFecha(p.corte)}</span>
      </div>
      <div class="card kpi" style="border-top:4px solid #0D9488">
        <span class="kpi-label">Objetivo del mes</span>
        <span class="kpi-value">${fmtMillones(t.objetivo)}</span>
        <span class="kpi-sub">Faltan ${fmtMillones(t.faltante)}</span>
      </div>
      <div class="card kpi" style="border-top:4px solid #F59E0B">
        <span class="kpi-label">Avance sobre objetivo</span>
        <span class="kpi-value">${fmtPct(t.avance)}</span>
        <span class="kpi-sub">Ritmo ideal a hoy ${fmtPct(t.ritmoIdeal)}</span>
      </div>
    </div>

    <div class="unidades">
      ${unidadCard('Baratote', 'lun-dom', r.baratote, COLOR.bar, r.manual, `<div class="canales"><div class="unidad-meta" style="font-weight:600">Por canal</div>${canal(u.may)}${canal(u.min)}</div>`)}
      ${unidadCard('Fineglass', 'lun-vie', u.fgl, COLOR.fgl, r.manual)}
      ${unidadCard('Fineboats', 'lun-dom', u.fbt, COLOR.fbt, r.manual)}
    </div>
    <div class="leyenda">
      <span><i class="sw" style="background:#4B5563"></i>Venta real (color de la unidad)</span>
      <span><i class="sw" style="background:#D1D5DB"></i>Proyección al cierre (tono claro)</span>
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
}

init();
