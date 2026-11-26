// Buscador de sucursal: desde cualquier pantalla abre el detalle de una sucursal (sin salir de donde estás).
// Se abre con el botón del menú, la lupa del celular, Ctrl+K (⌘K en Mac) o "/".
import { fmtMillones } from '../calc.js';
import { $, esc } from './comun.js';
import { abrirPanel, avanceChip, loadSucursales, suc, zonaDe } from './sucursales.js';

const MAX = 40;
const buscador = { lista: [], elegido: 0 };

// "Capiatá" y "capiata" son lo mismo.
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function setupBuscador() {
  const dlg = $('buscador');
  document.querySelectorAll('[data-buscar]').forEach((b) => {
    b.hidden = false;
    b.addEventListener('click', abrirBuscador);
  });
  // En Mac se muestra ⌘K.
  if (/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelectorAll('.buscar-btn kbd').forEach((k) => { k.textContent = '⌘K'; });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dlg.open) cerrarBuscador(); else abrirBuscador();
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !escribiendo(e.target) && !dlg.open) {
      e.preventDefault();
      abrirBuscador();
    }
  });

  $('buscador-input').addEventListener('input', () => { buscador.elegido = 0; pintarResultados(); });
  $('buscador-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!buscador.lista.length) return;
      const n = buscador.lista.length;
      buscador.elegido = (buscador.elegido + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      marcarElegido();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = buscador.lista[buscador.elegido];
      if (s) elegir(s.sucursal);
    }
  });
  $('buscador-lista').addEventListener('click', (e) => {
    const li = e.target.closest('[data-buscar-suc]');
    if (li) elegir(li.dataset.buscarSuc);
  });
  $('buscador-lista').addEventListener('mousemove', (e) => {
    const li = e.target.closest('[data-i]');
    if (li && Number(li.dataset.i) !== buscador.elegido) { buscador.elegido = Number(li.dataset.i); marcarElegido(); }
  });
  $('buscador-cerrar').addEventListener('click', cerrarBuscador);
  // Tocar afuera de la caja cierra.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) cerrarBuscador(); });
}

const escribiendo = (el) => el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || '');

export async function abrirBuscador() {
  const dlg = $('buscador');
  if (dlg.open) return;
  // En el celular el menú lateral puede estar abierto (botón "Más"): se cierra para que no quede detrás.
  if (document.body.classList.contains('menu-abierto')) $('sidebar-fondo').click();
  $('buscador-input').value = '';
  buscador.elegido = 0;
  dlg.showModal();
  $('buscador-input').focus();
  if (!suc.res) {
    $('buscador-lista').innerHTML = '<li class="buscador-vacio">Cargando sucursales…</li>';
    await loadSucursales(); // queda cargado también para la pantalla de Sucursales
  }
  pintarResultados();
}

export function cerrarBuscador() {
  if ($('buscador').open) $('buscador').close();
}

function elegir(nombre) {
  cerrarBuscador();
  abrirPanel(nombre);
}

function pintarResultados() {
  const ul = $('buscador-lista');
  if (!$('buscador').open) return;
  if (!suc.res?.sucursales.length) {
    buscador.lista = [];
    ul.innerHTML = '<li class="buscador-vacio">Todavía no hay ventas por sucursal cargadas.</li>';
    return;
  }
  const q = normalizar($('buscador-input').value);
  const todas = suc.res.sucursales.map((s, i) => ({ ...s, puesto: i + 1, zona: zonaDe(s.sucursal) }));
  let lista = todas;
  if (q) {
    // Primero las que empiezan con lo escrito, después las que lo contienen y al final las de esa ciudad.
    const nivel = (s) => {
      const n = normalizar(s.sucursal);
      if (n.startsWith(q)) return 0;
      if (n.includes(q)) return 1;
      if (normalizar(s.zona).includes(q)) return 2;
      return -1;
    };
    lista = todas.map((s) => ({ s, n: nivel(s) })).filter((x) => x.n >= 0).sort((a, b) => a.n - b.n || a.s.puesto - b.s.puesto).map((x) => x.s);
  }
  buscador.lista = lista.slice(0, MAX);
  if (buscador.elegido >= buscador.lista.length) buscador.elegido = 0;
  if (!buscador.lista.length) {
    ul.innerHTML = `<li class="buscador-vacio">Ninguna sucursal coincide con “${esc($('buscador-input').value.trim())}”.</li>`;
    $('buscador-input').removeAttribute('aria-activedescendant');
    return;
  }
  ul.innerHTML = buscador.lista.map((s, i) => `
    <li role="option" id="buscador-op-${i}" data-i="${i}" data-buscar-suc="${esc(s.sucursal)}">
      <span class="buscador-nombre"><b>${esc(s.sucursal)}</b><small>Puesto ${s.puesto} · ${esc(s.zona)}</small></span>
      <span class="buscador-dato">${fmtMillones(s.total)}${avanceChip(s.sucursal)}</span>
    </li>`).join('') + (lista.length > MAX ? `<li class="buscador-vacio">Y ${lista.length - MAX} más: escribí parte del nombre.</li>` : '');
  marcarElegido();
}

function marcarElegido() {
  $('buscador-lista').querySelectorAll('[data-i]').forEach((li) => {
    const si = Number(li.dataset.i) === buscador.elegido;
    li.classList.toggle('elegido', si);
    li.setAttribute('aria-selected', String(si));
    if (si) {
      $('buscador-input').setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  });
}
