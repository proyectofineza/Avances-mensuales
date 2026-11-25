// Sucursales (admin): carga de la planilla diaria, listado y objetivos, horario comercial y portal de sucursales.
import * as API from '../api.js';
import { fmtMillones, fmtMiles, fmtPct, fmtFecha, fmtFechaHora, nombreMes, hoyAsuncion } from '../calc.js';
import { leerHistorialSucursales, fmtDistancia as fmtMetros } from '../portal-sucursal.js';
import { leerPlanilla, NO_MINORISTA, leerMaestro, leerObjetivos, controlMaestro, zonaSugerida, normalizarSucursal, repartirObjetivo, parseMonto } from '../sucursales.js';
import { leerPlanillaHoras, tieneHora, minutos, NOMBRES_DIA } from '../dia-comercial.js';
import { cierre } from './cierre.js';
import { $, DIA_CORTO, descargarCsv, esc, fechaDeMes, handleError, leerArchivo, showMsg, wdDe } from './comun.js';
import { loadSucursales, suc } from './sucursales.js';

// ---- Portal de sucursales (admin): PIN, equipos autorizados, ubicación e historial ----

export let accesosSuc = [];

export function setupPortalSucursales() {
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

export async function cargarAccesos() {
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

export function pintarAccesos() {
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

export async function accionAcceso(datos, alTerminar) {
  try {
    const r = await API.accionAccesoSucursal(datos);
    alTerminar?.();
    await cargarAccesos();
    showMsg($('sa-msg'), r.mensaje, true);
  } catch (err) {
    handleError(err, $('sa-msg'));
  }
}

export async function generarCodigo(sucursal) {
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

export function editarUbicacion(a) {
  const actual = a.ubicacion ? `${a.ubicacion.lat}, ${a.ubicacion.lng}` : '';
  const texto = prompt(`Ubicación de ${a.sucursal}: copiala de Google Maps (clic derecho sobre el local → las coordenadas).\nEjemplo: -25.2637, -57.5759`, actual);
  if (texto === null) return;
  const m = texto.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return showMsg($('sa-msg'), 'No entendí la ubicación. Tiene que ser latitud, longitud (por ejemplo -25.2637, -57.5759).', false);
  const radio = prompt('Radio permitido alrededor del local, en metros (50 a 5.000):', String(a.radio || 300));
  if (radio === null) return;
  accionAcceso({ tipo: 'ubicacion', sucursal: a.sucursal, lat: Number(m[1]), lng: Number(m[2]), radio: Number(radio) });
}

export async function guardarHistorialSucursales() {
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

export function setupConfigSucursales() {
  $('cfg-obj-mes').value = hoyAsuncion().slice(0, 7);
  $('cfg-rep-base').value = mesPrevio($('cfg-obj-mes').value);
  $('cfg-obj-mes').addEventListener('change', () => {
    if ($('cfg-obj-mes').value) $('cfg-rep-base').value = mesPrevio($('cfg-obj-mes').value);
    cargarObjetivosConfig();
  });
  $('cfg-rep-btn').addEventListener('click', repartirObjetivoGeneral);
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

export const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
export const quitarTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function pintarHorario() {
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
export function pintarCruces() {
  for (const wd of ORDEN_DIAS) {
    const ap = minutos($(`hc-ap-${wd}`)?.value), ci = minutos($(`hc-ci-${wd}`)?.value);
    const el = $(`hc-x-${wd}`);
    if (el) el.textContent = ap !== null && ci !== null && ci <= ap ? `del ${NOMBRES_DIA[(wd + 1) % 7].toLowerCase()}` : '';
  }
}

// "LUQUE 1;Viernes;16:00;03:00" (o Todos) → { SUC: { wd: { apertura, cierre } } }.
export function leerHorariosPropios(texto) {
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

export async function guardarHorario() {
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

export function pintarEstadoConfig() {
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

export async function cargarObjetivosConfig() {
  const mes = $('cfg-obj-mes').value;
  if (!mes) return;
  try { suc.cfgObj = (await API.getSucursalesConfig(mes)).objetivos; } catch { suc.cfgObj = null; }
  pintarEstadoConfig();
}

export function mesPrevio(mes) {
  const [y, m] = mes.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Reparte el objetivo general según el peso % de los objetivos de otro mes y deja la planilla
// en el cuadro de pegado, para revisarla y guardarla con "Revisar y guardar".
export async function repartirObjetivoGeneral() {
  const msgEl = $('cfg-obj-msg');
  const info = $('cfg-rep-info');
  const mes = $('cfg-obj-mes').value, base = $('cfg-rep-base').value;
  const total = parseMonto($('cfg-rep-total').value);
  info.hidden = true;
  if (!mes) { showMsg(msgEl, 'Elegí el mes de los objetivos.', false); return; }
  if (!total) { showMsg(msgEl, 'Cargá el objetivo total en guaraníes (por ejemplo 23.500.000.000).', false); return; }
  if (!base || base === mes) { showMsg(msgEl, 'Elegí otro mes para tomar el peso de cada sucursal.', false); return; }
  let filasBase;
  try { filasBase = (await API.getSucursalesConfig(base)).objetivos?.filas || []; } catch (err) { handleError(err, msgEl); return; }
  if (!filasBase.length) { showMsg(msgEl, `${nombreMes(fechaDeMes(base))} no tiene objetivos por sucursal: cargalos primero o elegí otro mes.`, false); return; }
  // Afuera las que cerraron antes de que empiece el mes.
  const cerradas = [...suc.cerradas.entries()].filter(([, f]) => !f || f <= `${mes}-01`).map(([s]) => s);
  const filas = repartirObjetivo(filasBase, total, { excluir: cerradas });
  const suma = filas.reduce((s, f) => s + f.objetivo, 0);
  const fuera = filasBase.length - filas.length;
  $('cfg-obj-texto').value = ['Sucursal\tObjetivo\t%', ...filas.map((f) => `${f.sucursal}\t${f.objetivo}\t${(f.peso * 100).toFixed(2).replace('.', ',')}%`)].join('\n');
  info.innerHTML = `${filas.length} sucursales con el peso de ${esc(nombreMes(fechaDeMes(base)))}${fuera ? ` (${fuera} cerrada${fuera === 1 ? '' : 's'} afuera)` : ''}. Suma ${fmtMillones(suma)}${suma !== total ? ` (${fmtMillones(suma - total)} por el redondeo)` : ''}. Revisá el cuadro y tocá <b>Revisar y guardar</b>.`;
  info.hidden = false;
  msgEl.hidden = true;
}

// Sucursales conocidas: las del mes abierto más las del listado.
export function nombresConocidos() {
  return [...new Set([...(suc.res?.sucursales || []).map((s) => s.sucursal), ...suc.info.keys()])].sort();
}

export function descargarBase(tipo) {
  const nombres = nombresConocidos();
  const msgEl = $(tipo === 'maestro' ? 'cfg-maestro-msg' : 'cfg-obj-msg');
  if (!nombres.length) { showMsg(msgEl, 'Primero cargá una planilla de ventas para conocer las sucursales.', false); return; }
  if (tipo === 'maestro') {
    descargarCsv('sucursales-listado.csv', [['Sucursal', 'Ciudad', 'Encargado', 'Supervisor'],
      ...nombres.map((n) => [n, suc.info.get(n)?.zona || zonaSugerida(n), suc.info.get(n)?.encargado || '', suc.info.get(n)?.supervisor || ''])]);
    showMsg(msgEl, 'La ciudad viene sugerida por el nombre de la sucursal: corregila (por ejemplo ROJAS CAÑADA → CAPIATÁ) y completá el encargado y el supervisor.', true);
  } else {
    const mes = $('cfg-obj-mes').value;
    const obj = new Map((suc.cfgObj?.filas || []).map((f) => [f.sucursal, f.objetivo]));
    descargarCsv(`objetivos-sucursales-${mes}.csv`, [['Sucursal', 'Objetivo'], ...nombres.map((n) => [n, obj.get(n) ?? ''])]);
    showMsg(msgEl, 'Completá el objetivo de cada sucursal; las que quedan vacías no se cargan.', true);
  }
}

export async function guardarConfig(tipo) {
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
  const soloSup = tipo === 'maestro' && r.soloSupervisor;
  const detalle = soloSup
    ? `supervisor de ${r.filas.length} sucursales (${new Set(r.filas.map((f) => f.supervisor).filter(Boolean)).size} supervisores); la ciudad y el encargado no cambian`
    : tipo === 'maestro'
    ? `${r.filas.length} sucursales en ${new Set(r.filas.map((f) => f.zona).filter(Boolean)).size} ciudades, ${new Set(r.filas.map((f) => f.supervisor).filter(Boolean)).size} supervisores`
    : `${r.filas.length} sucursales, total ${fmtMillones(r.filas.reduce((s, f) => s + f.objetivo, 0))} para ${nombreMes(fechaDeMes(mes))}`;
  const avisos = [
    r.errores.length ? `${r.errores.length} línea${r.errores.length === 1 ? '' : 's'} con problemas no se van a guardar (línea ${r.errores[0].linea}: ${r.errores[0].motivo})` : '',
    raras.length ? `${raras.length} no coinciden con ninguna sucursal con ventas: ${raras.slice(0, 8).join(', ')}${raras.length > 8 ? '…' : ''}` : '',
  ].filter(Boolean);
  const accion = soloSup ? 'Se va a actualizar el' : `Se va a reemplazar ${tipo === 'maestro' ? 'el listado' : 'los objetivos del mes'}:`;
  if (!confirm(`${accion} ${detalle}.${avisos.length ? '\n\n' + avisos.join('\n') : ''}\n\n¿Guardar?`)) return;

  try {
    if (soloSup) await API.asignarSupervisores(r.filas.map((f) => ({ sucursal: f.sucursal, supervisor: f.supervisor })));
    else if (tipo === 'maestro') await API.saveMaestro(r.filas);
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

export function revisarPlanilla() {
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
export function pintarResumenComercial(r) {
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
export function pintarControlMaestro(filas, ultima) {
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

export async function guardarPlanilla() {
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
    await loadSucursales(mes);
    msgEl.textContent += ' Para actualizar el análisis del mes, andá a la pestaña Informe IA.';
  } catch (err) {
    btn.disabled = false;
    handleError(err, msgEl);
  }
}

export async function borrarMesSucursales() {
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