import * as API from './api.js';
import {
  UNIDADES, IDS, calcularReporte, estado, parseCorte,
  fmtMillones, fmtMiles, fmtPct, fmtFecha, fmtDiaMes, fmtFechaHora, nombreMes, fmtCI, hoyAsuncion,
} from './calc.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROL_TEXTO = { admin: 'Administrador', comercial: 'Comercial' };
const CAL_CORTO = { 'lun-dom': 'lun a lun', 'lun-vie': 'lun a vie' };
const CAL_LARGO = { 'lun-dom': 'lunes a lunes', 'lun-vie': 'lunes a viernes' };

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

function setupVentas() {
  const body = $('ventas-body');
  body.innerHTML = UNIDADES.map((u) => `
    <tr>
      <td>
        <div class="unidad-nombre">${esc(u.nombre)}</div>
        <div class="unidad-meta">${u.grupo ? esc(u.grupo) + ' · ' : ''}${CAL_CORTO[u.calendario]}</div>
      </td>
      <td class="r"><input class="num" inputmode="numeric" data-campo="obj" data-id="${u.id}" aria-label="Objetivo mensual ${esc(u.nombre)}"></td>
      <td class="r"><input class="num" inputmode="numeric" data-campo="real" data-id="${u.id}" aria-label="Venta acumulada ${esc(u.nombre)}"></td>
      <td class="r" id="av-${u.id}"></td>
    </tr>`).join('');

  body.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.campo) return;
    formatearInput(el);
    state.draft[el.dataset.campo][el.dataset.id] = Number(el.value.replace(/\D/g, '')) || 0;
    onDraftChange();
  });

  $('corte').addEventListener('change', () => {
    state.draft.corte = $('corte').value;
    onDraftChange();
  });

  $('btn-descartar').addEventListener('click', async () => {
    const p = state.published;
    const vacio = Object.fromEntries(IDS.map((id) => [id, 0]));
    state.draft = p
      ? { corte: p.corte, obj: { ...p.obj }, real: { ...p.real } }
      : { corte: hoyAsuncion(), obj: { ...vacio }, real: { ...vacio } };
    fillVentasForm();
    $('ventas-error').hidden = true;
    await saveNow().catch(() => {});
  });

  $('btn-publicar').addEventListener('click', publicar);
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
    state.draft = { corte: draft.corte || '', obj: { ...draft.obj }, real: { ...draft.real } };
    state.published = dash.published;
    state.history = dash.history;
    if (draft.actualizado) $('draft-saved').textContent = `Borrador guardado ${fmtFechaHora(draft.actualizado)}${draft.por ? ' por ' + draft.por : ''}.`;
    else $('draft-saved').textContent = '';
    fillVentasForm();
    renderUltimaPub();
  } catch (err) {
    handleError(err, $('ventas-error'));
  }
}

function fillVentasForm() {
  $('corte').value = state.draft.corte || '';
  document.querySelectorAll('#ventas-body input').forEach((el) => {
    const v = state.draft[el.dataset.campo][el.dataset.id];
    el.value = v ? fmtMiles(v) : '';
  });
  updateVentasCalc();
}

function updateVentasCalc() {
  const d = state.draft;
  let totObj = 0, totReal = 0;
  for (const id of IDS) {
    const o = d.obj[id] || 0, r = d.real[id] || 0;
    totObj += o; totReal += r;
    $(`av-${id}`).textContent = o > 0 ? fmtPct(r / o) : '—';
  }
  $('tot-obj').textContent = fmtMiles(totObj);
  $('tot-real').textContent = fmtMiles(totReal);
  $('tot-av').textContent = totObj > 0 ? fmtPct(totReal / totObj) : '—';

  const chip = $('draft-status');
  const alDia = state.published && mismoContenido(d, state.published);
  chip.textContent = alDia ? 'Al día con lo publicado' : 'Cambios sin publicar';
  chip.className = `chip ${alDia ? 'ok' : 'warn'}`;
}

function mismoContenido(a, b) {
  if ((a.corte || '') !== (b.corte || '')) return false;
  return IDS.every((id) => (a.obj[id] || 0) === (b.obj?.[id] || 0) && (a.real[id] || 0) === (b.real?.[id] || 0));
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

function validarDraft(d) {
  if (!d.corte || !parseCorte(d.corte)) return 'Indicá la fecha de corte.';
  const falta = UNIDADES.find((u) => !(d.obj[u.id] > 0));
  return falta ? `Falta el objetivo mensual de ${falta.nombre}.` : null;
}

async function publicar() {
  const errEl = $('ventas-error');
  errEl.hidden = true;
  const msg = validarDraft(state.draft);
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

    btn.disabled = true;
    try {
      let res;
      if (accion === 'guardar-pin') {
        const pin = $('reset-pin').value.trim();
        if (!/^\d{4,6}$/.test(pin)) { showMsg(msgEl, 'El PIN debe tener de 4 a 6 dígitos.', false); btn.disabled = false; return; }
        res = await API.updateUser(ci, { pin });
        resetCi = null;
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

function renderUsers() {
  const users = [...state.users].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
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
        : `<button class="btn btn-sm" data-accion="${u.activo ? 'desactivar' : 'activar'}" data-ci="${esc(u.ci)}">${u.activo ? 'Desactivar' : 'Activar'}</button>`;
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
        <td class="r">${acciones}</td>
      </tr>`;
  }).join('');
}

// ---------- Dashboard ----------

let dashKey = null;

async function refreshDashboard(force = false) {
  try {
    const dash = await API.getDashboard();
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

function bar(avance, proyeccionPct, thin = false) {
  return `
    <div class="bar${thin ? ' thin' : ''}">
      <div class="proj" style="width:${barW(proyeccionPct).toFixed(2)}%"></div>
      <div class="real" style="width:${barW(avance).toFixed(2)}%"></div>
      <div class="target"></div>
    </div>`;
}

const chipEstado = (p) => { const e = estado(p); return `<span class="chip ${e.clase}">${e.texto}</span>`; };

function unidadCard(titulo, calendario, c, extra = '') {
  return `
    <div class="card">
      <div class="u-head">
        <div>
          <h3>${esc(titulo)}</h3>
          <p>Opera ${CAL_LARGO[calendario]} · día ${c.diasOperados} de ${c.diasMes}</p>
        </div>
        ${chipEstado(c.proyeccionPct)}
      </div>
      <div class="u-big"><strong>${fmtPct(c.avance)}</strong><span>de avance · proyecta ${fmtPct(c.proyeccionPct)}</span></div>
      ${bar(c.avance, c.proyeccionPct)}
      <div class="u-stats">
        <div><span>Real</span><strong>${fmtMillones(c.real)}</strong></div>
        <div><span>Proyección</span><strong>${fmtMillones(c.proyeccion)}</strong></div>
        <div><span>Objetivo</span><strong>${fmtMillones(c.objetivo)}</strong></div>
      </div>
      ${extra}
    </div>`;
}

function canal(c) {
  return `
    <div>
      <div class="canal-head">
        <strong>${esc(c.nombre)}</strong>
        <span>${fmtPct(c.avance)} · proy. ${fmtPct(c.proyeccionPct)} · ${fmtMillones(c.real)} de ${fmtMillones(c.objetivo)}</span>
      </div>
      ${bar(c.avance, c.proyeccionPct, true)}
    </div>`;
}

const fmtM1 = (v) => ((Number(v) || 0) / 1e6).toLocaleString('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
  const est = estado(t.proyeccionPct);

  const evol = state.history.slice(-8).map((h) => {
    const rt = calcularReporte(h).total;
    return { corte: h.corte, avance: rt.avance, ideal: rt.ritmoIdeal };
  });
  // 100% del objetivo = 82% del alto; el % va por encima de la barra y de la línea ideal.
  const cols = evol.map((e, i) => {
    const h = Math.min(e.avance * 82, 100);
    const ideal = Math.min(e.ideal * 82, 100);
    return `
    <div class="col${i === evol.length - 1 ? ' last' : ''}">
      <div class="col-bar" style="height:${h.toFixed(2)}%"></div>
      <div class="col-ideal" style="bottom:${ideal.toFixed(2)}%" title="Ritmo ideal ${fmtPct(e.ideal)}"></div>
      <span class="col-pct" style="bottom:calc(${Math.max(h, ideal).toFixed(2)}% + 4px)">${fmtPct(e.avance)}</span>
    </div>`;
  }).join('');
  const labels = evol.map((e) => `<span>${fmtDiaMes(e.corte)}</span>`).join('');

  const ritmoRows = UNIDADES.map((x) => {
    const c = u[x.id];
    const alto = c.necesarioDia > c.promedioDia;
    return `
      <tr>
        <td>${esc(x.nombre)}${x.grupo ? `<div class="unidad-meta">${esc(x.grupo)}</div>` : ''}</td>
        <td class="r">${fmtMiles(c.faltante / 1e6)}</td>
        <td class="r">${c.diasRestantes}</td>
        <td class="r">${fmtM1(c.promedioDia)}</td>
        <td class="r ${alto ? 'necesario-alto' : 'necesario-ok'}">${fmtM1(c.necesarioDia)}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="dash-head">
      <h1>Avance de ventas · ${nombreMes(p.corte)}</h1>
      <p class="muted">Corte al ${fmtFecha(p.corte)} · Publicado ${fmtFechaHora(p.publicadoEn)} por ${esc(p.por)}</p>
    </div>

    <div class="kpis">
      <div class="card kpi">
        <span class="kpi-label">Venta acumulada</span>
        <span class="kpi-value">${fmtMillones(t.real)}</span>
        <span class="kpi-sub">Al corte del ${fmtFecha(p.corte)}</span>
      </div>
      <div class="card kpi">
        <span class="kpi-label">Objetivo del mes</span>
        <span class="kpi-value">${fmtMillones(t.objetivo)}</span>
        <span class="kpi-sub">Faltan ${fmtMillones(t.faltante)}</span>
      </div>
      <div class="card kpi">
        <span class="kpi-label">Avance sobre objetivo</span>
        <span class="kpi-value">${fmtPct(t.avance)}</span>
        <span class="kpi-sub">Ritmo ideal a hoy ${fmtPct(t.ritmoIdeal)}</span>
      </div>
      <div class="card kpi dark">
        <span class="kpi-label">Proyección al cierre</span>
        <span class="kpi-value">${fmtMillones(t.proyeccion)}</span>
        <span class="kpi-sub">${fmtPct(t.proyeccionPct)} del objetivo · ${est.texto}</span>
      </div>
    </div>

    <div class="unidades">
      ${unidadCard('Baratote', 'lun-dom', r.baratote, `<div class="canales">${canal(u.may)}${canal(u.min)}</div>`)}
      ${unidadCard('Fineglass', 'lun-vie', u.fgl)}
      ${unidadCard('Fineboats', 'lun-dom', u.fbt)}
    </div>
    <div class="leyenda">
      <span><i class="sw real"></i>Venta real</span>
      <span><i class="sw proj"></i>Proyección al cierre</span>
      <span><i class="sw target"></i>Objetivo (100%)</span>
    </div>

    <div class="dash-bottom">
      <div class="card">
        <h2>Evolución del avance total</h2>
        <p class="muted small" style="margin:4px 0 0">Una columna por publicación del mes. <span style="color:#B45309;font-weight:600">—</span> ritmo ideal a esa fecha.</p>
        <div class="chart">
          <div class="chart-cols" style="padding-top:22px">${cols}</div>
          <div class="chart-labels">${labels}</div>
        </div>
      </div>
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
