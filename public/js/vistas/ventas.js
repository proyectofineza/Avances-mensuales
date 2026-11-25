// Vista "Cargar ventas" (admin): formulario del reporte, borrador, publicación y avisos de Teams.
import * as API from '../api.js';
import { UNIDADES, IDS, DIAS_SEMANA, PESOS_MINORISTA, calcularReporte, normalizarEspeciales, diasOperativos, diasUnidad, normalizarReporte, validarReporte, mesAnterior, mismoMesAnioAnterior, fmtMiles, fmtPct, fmtFecha, fmtDiaMes, fmtFechaHora, nombreMes, hoyAsuncion, ultimoDiaDelMes, esUltimoDiaDelMes } from '../calc.js';
import { resumirMes, pesoSemana, ultimoDiaCompleto } from '../sucursales.js';
import { $, CAL_CORTO, DIA_CORTO, esc, handleError, showMsg, showNotice, state, sumarDias, wdDe } from './comun.js';

// ---------- Cargar ventas ----------

export let saveTimer = null;
export let savePromise = Promise.resolve();

export const montoInput = (attr, id, label) =>
  `<input class="num" inputmode="numeric" ${attr} data-id="${id}" aria-label="${esc(label)}">`;

// En celular cada fila se ve como tarjeta: la unidad es el título y cada celda lleva su
// rótulo (data-label).
export function unidadCell(u) {
  return `
      <td class="t-titulo">
        <div class="unidad-nombre">${esc(u.nombre)}</div>
        <div class="unidad-meta">${u.grupo ? 'Canal · ' : ''}${CAL_CORTO[u.calendario]}${u.ponderado ? ' · ponderado' : ''}</div>
      </td>`;
}

export const grupoCell = `
      <td class="t-titulo">
        <div class="unidad-nombre">Baratote</div>
        <div class="unidad-meta">Unidad de negocio · ${CAL_CORTO['lun-dom']}</div>
      </td>`;

// Filas con Baratote como unidad (suma, solo lectura) y sus canales debajo.
export function filasTabla(grupoRow, unidadRow) {
  return UNIDADES.map((u) => `${u.id === 'may' ? grupoRow : ''}
    <tr${u.grupo ? ' class="sub-row"' : ''}>${unidadCell(u)}${unidadRow(u)}</tr>`).join('');
}

export function setupVentas() {
  $('ventas-body').innerHTML = filasTabla(
    `<tr class="grupo-row">${grupoCell}<td class="r" id="bar-obj" data-label="Objetivo mensual"></td><td class="r" id="bar-real" data-label="Venta acumulada"></td><td class="r" id="av-bar" data-label="Avance"></td></tr>`,
    (u) => `
      <td class="r" data-label="Objetivo mensual (Gs.)">${montoInput('data-campo="obj"', u.id, `Objetivo mensual ${u.nombre}`)}</td>
      <td class="r" data-label="Venta acumulada (Gs.)">${montoInput('data-campo="real"', u.id, `Venta acumulada ${u.nombre}`)}</td>
      <td class="r" id="av-${u.id}" data-label="Avance"></td>`,
  );

  $('dias-body').innerHTML = filasTabla(
    `<tr class="grupo-row solo-escritorio">${grupoCell}<td></td><td></td><td></td></tr>`,
    (u) => `
      <td class="r" data-label="Días del mes"><input class="num dias-input" inputmode="numeric" maxlength="2" data-dias="mes" data-id="${u.id}" aria-label="Días del mes ${esc(u.nombre)}"></td>
      <td class="r" data-label="Día en curso"><input class="num dias-input" inputmode="numeric" maxlength="2" data-dias="curso" data-id="${u.id}" aria-label="Día en curso ${esc(u.nombre)}"></td>
      <td class="r" id="ri-${u.id}" data-label="Ritmo ideal"></td>`,
  );

  $('comp-body').innerHTML = filasTabla(
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

  $('pesos-sugeridos').addEventListener('click', (e) => {
    if (!e.target.closest('[data-usar-sugeridos]') || !state.pesosSugeridos) return;
    state.draft.pesos = { ...state.pesosSugeridos.pesos };
    fillPesos();
    onDraftChange();
  });

  // Fechas especiales
  $('btn-esp-agregar').addEventListener('click', () => {
    const d = state.draft;
    const usadas = new Set(d.especiales.map((x) => x.fecha));
    let f = sumarDias(d.corte || hoyAsuncion(), 1);
    while (usadas.has(f)) f = sumarDias(f, 1);
    d.especiales.push({ fecha: f, factor: 1, nota: '' });
    d.especiales.sort((a, b) => a.fecha.localeCompare(b.fecha));
    fillEspeciales();
    onDraftChange();
  });
  $('esp-lista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-esp-borrar]');
    if (!b) return;
    state.draft.especiales.splice(Number(b.dataset.espBorrar), 1);
    fillEspeciales();
    onDraftChange();
  });
  $('esp-lista').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.esp === undefined) return;
    const x = state.draft.especiales[Number(el.dataset.i)];
    if (!x) return;
    if (el.dataset.esp === 'fecha') x.fecha = el.value;
    else if (el.dataset.esp === 'factor') x.factor = Number(el.value.replace(',', '.'));
    else x.nota = el.value;
    state.draft.especiales = normalizarEspeciales(state.draft.especiales);
    fillEspeciales();
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
    fillEspeciales();
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

  $('btn-aviso-diario-test').addEventListener('click', async () => {
    const btn = $('btn-aviso-diario-test');
    btn.disabled = true;
    try {
      const res = await API.testAvisoDiario();
      showMsg($('teams-msg'), `Aviso diario de prueba enviado (plan del ${fmtFecha(res.fecha)})${res.canal ? ' al canal ' + res.canal : ''}. Revisá Teams.`, true);
    } catch (err) {
      handleError(err, $('teams-msg'));
    } finally {
      btn.disabled = false;
    }
  });

  $('btn-resumen-semanal-test').addEventListener('click', async () => {
    const btn = $('btn-resumen-semanal-test');
    btn.disabled = true;
    try {
      const res = await API.testResumenSemanal();
      showMsg($('teams-msg'), `Resumen semanal de prueba enviado (del ${fmtDiaMes(res.desde)} al ${fmtDiaMes(res.hasta)})${res.canal ? ' al canal ' + res.canal : ''}. Revisá Teams.`, true);
    } catch (err) {
      handleError(err, $('teams-msg'));
    } finally {
      btn.disabled = false;
    }
  });

  $('resumen-semanal').addEventListener('change', async (e) => {
    const chk = e.target;
    chk.disabled = true;
    try {
      const res = await API.setResumenSemanal(chk.checked);
      pintarResumenSemanal(res.resumenSemanal);
      showMsg($('teams-msg'), res.resumenSemanal.activo ? 'Resumen semanal activado: sale los lunes a las 08:00.' : 'Resumen semanal desactivado.', true);
    } catch (err) {
      chk.checked = !chk.checked;
      handleError(err, $('teams-msg'));
    } finally {
      chk.disabled = false;
    }
  });

  $('aviso-diario').addEventListener('change', async (e) => {
    const chk = e.target;
    chk.disabled = true;
    try {
      const res = await API.setAvisoDiario(chk.checked);
      pintarAvisoDiario(res.avisoDiario);
      showMsg($('teams-msg'), res.avisoDiario.activo ? 'Aviso diario activado: sale todos los días a las 08:00.' : 'Aviso diario desactivado.', true);
    } catch (err) {
      chk.checked = !chk.checked;
      handleError(err, $('teams-msg'));
    } finally {
      chk.disabled = false;
    }
  });
}

export function pintarResumenSemanal(a = {}) {
  $('resumen-semanal').checked = Boolean(a.activo);
  $('resumen-semanal-estado').textContent = a.activo
    ? `Activado${a.por ? ` por ${a.por}` : ''}.${a.ultimo ? ` Último envío: ${fmtFecha(a.ultimo)}.` : ''}`
    : 'Desactivado.';
}

export function pintarAvisoDiario(a = {}) {
  $('aviso-diario').checked = Boolean(a.activo);
  $('aviso-diario-estado').textContent = a.activo
    ? `Activado${a.por ? ` por ${a.por}` : ''}.${a.ultimo ? ` Último envío: ${fmtFecha(a.ultimo)}.` : ''}`
    : 'Desactivado.';
}

export async function loadTeamsEstado() {
  const el = $('teams-estado');
  try {
    const t = await API.getTeams();
    el.innerHTML = t.configurado
      ? `<span class="chip ok">Configurado</span> ${t.canal ? 'Canal: ' + esc(t.canal) : ''}`
      : '<span class="chip warn">Sin configurar</span> Falta cargar TEAMS_WEBHOOK_URL en Netlify.';
    $('btn-teams-test').disabled = !t.configurado;
    $('btn-aviso-diario-test').disabled = !t.configurado;
    $('aviso-diario').disabled = !t.configurado;
    $('btn-resumen-semanal-test').disabled = !t.configurado;
    $('resumen-semanal').disabled = !t.configurado;
    pintarAvisoDiario(t.avisoDiario);
    pintarResumenSemanal(t.resumenSemanal);
  } catch {
    el.textContent = 'No se pudo verificar la configuración.';
  }
}

// Formatea con separador de miles manteniendo la posición del cursor.
export function formatearInput(el) {
  const pos = el.selectionStart ?? el.value.length;
  const digitosAntes = el.value.slice(0, pos).replace(/\D/g, '').length;
  const digitos = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  el.value = digitos ? fmtMiles(Number(digitos)) : '';
  let n = 0, i = 0;
  while (i < el.value.length && n < digitosAntes) { if (/\d/.test(el.value[i])) n++; i++; }
  el.setSelectionRange(i, i);
}

export async function loadVentas() {
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
    cargarPesosSugeridos();
  } catch (err) {
    handleError(err, $('ventas-error'));
  }
}

// Si la fecha de corte quedó vieja (de una carga anterior), propone la de ayer, que es hasta
// donde suelen llegar las ventas. Al empezar un mes, primero propone cerrar el anterior
// (fecha = su último día); con el anterior ya cerrado, avisa que hay que pasar al mes nuevo.
export function sugerirCorte() {
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

export function fillVentasForm() {
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
  fillEspeciales();
  updateVentasCalc();
}

export function fillEspeciales() {
  const lista = state.draft.especiales || [];
  const mes = (state.draft.corte || '').slice(0, 7);
  $('esp-lista').innerHTML = lista.length ? `
    <div class="table-wrap"><table class="esp-tabla">
      <thead><tr><th>Fecha</th><th class="r">Factor</th><th>Nota</th><th></th></tr></thead>
      <tbody>${lista.map((x, i) => `
        <tr class="${x.fecha.startsWith(mes) ? '' : 'otro-mes'}">
          <td><input type="date" data-esp="fecha" data-i="${i}" value="${esc(x.fecha)}" aria-label="Fecha especial"> <span class="muted small">${DIA_CORTO[wdDe(x.fecha)]}</span></td>
          <td class="r"><input class="num esp-factor" inputmode="decimal" maxlength="4" data-esp="factor" data-i="${i}" value="${String(x.factor).replace('.', ',')}" aria-label="Factor del ${fmtFecha(x.fecha)}"></td>
          <td><input data-esp="nota" data-i="${i}" maxlength="40" value="${esc(x.nota)}" placeholder="Ej.: Nochebuena" aria-label="Nota del ${fmtFecha(x.fecha)}"></td>
          <td class="r"><button class="btn btn-sm" type="button" data-esp-borrar="${i}" aria-label="Quitar ${fmtFecha(x.fecha)}">Quitar</button></td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="muted small" style="margin:8px 0 0">Las fechas de otros meses quedan guardadas y se aplican cuando llegue su mes.</p>`
    : '<p class="muted small" style="margin:0">No hay fechas especiales cargadas.</p>';
}

// Pesos de Minorista sugeridos con la venta por sucursal de las últimas 8 semanas (días completos,
// sin fechas especiales). Necesita al menos 3 días de cada día de la semana.
export async function cargarPesosSugeridos() {
  const el = $('pesos-sugeridos');
  state.pesosSugeridos = null;
  el.hidden = true;
  try {
    const corte = state.draft.corte || hoyAsuncion();
    const mes = corte.slice(0, 7);
    const ant = sumarDias(`${mes}-01`, -1).slice(0, 7);
    const [a, b] = await Promise.all([API.getSucursales(ant).catch(() => null), API.getSucursales(mes).catch(() => null)]);
    const filas = [...(a?.mes === ant ? a.filas : []), ...(b?.mes === mes ? b.filas : [])];
    if (!filas.length) return;
    const dias = resumirMes(filas).dias;
    const hasta = ultimoDiaCompleto(dias).fecha;
    if (!hasta) return;
    const desde = sumarDias(hasta, -55);
    const esp = new Set((state.draft.especiales || []).map((x) => x.fecha));
    const usados = dias.filter((d) => d.fecha >= desde && d.fecha <= hasta && !esp.has(d.fecha));
    const { peso, cuenta } = pesoSemana(usados);
    if (cuenta.some((n) => n < 3)) return;
    const pesos = Object.fromEntries(DIAS_SEMANA.map((d) => [d.k, Math.round(peso[d.wd] * 1000) / 10]));
    state.pesosSugeridos = { pesos, desde: usados[0].fecha, hasta };
    const actual = state.draft.pesos;
    const cambia = DIAS_SEMANA.some((d) => Math.abs((Number(actual[d.k]) || 0) - pesos[d.k]) >= 0.5);
    el.innerHTML = `
      <div><b>Sugeridos con la venta real</b> <span class="muted small">(sucursales del ${fmtFecha(state.pesosSugeridos.desde)} al ${fmtFecha(hasta)}, sin fechas especiales)</span></div>
      <div class="sug-grid">${DIAS_SEMANA.map((d) => {
        const dif = pesos[d.k] - (Number(actual[d.k]) || 0);
        return `<span><small>${d.nombre.slice(0, 3)}</small><b>${fmtPeso(pesos[d.k])}%</b>${Math.abs(dif) >= 0.5 ? `<i class="${dif > 0 ? 'var-pos' : 'var-neg'}">${dif > 0 ? '+' : '−'}${fmtPeso(Math.abs(dif))}</i>` : ''}</span>`;
      }).join('')}</div>
      ${cambia ? '<button class="btn btn-sm" type="button" data-usar-sugeridos>Usar los sugeridos</button>' : '<p class="muted small" style="margin:6px 0 0">Los pesos cargados ya coinciden con la venta real.</p>'}`;
    el.hidden = false;
  } catch { /* sin sugerencia */ }
}

export const fmtPeso = (v) => String(Math.round((Number(v) || 0) * 10) / 10).replace('.', ',');

export function fillPesos() {
  document.querySelectorAll('#pesos-grid input').forEach((el) => {
    el.value = fmtPeso(state.draft.pesos[el.dataset.peso]);
  });
}

// En automático muestra los días del calendario (solo lectura); en manual, los cargados.
export function fillDias() {
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

export function updateVentasCalc() {
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

export function onDraftChange() {
  updateVentasCalc();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}

// Guarda el borrador en el servidor; los guardados se encadenan en orden.
export function saveNow() {
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
export function dudasAntesDePublicar(d) {
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

export async function publicar() {
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

export function renderUltimaPub() {
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