// Vista "Usuarios" (admin): altas, solicitudes, PIN y conexión.
import * as API from '../api.js';
import { fmtFechaHora, fmtCI } from '../calc.js';
import { $, ROL_TEXTO, esc, handleError, showMsg, state } from './comun.js';

// ---------- Usuarios ----------

export let resetCi = null;

export function setupUsuarios() {
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

export async function loadUsuarios() {
  try {
    state.users = await API.getUsers();
    renderUsers();
  } catch (err) {
    handleError(err, $('users-msg'));
  }
}

// "hace 5 min", "hace 3 h", "ayer 14:20", o fecha y hora completas.
export function haceCuanto(iso) {
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

export function conexionHtml(u) {
  const ultima = [u.ultimaActividad, u.ultimoIngreso].filter(Boolean).sort().pop();
  if (!ultima) return '<span class="muted small">Nunca ingresó</span>';
  const detalle = `Último ingreso con PIN: ${u.ultimoIngreso ? fmtFechaHora(u.ultimoIngreso) : '—'} · Última actividad: ${u.ultimaActividad ? fmtFechaHora(u.ultimaActividad) : '—'}`;
  const dias = (Date.now() - Date.parse(ultima)) / 86400e3;
  return `<div title="${esc(detalle)}"${dias > 7 ? ' class="conexion-vieja"' : ''}>${haceCuanto(ultima)}</div>
    <div class="muted small">${u.ingresos} ingreso${u.ingresos === 1 ? '' : 's'}</div>`;
}

export function actualizarBadge() {
  const n = state.users.filter((u) => u.pendiente).length;
  // tab-badge: Usuarios en el menú lateral; tab-badge-inf: "Más" en la barra del celular.
  for (const id of ['tab-badge', 'tab-badge-inf']) {
    $(id).textContent = n;
    $(id).hidden = n === 0;
  }
  $('nav-mas').setAttribute('aria-label', n ? `Más (${n} solicitud${n === 1 ? '' : 'es'} de acceso pendiente${n === 1 ? '' : 's'})` : 'Más');
}

export function renderPendientes() {
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

export function renderUsers() {
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