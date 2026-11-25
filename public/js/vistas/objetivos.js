// Vista "Objetivo sugerido" (admin).
import * as API from '../api.js';
import { fmtMillones, fmtMiles, fmtVar, fmtFecha, fmtFechaHora, nombreMes, hoyAsuncion, esUltimoDiaDelMes } from '../calc.js';
import { NEGOCIOS, leerPlanillaObjetivos, registrosPorMes, totales, variacion, diferenciasTotales, calcularSugerido, TOPE_TENDENCIA } from '../objetivos.js';
import { $, esc, handleError, showMsg, sumarDias, varHtml } from './comun.js';
import { formatearInput } from './ventas.js';

// ---------- Objetivo sugerido (admin) ----------
// Mismo mes de los dos años anteriores, el mes anterior y el sugerido editable;
// confirmarlo lo copia como objetivo en Cargar ventas.

export const objetivos = { datos: null, calculado: null, turno: 0 };
export const nombreCorto = (mes) => nombreMes(`${mes}-01`).split(' ')[0].toLowerCase();

export function setupObjetivos() {
  $('obj-mes').value = hoyAsuncion().slice(0, 7);
  $('obj-mes').addEventListener('change', () => { if ($('obj-mes').value) loadObjetivos($('obj-mes').value); });
  $('obj-leer').addEventListener('click', guardarPlanillaObjetivos);
  const el = $('obj-contenido');
  el.addEventListener('input', (e) => {
    if (e.target.matches('input[data-neg]')) { formatearInput(e.target); recalcularSugerido(); }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-obj]');
    if (!b) return;
    if (b.dataset.obj === 'crecer') aplicarCrecimiento();
    else if (b.dataset.obj === 'guardar') guardarSugeridoUI();
    else if (b.dataset.obj === 'confirmar') confirmarSugeridoUI();
  });
}

export async function loadObjetivos(mes) {
  const turno = ++objetivos.turno;
  try {
    const datos = await API.getObjetivos(mes);
    if (turno !== objetivos.turno) return;
    objetivos.datos = datos;
    renderObjetivos();
  } catch (err) {
    handleError(err);
  }
}

// Valores del sugerido escritos en la tabla (sin formato).
export function leerSugeridoUI() {
  const v = {};
  document.querySelectorAll('#obj-contenido input[data-neg]').forEach((el) => {
    const n = el.value.replace(/\D/g, '');
    if (n) v[el.dataset.neg] = Number(n);
  });
  return v;
}

export function renderObjetivos() {
  const d = objetivos.datos;
  const [y] = d.mes.split('-').map(Number);
  const nombre = nombreMes(`${d.mes}-01`);
  const enCurso = d.mes === d.mesEnCurso;
  const s = d.sugerido;
  const h1 = d.historia[y - 1]?.valores || null;
  const h2 = d.historia[y - 2]?.valores || null;
  const ant = d.anterior?.valores || null;
  // Lo que calcula el portal según el movimiento; si todavía no hay sugerido guardado, arranca con eso.
  const calc = calcularSugerido(h1, d.movimiento);
  objetivos.calculado = calc;
  const guardado = s?.valores && Object.keys(s.valores).length ? s.valores : null;
  const sug = guardado || calc.valores;
  const editable = enCurso || d.mes > d.mesEnCurso;

  $('obj-titulo').textContent = `Objetivo sugerido · ${nombre}`;
  $('obj-sub').innerHTML = s?.confirmado
    ? `<span class="chip ok">Confirmado</span> el ${fmtFechaHora(s.confirmado)} por ${esc(s.confirmadoPor)}: es el objetivo cargado en Cargar ventas.`
    : guardado
      ? `<span class="chip warn">Sin confirmar</span> Guardado ${fmtFechaHora(s.actualizado)} por ${esc(s.por)}.`
      : Object.keys(calc.valores).length
        ? '<span class="chip">Calculado</span> El sugerido de abajo lo calculó el portal según el movimiento de las ventas: revisalo, ajustalo si hace falta y confirmalo.'
        : 'Todavía no hay datos para calcular el sugerido: pegá tu planilla abajo.';

  const fuente = (h) => (h?.fuente === 'portal' ? ' <small class="muted" title="Del cierre publicado en el portal">(portal)</small>' : '');
  const monto = (v) => (v === undefined || v === null ? '<span class="muted">—</span>' : fmtMiles(v));
  const varCelda = (a, b) => { const v = variacion(a, b); return v === null ? '<span class="muted">—</span>' : varHtml(v); };
  const conVar = (a, b) => `${monto(a)}${b !== null && b !== undefined && a !== undefined && a !== null ? `<small class="obj-var">${varCelda(a, b)}</small>` : ''}`;

  const filaNegocio = (n) => `
    <tr class="${n.id === 'min' || n.id === 'may' ? 'sub-row' : ''}">
      <td data-label="Negocio">${esc(n.nombre)}</td>
      <td class="r opc" data-label="${y - 2}">${monto(h2?.[n.id])}</td>
      <td class="r" data-label="${y - 1}">${conVar(h1?.[n.id], h2?.[n.id])}</td>
      <td class="r opc" data-label="Mes anterior">${monto(ant?.[n.id])}</td>
      <td class="r" data-label="Calculado">${conVar(calc.valores[n.id], h1?.[n.id])}</td>
      <td class="r obj-sug" data-label="Sugerido ${y}"><input type="text" inputmode="numeric" data-neg="${n.id}" value="${sug[n.id] !== undefined ? fmtMiles(sug[n.id]) : ''}" aria-label="Sugerido ${esc(n.nombre)} ${y}"${editable ? '' : ' disabled'}></td>
      <td class="r" data-label="vs ${y - 1}" data-var="${n.id}">${varCelda(sug[n.id], h1?.[n.id])}</td>
    </tr>`;
  const filaTotal = (clave, titulo, clase) => {
    const t = (v) => (v && Object.keys(v).length ? totales(v)[clave] : null);
    return `
    <tr class="${clase}">
      <td data-label="Negocio">${titulo}</td>
      <td class="r opc" data-label="${y - 2}">${monto(t(h2))}</td>
      <td class="r" data-label="${y - 1}">${conVar(t(h1), t(h2))}</td>
      <td class="r opc" data-label="Mes anterior">${monto(t(ant))}</td>
      <td class="r" data-label="Calculado">${conVar(t(calc.valores), t(h1))}</td>
      <td class="r" data-label="Sugerido ${y}" data-total="${clave}">${monto(t(sug))}</td>
      <td class="r" data-label="vs ${y - 1}" data-var="${clave}">${varCelda(t(sug), t(h1))}</td>
    </tr>`;
  };
  const neg = (id) => NEGOCIOS.find((n) => n.id === id);
  const mesAnt = sumarDias(`${d.mes}-01`, -1).slice(0, 7);
  const sinHistoria = !h1 && !h2;

  // Explicación del cálculo, unidad por unidad.
  const mesesTxt = (ms) => ms.map((m) => `${nombreCorto(m)} ${m.slice(0, 4)}`).join(', ');
  const explicacion = Object.entries(calc.detalle).map(([id, x]) => {
    const mov = x.tendencia === null
      ? 'sin meses para comparar: queda igual'
      : `${fmtVar(x.aplicada)} (${mesesTxt(x.meses)} contra el año anterior${x.topeada ? `: fue ${fmtVar(x.tendencia)}, se limitó a ${fmtVar(x.aplicada)}` : ''})`;
    return `<li><b>${esc(neg(id).nombre)}:</b> ${esc(nombreCorto(d.mes))} ${y - 1} ${fmtMillones(x.base)} × ${mov} = <b>${fmtMillones(calc.valores[id])}</b></li>`;
  }).join('');

  $('obj-contenido').innerHTML = `
    ${sinHistoria ? `<p class="nota" style="margin:0 0 14px">No hay datos de ${esc(nombreCorto(d.mes))} de ${y - 2} ni de ${y - 1}. Pegá tu planilla abajo para poder calcular el sugerido.</p>` : ''}
    <div class="card">
      <div class="table-wrap">
        <table class="obj-tabla tarjetas">
          <thead><tr>
            <th>Negocio</th>
            <th class="r opc">${y - 2}${fuente(d.historia[y - 2])}</th>
            <th class="r">${y - 1}${fuente(d.historia[y - 1])}</th>
            <th class="r opc">${esc(nombreMes(`${mesAnt}-01`))}${fuente(d.anterior)}</th>
            <th class="r" title="Calculado por el portal según el movimiento de las ventas">Calculado</th>
            <th class="r">Sugerido ${y}</th>
            <th class="r">vs ${y - 1}</th>
          </tr></thead>
          <tbody>
            ${filaTotal('baratote', 'Baratote', 'grupo-row')}
            ${filaNegocio(neg('min'))}
            ${filaNegocio(neg('may'))}
            ${filaNegocio(neg('fgl'))}
            ${filaNegocio(neg('fbt'))}
            ${filaTotal('general', 'General', 'total-row')}
          </tbody>
        </table>
      </div>
      <p class="muted small" style="margin:12px 0 0">Baratote = Minorista + Mayorista. General = las cuatro unidades. Debajo de ${y - 1} y de Calculado, la variación contra el año anterior.</p>
      ${explicacion ? `
      <details class="obj-explica" open>
        <summary>Cómo se calculó</summary>
        <p class="small" style="margin:8px 0 6px">Para cada unidad: lo que vendió en ${esc(nombreCorto(d.mes))} del año pasado, movido según cómo vienen las ventas de los últimos meses cerrados contra los mismos meses del año anterior (hasta 3 meses; el movimiento se limita a ±${Math.round(TOPE_TENDENCIA * 100)}%). Redondeado al millón.</p>
        <ul class="small">${explicacion}</ul>
      </details>` : ''}
      ${editable ? `
      <div class="obj-acciones">
        <div class="obj-crecer">
          <label for="obj-crec" class="small">Usar lo calculado con un ajuste de</label>
          <div><input type="text" inputmode="decimal" id="obj-crec" value="0" aria-label="Ajuste en porcentaje"><span>%</span>
          <button class="btn btn-sm" type="button" data-obj="crecer"${Object.keys(calc.valores).length ? '' : ' disabled title="No hay datos para calcular"'}>Aplicar</button></div>
        </div>
        <div class="actions" style="margin:0">
          <button class="btn" type="button" data-obj="guardar">Guardar sugerido</button>
          ${enCurso ? `<button class="btn btn-primary" type="button" data-obj="confirmar">Confirmar como objetivo de ${esc(nombreCorto(d.mes))}</button>` : ''}
        </div>
      </div>
      ${enCurso ? '' : `<p class="muted small" style="margin:10px 0 0">Es un mes que todavía no empezó: guardá el sugerido y confirmalo cuando arranque ${esc(nombreCorto(d.mes))}.</p>`}`
    : `<p class="muted small" style="margin:12px 0 0">${esc(nombre)} ya terminó: el sugerido queda solo como referencia.</p>`}
      <div class="alert form-msg" id="obj-msg" hidden></div>
    </div>`;
}

// Al escribir en el sugerido: totales y variaciones al día, sin repintar la tabla.
export function recalcularSugerido() {
  const d = objetivos.datos;
  const [y] = d.mes.split('-').map(Number);
  const h1 = d.historia[y - 1]?.valores || null;
  const v = leerSugeridoUI();
  const t = totales(v);
  const pintarVar = (clave, a, b) => {
    const el = document.querySelector(`#obj-contenido [data-var="${clave}"]`);
    const x = variacion(a, b);
    if (el) el.innerHTML = x === null ? '<span class="muted">—</span>' : varHtml(x);
  };
  for (const n of NEGOCIOS) pintarVar(n.id, v[n.id], h1?.[n.id]);
  for (const clave of ['baratote', 'general']) {
    document.querySelector(`#obj-contenido [data-total="${clave}"]`).textContent = t[clave] ? fmtMiles(t[clave]) : '—';
    pintarVar(clave, t[clave] || null, h1 ? totales(h1)[clave] : null);
  }
}

// Pone en el sugerido lo calculado por el portal, con un ajuste opcional (por ejemplo +3%).
export function aplicarCrecimiento() {
  const calc = objetivos.calculado?.valores || {};
  const g = Number(String($('obj-crec').value).replace(',', '.')) || 0;
  document.querySelectorAll('#obj-contenido input[data-neg]').forEach((el) => {
    const base = calc[el.dataset.neg];
    if (base !== undefined) el.value = fmtMiles(Math.round((base * (1 + g / 100)) / 1e6) * 1e6);
  });
  recalcularSugerido();
}

export async function guardarSugeridoUI(silencioso = false) {
  const d = objetivos.datos;
  try {
    const r = await API.guardarSugerido(d.mes, leerSugeridoUI());
    d.sugerido = r.sugerido;
    if (!silencioso) { renderObjetivos(); showMsg($('obj-msg'), 'Sugerido guardado.', true); }
    return true;
  } catch (err) {
    handleError(err, $('obj-msg'));
    return false;
  }
}

export async function confirmarSugeridoUI() {
  const d = objetivos.datos;
  const v = leerSugeridoUI();
  const falta = NEGOCIOS.filter((n) => !(v[n.id] > 0));
  if (falta.length) { showMsg($('obj-msg'), `Completá el sugerido de ${falta.map((n) => n.nombre).join(', ')}.`, false); return; }
  let draft = null;
  try { draft = await API.getDraft(); } catch { /* sin borrador */ }
  const mesCarga = draft?.corte?.slice(0, 7);
  const lineas = [
    `Se va a cargar como objetivo de ${nombreMes(`${d.mes}-01`)}:`,
    ...NEGOCIOS.map((n) => `• ${n.nombre}: ${fmtMillones(v[n.id])}`),
    `Total: ${fmtMillones(NEGOCIOS.reduce((s, n) => s + v[n.id], 0))}`,
  ];
  if (mesCarga && mesCarga !== d.mes) {
    lineas.push('', `La carga de ventas pasa de ${nombreCorto(mesCarga)} a ${nombreCorto(d.mes)}, con las ventas en cero.`);
    if (mesCarga < d.mes && !esUltimoDiaDelMes(draft.corte)) lineas.push(`Ojo: ${nombreCorto(mesCarga)} todavía no tiene el cierre cargado (último corte: ${fmtFecha(draft.corte)}). Si falta publicarlo, hacelo antes de confirmar.`);
  }
  lineas.push('', 'La comparativa (mes anterior y año anterior) se completa con los datos de esta tabla.', '', '¿Confirmar?');
  if (!confirm(lineas.join('\n'))) return;
  if (!(await guardarSugeridoUI(true))) return;
  try {
    const r = await API.confirmarSugerido(d.mes);
    d.sugerido = r.sugerido;
    renderObjetivos();
    showMsg($('obj-msg'), `Listo: es el objetivo de ${nombreCorto(d.mes)} en Cargar ventas${r.mesNuevo ? ', con la fecha de corte en ' + fmtFecha(r.draft.corte) + ' y las ventas en cero' : ''}. Cargá las ventas y publicá para que lo vean los comerciales.`, true);
  } catch (err) {
    handleError(err, $('obj-msg'));
  }
}

export async function guardarPlanillaObjetivos() {
  const msgEl = $('obj-planilla-msg');
  const difEl = $('obj-diferencias');
  difEl.hidden = true;
  const texto = $('obj-texto').value;
  if (!texto.trim()) { showMsg(msgEl, 'Pegá la planilla.', false); return; }
  const mesElegido = Number($('obj-mes').value.slice(5)) || null;
  const r = leerPlanillaObjetivos(texto, mesElegido);
  const registros = registrosPorMes(r.bloques);
  const meses = Object.keys(registros).sort();
  if (!meses.length) { showMsg(msgEl, r.errores[0]?.motivo || 'No encontré datos. La planilla tiene que empezar con la fila AÑO.', false); return; }

  const enCurso = hoyAsuncion().slice(0, 7);
  const historia = meses.filter((m) => m < enCurso);
  const sugeridos = meses.filter((m) => m >= enCurso);
  const dif = diferenciasTotales(r.bloques);
  if (dif.length) {
    difEl.innerHTML = `<p><b>Totales de la planilla que no coinciden con la suma de sus negocios</b> (el portal usa la suma):</p><ul>${dif.map((x) => `<li>${esc(nombreMes(`${x.anio}-${String(x.mes).padStart(2, '0')}-01`))} · ${x.campo === 'baratote' ? 'Baratote' : 'General'}: la planilla dice ${fmtMiles(x.planilla)}, la suma da ${fmtMiles(x.calculado)} (${x.planilla > x.calculado ? '+' : '−'}${fmtMiles(Math.abs(x.planilla - x.calculado))}).</li>`).join('')}</ul>`;
    difEl.hidden = false;
  }
  const lista = (arr) => arr.map((m) => nombreMes(`${m}-01`)).join(', ');
  const aviso = [
    historia.length ? `Historia (meses terminados): ${lista(historia)}.` : '',
    sugeridos.length ? `Sugerido: ${lista(sugeridos)}${sugeridos.some((m) => objetivos.datos?.sugerido?.confirmado && m === objetivos.datos.mes) ? ' (reemplaza el sugerido confirmado: vas a tener que confirmarlo de nuevo)' : ''}.` : '',
    r.errores.length ? `${r.errores.length} problema${r.errores.length === 1 ? '' : 's'} en la planilla (no se guarda esa celda): ${r.errores[0].motivo}` : '',
    dif.length ? 'Hay totales que no coinciden (ver abajo).' : '',
  ].filter(Boolean);
  if (!confirm(`${aviso.join('\n\n')}\n\n¿Guardar?`)) return;
  try {
    await API.guardarPlanillaObjetivos(registros);
    showMsg(msgEl, `Planilla guardada. ${aviso.slice(0, 2).join(' ')}`, true);
    $('obj-texto').value = '';
    await loadObjetivos($('obj-mes').value);
  } catch (err) {
    handleError(err, msgEl);
  }
}