// Punto de entrada del portal: sesión, menú y ruteo entre vistas (#vista[/subvista]).
import * as API from './api.js';
import { calcularReporte } from './calc.js';
import { anual, loadAnual, setupAnual } from './vistas/anual.js';
import { cierre, loadCierre, setupCierre } from './vistas/cierre.js';
import { $, ROL_TEXTO, VISTAS, contarNumeros, currentView, guardarPref, isAdmin, partesHash, sinMovimiento, state } from './vistas/comun.js';
import { planHtml, refreshDashboard } from './vistas/dashboard.js';
import { loadObjetivos, objetivos, setupObjetivos } from './vistas/objetivos.js';
import { elegirSubSucursal, loadSucursales, setupSucursales, suc } from './vistas/sucursales.js';
import { loadUsuarios, setupUsuarios } from './vistas/usuarios.js';
import { loadVentas, setupVentas } from './vistas/ventas.js';

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
    const pu = e.target.closest('[data-plan-u], [data-plan-meta]');
    if (pu && state.published) {
      if (pu.dataset.planU) guardarPref('plan-u', pu.dataset.planU);
      else guardarPref('plan-meta', pu.dataset.planMeta);
      $('s-plan').innerHTML = planHtml(calcularReporte(state.published), state.published);
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

let vistaAnterior = null;

function route() {
  const view = currentView();
  const { vista, sub } = partesHash();
  // Dentro de Sucursales, cambiar de pestaña (o volver con "atrás") no vuelve a pedir los datos.
  if (view === 'sucursales' && vistaAnterior === 'sucursales' && suc.datos) {
    vistaAnterior = view;
    elegirSubSucursal(sub, false);
    return;
  }
  vistaAnterior = view;
  if (vista !== view) history.replaceState(null, '', `#${view}`);
  if (view === 'sucursales' && sub) elegirSubSucursal(sub, false, false);
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

init();
