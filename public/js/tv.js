// Modo pantalla (TV / reuniones): pantallas grandes que van rotando solas. Usa la sesión del portal.
import * as API from './api.js';
import { calcularReporte, estado, fmtMillones, fmtPct, fmtFecha, fmtFechaHora, nombreMes, PESOS_MINORISTA } from './calc.js';
import { resumirMes, avanceSucursales, ultimoDiaCompleto, resumenZonas } from './sucursales.js';
import { resumenSupervisores, mejorasSucursales, SIN_SUPERVISOR } from './reportes.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEGUNDOS = 15;               // cada pantalla
const REFRESCO_MIN = 10;           // datos nuevos cada 10 minutos
const chip = (p) => { const e = estado(p); return `<span class="chip ${e.clase}">${fmtPct(p)}</span>`; };
const puntos = (v) => `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(1).replace('.', ',')} pts`;

let pantallas = [];
let actual = 0;
let pausado = false;
let reloj = null;

async function cargar() {
  const [dash, datos] = await Promise.all([API.getDashboard().catch(() => null), API.getSucursales()]);
  const mes = datos.mes;
  const config = mes ? await API.getSucursalesConfig(mes).catch(() => ({})) : {};
  return { published: dash?.published || null, datos, config };
}

function armarPantallas({ published, datos, config }) {
  const out = [];
  // 1. Empresa: lo publicado en el reporte.
  if (published?.corte) {
    const r = calcularReporte(published);
    const unidad = (nombre, c) => `
      <div class="tv-unidad">
        <span>${nombre}</span>
        <b>${fmtPct(c.avance)}</b>
        <small>avance · proyecta ${chip(c.proyeccionPct)}</small>
      </div>`;
    out.push({
      titulo: 'Avance del mes',
      html: `
        <h1 class="tv-h1">Avance de ventas · ${esc(nombreMes(published.corte))}</h1>
        <p class="tv-sub">Ventas hasta el ${esc(fmtFecha(published.corte))}</p>
        <div class="tv-grande">
          <div><span>Avance total</span><b>${fmtPct(r.total.avance)}</b><small>${fmtMillones(r.total.real)} de ${fmtMillones(r.total.objetivo)}</small></div>
          <div><span>Proyección al cierre</span><b class="tv-${estado(r.total.proyeccionPct).clase}">${fmtPct(r.total.proyeccionPct)}</b><small>${fmtMillones(r.total.proyeccion)}</small></div>
        </div>
        <div class="tv-unidades">
          ${unidad('Mayorista', r.unidades.may)}${unidad('Minorista', r.unidades.min)}${unidad('Fineglass', r.unidades.fgl)}${unidad('Fineboats', r.unidades.fbt)}
        </div>`,
    });
  }

  if (!datos?.mes || !datos.filas?.length) return out;
  const mesNombre = nombreMes(`${datos.mes}-01`);
  const cerradas = new Set((config.cerradas || []).map((c) => c.sucursal));
  const maestro = config.maestro?.filas || [];
  const res = resumirMes(datos.filas);
  const objetivos = (config.objetivos?.filas || []).filter((o) => !cerradas.has(o.sucursal));
  const pesos = (published?.corte?.startsWith(datos.mes) && published.pesos) || PESOS_MINORISTA;
  const especiales = published?.especiales || [];
  const hasta = ultimoDiaCompleto(res.dias).fecha;
  const avance = avanceSucursales(res, objetivos, hasta, pesos, especiales);
  const lista = [...avance].map(([sucursal, a]) => ({ sucursal, ...a })).sort((a, b) => b.proyeccionPct - a.proyeccionPct);
  const fila = (s, i, extra = '') => `
    <li><span class="tv-n">${i + 1}</span><span class="tv-nombre">${esc(s.sucursal)}</span>${extra}</li>`;

  // 2. Sucursales: semáforo.
  if (lista.length) {
    const cuenta = { ok: 0, warn: 0, risk: 0 };
    lista.forEach((a) => { cuenta[estado(a.proyeccionPct).clase]++; });
    const vendido = lista.reduce((t, a) => t + a.vendido, 0), obj = lista.reduce((t, a) => t + a.objetivo, 0), proy = lista.reduce((t, a) => t + a.proyeccion, 0);
    out.push({
      titulo: 'Sucursales',
      html: `
        <h1 class="tv-h1">Sucursales Minorista · ${esc(mesNombre)}</h1>
        <p class="tv-sub">${lista.length} sucursales con objetivo · ventas hasta el ${esc(fmtFecha(hasta))}</p>
        <div class="tv-grande">
          <div><span>Avance</span><b>${fmtPct(obj ? vendido / obj : 0)}</b><small>${fmtMillones(vendido)} de ${fmtMillones(obj)}</small></div>
          <div><span>Proyección al cierre</span><b class="tv-${estado(obj ? proy / obj : 0).clase}">${fmtPct(obj ? proy / obj : 0)}</b><small>${fmtMillones(proy)}</small></div>
        </div>
        <div class="tv-semaforo">
          <div class="tv-ok"><b>${cuenta.ok}</b><span>en verde</span><small>proyectan llegar</small></div>
          <div class="tv-warn"><b>${cuenta.warn}</b><span>en amarillo</span><small>90% a 100%</small></div>
          <div class="tv-risk"><b>${cuenta.risk}</b><span>en rojo</span><small>menos de 90%</small></div>
        </div>`,
    });

    // 3. Las 10 mejores en cumplimiento.
    out.push({
      titulo: 'Mejores',
      html: `
        <h1 class="tv-h1">Las 10 que mejor van</h1>
        <p class="tv-sub">Proyección al cierre contra su objetivo</p>
        <ol class="tv-lista">${lista.slice(0, 10).map((s, i) => fila(s, i, `<span class="tv-monto">${fmtMillones(s.proyeccion)}</span>${chip(s.proyeccionPct)}`)).join('')}</ol>`,
    });

    // 4. Más mejoraron.
    const mejoras = mejorasSucursales(res, objetivos, { hasta, dias: 7, pesos, especiales }).filter((m) => m.cambio > 0).slice(0, 10);
    if (mejoras.length) {
      out.push({
        titulo: 'Más mejoraron',
        html: `
          <h1 class="tv-h1">Las que más mejoraron esta semana</h1>
          <p class="tv-sub">Cuánto subió su proyección contra el objetivo en los últimos 7 días</p>
          <ol class="tv-lista">${mejoras.map((m, i) => fila(m, i, `<span class="tv-monto">${fmtPct(m.antes)} → </span>${chip(m.ahora)}<b class="tv-pos">${puntos(m.cambio)}</b>`)).join('')}</ol>`,
      });
    }
  }

  // 5. Supervisores.
  if (maestro.some((m) => m.supervisor) && avance.size) {
    const grupos = resumenSupervisores(res, avance, maestro).filter((g) => g.objetivo > 0 && g.supervisor !== SIN_SUPERVISOR);
    // De a 12 por pantalla, para que se lean todos.
    const partes = Math.ceil(grupos.length / 12);
    for (let p = 0; p < partes; p++) {
      out.push({
        titulo: partes > 1 ? `Supervisores ${p + 1}/${partes}` : 'Supervisores',
        html: `
          <h1 class="tv-h1">Por supervisor${partes > 1 ? ` <small class="tv-parte">${p + 1} de ${partes}</small>` : ''}</h1>
          <p class="tv-sub">Proyección de sus sucursales contra la suma de sus objetivos · sucursales en verde, amarillo y rojo</p>
          <ol class="tv-lista">${grupos.slice(p * 12, p * 12 + 12).map((g, i) => fila({ sucursal: g.supervisor }, p * 12 + i,
            `<span class="tv-sem"><span class="chip ok">${g.verdes}</span><span class="chip warn">${g.amarillas}</span><span class="chip risk">${g.rojas}</span></span>${chip(g.pct)}`)).join('')}</ol>`,
      });
    }
  }

  // 6. Ciudades (si hay ciudades cargadas).
  if (maestro.some((m) => m.zona)) {
    const zonas = resumenZonas(res, maestro).filter((z) => z.zona !== 'SIN CIUDAD').map((z) => {
      let o = 0, p = 0;
      for (const s of z.sucursales) { const a = avance.get(s.sucursal); if (a) { o += a.objetivo; p += a.proyeccion; } }
      return { ...z, pct: o ? p / o : null };
    });
    out.push({
      titulo: 'Ciudades',
      html: `
        <h1 class="tv-h1">Venta por ciudad</h1>
        <p class="tv-sub">${esc(mesNombre)}</p>
        <ol class="tv-lista">${zonas.slice(0, 12).map((z, i) => fila({ sucursal: z.zona }, i, `<span class="tv-monto">${fmtMillones(z.total)}</span>${z.pct !== null ? chip(z.pct) : ''}`)).join('')}</ol>`,
    });
  }

  // 7. Atención: las más lejos del objetivo.
  if (lista.length > 10) {
    const peores = lista.slice(-10).reverse();
    out.push({
      titulo: 'Atención',
      html: `
        <h1 class="tv-h1">Las que más necesitan un empujón</h1>
        <p class="tv-sub">Las 10 más lejos de su objetivo</p>
        <ol class="tv-lista">${peores.map((s, i) => fila(s, i, `<span class="tv-monto">faltan ${fmtMillones(Math.max(s.objetivo - s.vendido, 0))}</span>${chip(s.proyeccionPct)}`)).join('')}</ol>`,
    });
  }
  return out;
}

function mostrar(i) {
  if (!pantallas.length) return;
  actual = (i + pantallas.length) % pantallas.length;
  const el = $('tv-slide');
  el.classList.remove('tv-entra');
  el.innerHTML = pantallas[actual].html;
  void el.offsetWidth; // reinicia la animación
  el.classList.add('tv-entra');
  $('tv-puntos').innerHTML = pantallas.map((p, k) => `<button type="button" data-i="${k}" class="${k === actual ? 'activo' : ''}" title="${esc(p.titulo)}">${esc(p.titulo)}</button>`).join('');
}

function programar() {
  clearInterval(reloj);
  if (!pausado) reloj = setInterval(() => mostrar(actual + 1), SEGUNDOS * 1000);
}

async function refrescar(primera = false) {
  try {
    const d = await cargar();
    pantallas = armarPantallas(d);
    $('tv-actualizado').textContent = d.datos?.actualizado ? `Sucursales al ${fmtFechaHora(d.datos.actualizado)}` : '';
    if (!pantallas.length) { $('tv-slide').innerHTML = '<div class="tv-cargando">Todavía no hay datos para mostrar.</div>'; return; }
    mostrar(primera ? 0 : Math.min(actual, pantallas.length - 1));
    programar();
  } catch (err) {
    if (err.status === 401) {
      $('tv-slide').innerHTML = '<div class="tv-cargando">Para usar el modo pantalla, primero <a href="/">ingresá al portal</a> en este equipo.</div>';
    } else if (primera) {
      $('tv-slide').innerHTML = `<div class="tv-cargando">${esc(err.message)}</div>`;
    }
    // Si falla una actualización, se sigue mostrando lo último que se cargó.
  }
}

function reloj1() {
  $('tv-reloj').textContent = new Date().toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' });
}

$('tv-puntos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b) { mostrar(Number(b.dataset.i)); programar(); }
});
$('tv-pausa').addEventListener('click', () => {
  pausado = !pausado;
  $('tv-pausa').textContent = pausado ? 'Seguir' : 'Pausar';
  programar();
});
const pantallaCompleta = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});
$('tv-full').addEventListener('click', pantallaCompleta);
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { mostrar(actual + 1); programar(); }
  else if (e.key === 'ArrowLeft') { mostrar(actual - 1); programar(); }
  else if (e.key === ' ') { e.preventDefault(); $('tv-pausa').click(); }
  else if (e.key === 'f' || e.key === 'F') pantallaCompleta();
});

reloj1();
setInterval(reloj1, 30e3);
refrescar(true);
setInterval(() => refrescar(), REFRESCO_MIN * 60e3);
