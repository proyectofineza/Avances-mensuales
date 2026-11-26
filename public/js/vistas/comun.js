// Utilidades compartidas por todas las vistas del portal: estado de la sesión, avisos, preferencias, exportar.
import { estado, fmtPct, fmtVar } from '../calc.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ROL_TEXTO = { admin: 'Administrador', comercial: 'Comercial' };
export const CAL_CORTO = { 'lun-dom': 'lun a lun', 'lun-vie': 'lun a vie' };
export const CAL_LARGO = { 'lun-dom': 'lunes a lunes', 'lun-vie': 'lunes a viernes' };

// Color de cada unidad: fuerte = venta real, claro = proyección (el mismo color, translúcido,
// para que funcione en el tema oscuro y en el claro). Los valores viven en el CSS.
export const tono = (fuerte) => ({ fuerte, claro: `color-mix(in srgb, ${fuerte} 38%, transparent)` });
export const COLOR = {
  bar: tono('var(--c-may)'),
  may: tono('var(--c-may)'),
  min: tono('var(--c-min)'),
  fgl: tono('var(--c-fgl)'),
  fbt: tono('var(--c-fbt)'),
  total: tono('var(--text)'),
};

// Íconos de línea para los indicadores (mismo trazo que el menú).
export const ICONOS = {
  venta: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  objetivo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  avance: '<path d="M4 18l6-6 4 4 6-8"/><path d="M14 8h6v6"/>',
  tienda: '<path d="M3 9l1.6-5h14.8L21 9"/><path d="M4 9v11h16V9"/><path d="M9.5 20v-5.5h5V20"/>',
  calendario: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
};
export const icono = (nombre) => `<span class="kpi-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONOS[nombre]}</svg></span>`;

export const state = {
  user: null,
  published: null,
  history: [],
  draft: null,
  users: [],
  // Mes elegido a mano en Sucursales o en Cierre: al pasar de una a otra se abre el mismo mes.
  mesElegido: null,
};

export const isAdmin = () => state.user?.rol === 'admin';

// Números grandes que "cuentan" hasta su valor al aparecer (respeta "reducir movimiento").
export const sinMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function contarNumeros(raiz) {
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

export const VISTAS = ['ventas', 'usuarios', 'dashboard', 'sucursales', 'cierre', 'objetivos', 'anual'];

// El hash es #vista o #vista/pestaña (por ejemplo #sucursales/matriz), para poder compartir el enlace exacto.
export const partesHash = () => {
  const [vista = '', sub = ''] = location.hash.slice(1).split('/');
  return { vista, sub };
};

export function currentView() {
  const h = partesHash().vista;
  const permitidas = isAdmin() ? VISTAS : ['dashboard', 'sucursales', 'cierre', 'anual'];
  if (permitidas.includes(h)) return h;
  // Sin pantalla en la dirección: la última que se usó en este navegador.
  const ultima = leerPref('ultima-vista', '');
  if (!h && permitidas.includes(ultima)) return ultima;
  return isAdmin() ? 'ventas' : 'dashboard';
}

export function showNotice(text, isError = false) {
  $('notice-text').textContent = text;
  $('notice').classList.toggle('error', isError);
  $('notice-wrap').hidden = false;
}

export function showMsg(el, text, ok) {
  el.textContent = text;
  el.className = `alert form-msg ${ok ? 'alert-ok' : 'alert-error'}`;
  el.hidden = false;
}

export function handleError(err, el) {
  if (err.status === 401) { location.replace('index.html'); return; }
  if (el) showMsg(el, err.message, false);
  else showNotice(err.message, true);
}

// ---- Preferencias y fechas ----

// Preferencias de vista por navegador (si el almacenamiento no está disponible, se usa el valor por defecto).
export function leerPref(clave, porDefecto) {
  try { return localStorage.getItem(clave) || porDefecto; } catch { return porDefecto; }
}
export function guardarPref(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}
export const fechaDeMes = (mes) => `${mes}-01`;
export const esFinde = (wd) => wd === 5 || wd === 6 || wd === 0;
export const wdDe = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();
// "jueves" → "jueves", "sábado" → "sábados".
export const pluralDia = (nombre) => (nombre.endsWith('s') ? nombre : `${nombre}s`);

// ---- Exportar: Excel (CSV con ; y BOM, que Excel en español abre directo), PDF y compartir ----

export const csvCelda = (v) => {
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function descargarCsv(nombre, filas) {
  const texto = '﻿' + filas.map((f) => f.map(csvCelda).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// PDF: el diálogo de imprimir del navegador ("Guardar como PDF"), en tema claro y sin menús.
export function imprimir(titulo) {
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
export async function compartirTexto(titulo, texto) {
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

// Los CSV de Excel en Windows suelen venir en Windows-1252 (Ñ, tildes): si UTF-8 falla, se reintenta.
export async function leerArchivo(archivo) {
  const buf = await archivo.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

// ---- Piezas de presentación compartidas (fechas, barras, variaciones, medidor) ----

export function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Escala de la barra: 0–120%, el objetivo (100%) queda en 83,3%.
export const barW = (p) => (Math.min(Math.max(p, 0), 1.2) / 1.2) * 100;

export function bar(avance, proyeccionPct, color, thin = false) {
  return `
    <div class="bar${thin ? ' thin' : ''}">
      <div class="proj" style="width:${barW(proyeccionPct).toFixed(2)}%;background:${color.claro}"></div>
      <div class="real" style="width:${barW(avance).toFixed(2)}%;background:${color.fuerte}"></div>
      <div class="target"></div>
    </div>`;
}

export const chipEstado = (p) => { const e = estado(p); return `<span class="chip ${e.clase}">${e.texto}</span>`; };
export const varClase = (v) => (v === null ? 'var-na' : v >= 0 ? 'var-pos' : 'var-neg');
export const varHtml = (v) => `<b class="${varClase(v)}">${fmtVar(v)}</b>`;

export const fmtM1 = (v) => ((Number(v) || 0) / 1e6).toLocaleString('es-PY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Medidor semicircular 0–120%; la marca blanca es el objetivo (100%).
// El arco se dibuja en CSS desde 0 hasta --ang (animado); el color sale del estado.
export function gauge(p, clase) {
  const ang = (Math.min(Math.max(p, 0), 1.2) / 1.2) * 180;
  return `
    <div class="gauge gauge-${clase}" role="img" aria-label="Proyección ${fmtPct(p)} del objetivo">
      <div class="gauge-arc" style="--ang:${ang.toFixed(1)}deg"></div>
      <div class="gauge-target"></div>
      <div class="gauge-text"><strong data-contar>${fmtPct(p)}</strong><span>del objetivo</span></div>
    </div>`;
}

export const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];