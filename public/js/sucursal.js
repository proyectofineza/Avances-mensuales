// Portal de cada sucursal: autorización del equipo, ingreso con PIN + ubicación y la vista
// de su venta, objetivo, puesto e historial. El servidor solo devuelve datos de esta sucursal.
import { api } from './api.js';
import { fmtMiles, fmtPct, fmtVar, fmtFecha, fmtFechaHora, nombreMes, estado, MESES } from './calc.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gs = (v) => (v === null || v === undefined ? '—' : `Gs. ${fmtMiles(v)}`);
const mill = (v) => (v === null || v === undefined ? '—' : `${(v / 1e6).toLocaleString('es-PY', { maximumFractionDigits: 1 })} M`);
const signo = (v) => (v === null || v === undefined ? '' : v >= 0 ? 'pos' : 'neg');
const MES_CORTO = MESES.map((m) => m.slice(0, 3));
// En el celular los gráficos se dibujan a su ancho para que el texto se lea.
const anchoGraf = () => (window.matchMedia('(max-width: 600px)').matches ? 380 : 720);

// Ubicación del navegador (null si no hay o no se permite).
function ubicacion() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

const error = (el, texto) => { el.textContent = texto; el.hidden = !texto; };
// Quita espacios y otros caracteres antes de limitar el largo, así un código pegado como "5963 8117" entra completo.
const soloDigitos = (el) => el.addEventListener('input', () => {
  el.value = el.value.replace(/\D/g, '').slice(0, Number(el.dataset.digitos) || undefined);
});

async function iniciar() {
  let estadoAcceso;
  try { estadoAcceso = await api('GET', 'suc/estado'); } catch { estadoAcceso = { equipo: null, sesion: false }; }
  if (estadoAcceso.sesion) return abrirPortal();
  $('ps-ingreso').hidden = false;
  $('ps-portal').hidden = true;
  $('ps-autorizar').hidden = Boolean(estadoAcceso.equipo);
  $('ps-login').hidden = !estadoAcceso.equipo;
  if (estadoAcceso.equipo) {
    $('ps-login-titulo').textContent = estadoAcceso.equipo.sucursal;
    $('ps-login-sub').textContent = estadoAcceso.equipo.exigeGps
      ? 'Ingresá el PIN de la sucursal. Se va a pedir la ubicación del equipo: solo se puede ingresar desde el local.'
      : 'Ingresá el PIN de la sucursal.';
    $('ps-pin').focus();
  } else $('ps-codigo').focus();
}

soloDigitos($('ps-codigo'));
soloDigitos($('ps-pin'));

$('ps-autorizar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const codigo = $('ps-codigo').value, nombre = $('ps-equipo-nombre').value.trim();
  if (codigo.length !== 8) return error($('ps-aut-error'), 'El código tiene 8 números.');
  if (!nombre) return error($('ps-aut-error'), 'Poné un nombre al equipo para reconocerlo (ej.: Celular de caja).');
  error($('ps-aut-error'), '');
  const btn = $('ps-aut-btn');
  btn.disabled = true;
  btn.textContent = 'Tomando la ubicación…';
  try {
    const pos = await ubicacion();
    btn.textContent = 'Autorizando…';
    await api('POST', 'suc/autorizar', { codigo, nombre, pos });
    await iniciar();
  } catch (err) {
    error($('ps-aut-error'), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Autorizar equipo';
  }
});

$('ps-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('ps-pin').value;
  if (!/^\d{4,6}$/.test(pin)) return error($('ps-login-error'), 'El PIN tiene de 4 a 6 números.');
  error($('ps-login-error'), '');
  const btn = $('ps-login-btn');
  btn.disabled = true;
  btn.textContent = 'Verificando la ubicación…';
  try {
    const pos = await ubicacion();
    btn.textContent = 'Ingresando…';
    await api('POST', 'suc/ingresar', { pin, pos });
    $('ps-pin').value = '';
    await abrirPortal();
  } catch (err) {
    error($('ps-login-error'), err.message);
    $('ps-pin').value = '';
    if (err.status === 403 && /no está autorizado/.test(err.message)) await iniciar();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});

$('ps-salir').addEventListener('click', async () => {
  await api('POST', 'suc/salir').catch(() => {});
  await iniciar();
});

$('ps-mes').addEventListener('change', () => abrirPortal($('ps-mes').value));

async function abrirPortal(mes) {
  let d;
  try {
    d = await api('GET', `suc/datos${mes ? `?mes=${encodeURIComponent(mes)}` : ''}`);
  } catch (err) {
    if (err.status === 401) return iniciar();
    $('ps-contenido').innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
    return;
  }
  $('ps-ingreso').hidden = true;
  $('ps-portal').hidden = false;
  $('ps-nombre').textContent = d.sucursal;
  $('ps-mes').innerHTML = [...d.meses].reverse().map((m) => `<option value="${m}"${m === d.mes ? ' selected' : ''}>${esc(nombreMes(`${m}-01`))}</option>`).join('');
  $('ps-mes').hidden = !d.meses.length;
  $('ps-actualizado').textContent = d.actualizado ? `Datos actualizados el ${fmtFechaHora(d.actualizado)}` : '';
  $('ps-contenido').innerHTML = d.vista ? vistaHtml(d.vista) : '<div class="card empty">Todavía no hay ventas cargadas.</div>';
}

function vistaHtml(v) {
  const a = v.avance;
  const mesTxt = nombreMes(`${v.mes}-01`);
  if (!v.conVentas) {
    return `<div class="card empty">No hay ventas de ${esc(v.sucursal)} cargadas en ${esc(mesTxt)}.</div>${historialHtml(v)}`;
  }
  const est = a.proyeccionPct !== null ? estado(a.proyeccionPct) : null;
  const ideal = a.diasMes ? Math.min((a.completo ? a.diasMes : Number(a.ultimaFecha.slice(8))) / a.diasMes, 1) : 0;
  const pct = a.pct !== null ? Math.min(a.pct, 1.2) / 1.2 : null;
  const kpi = (label, valor, sub = '', clase = '') => `
    <div class="card kpi ${clase}">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${valor}</span>
      ${sub ? `<span class="kpi-sub">${sub}</span>` : ''}
    </div>`;
  const r = v.ranking;
  return `
    <div class="card ps-hero">
      <div class="card-head">
        <div>
          <h2>${esc(mesTxt)}</h2>
          <p class="muted small" style="margin:2px 0 0">${a.completo ? 'Mes cerrado' : `Ventas hasta el ${esc(fmtFecha(a.ultimaFecha))} · quedan ${a.diasRestantes} día${a.diasRestantes === 1 ? '' : 's'}`}</p>
        </div>
        ${est ? `<span class="chip ${est.clase}">${a.completo ? (a.pct >= 1 ? 'Objetivo cumplido' : 'No llegó al objetivo') : est.texto}</span>` : ''}
      </div>
      ${a.objetivo ? `
        <div class="ps-avance">
          <div class="ps-avance-num"><b>${fmtPct(a.pct)}</b> <span class="muted">del objetivo</span></div>
          <div class="ps-barra" role="img" aria-label="Avance ${fmtPct(a.pct)} del objetivo">
            <div class="ps-barra-fill ${est?.clase || ''}" style="width:${(pct * 100).toFixed(1)}%"></div>
            ${a.completo ? '' : `<div class="ps-barra-ideal" style="left:${((ideal / 1.2) * 100).toFixed(1)}%" title="Donde tendrías que estar hoy"></div>`}
            <div class="ps-barra-meta" style="left:${(100 / 1.2).toFixed(1)}%"></div>
          </div>
          <div class="ps-avance-pie muted small"><span>${gs(a.vendido)} vendido</span><span>Objetivo ${gs(a.objetivo)}</span></div>
        </div>` : '<p class="muted" style="margin:10px 0 0">Todavía no hay un objetivo cargado para este mes.</p>'}
    </div>

    <div class="kpis ps-kpis">
      ${kpi('Vendido en el mes', gs(a.vendido), `Promedio por día ${gs(Math.round(a.promedioDia))}`)}
      ${a.completo ? '' : kpi('Proyección al cierre', gs(a.proyeccion ? Math.round(a.proyeccion) : null), a.proyeccionPct !== null ? `${fmtPct(a.proyeccionPct)} del objetivo` : 'Si sigue el ritmo actual')}
      ${a.objetivo && !a.completo ? kpi('Para llegar al objetivo', a.falta > 0 ? gs(Math.round(a.necesarioDia || 0)) : '¡Llegaste!', a.falta > 0 ? `por día · faltan ${gs(a.falta)}` : `Superaste el objetivo por ${gs(a.vendido - a.objetivo)}`, a.falta > 0 ? '' : 'ps-ok') : ''}
      ${kpi(`Contra ${esc(MESES[Number(v.mes.slice(5)) - 1])} ${Number(v.mes.slice(0, 4)) - 1}`, `<span class="${signo(v.vsAnioAnterior.variacion)}">${fmtVar(v.vsAnioAnterior.variacion)}</span>`,
        v.vsAnioAnterior.anterior ? `${a.completo ? 'Venta' : 'Proyección'} contra ${gs(v.vsAnioAnterior.anterior)} del año anterior` : 'Sin datos del año anterior')}
      ${kpi('Tu puesto', r.cumplimiento ? `${r.cumplimiento.puesto}.º <span class="ps-de">de ${r.cumplimiento.de}</span>` : r.venta ? `${r.venta.puesto}.º <span class="ps-de">de ${r.venta.de}</span>` : '—',
        r.cumplimiento ? `en cumplimiento del objetivo${r.venta ? ` · ${r.venta.puesto}.º en venta` : ''}` : 'en venta del mes')}
    </div>

    ${planHtml(v)}
    ${diasHtml(v)}
    ${historialHtml(v)}`;
}

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Cuánto vender cada día que queda para llegar al objetivo (el fin de semana pide más).
function planHtml(v) {
  const plan = v.avance.plan || [];
  if (!plan.length) return '';
  const max = Math.max(...plan.map((d) => d.monto), 1);
  const visibles = plan.slice(0, 7);
  const filas = visibles.map((d, i) => `
    <li class="ps-plan-dia${d.wd === 0 || d.wd === 5 || d.wd === 6 ? ' finde' : ''}${i === 0 ? ' prox' : ''}">
      <span class="ps-plan-fecha">${i === 0 ? '<b>Próximo día</b> · ' : ''}${DIA_CORTO[d.wd]} ${Number(d.fecha.slice(8))}</span>
      <span class="ps-plan-barra"><i style="width:${(d.monto / max * 100).toFixed(0)}%"></i></span>
      <b class="ps-plan-monto">${gs(Math.round(d.monto))}</b>
    </li>`).join('');
  const resto = plan.length - visibles.length;
  return `
    <div class="card ps-card">
      <div class="card-head"><h2>Cuánto vender cada día</h2><span class="muted small">para llegar al objetivo</span></div>
      <ul class="ps-plan">${filas}</ul>
      <p class="muted small" style="margin:10px 0 0">Lo que falta (${gs(Math.round(v.avance.falta))}) repartido en los ${plan.length} días que quedan según lo que suele venderse cada día: viernes a domingo piden más.${resto > 0 ? ` Se muestran los próximos 7 días; quedan ${resto} más.` : ''} Si un día se vende menos, lo que falta se reparte entre los siguientes.</p>
    </div>`;
}

// Barras de la venta de cada día del mes.
function diasHtml(v) {
  const dias = v.dias;
  if (!dias.length) return '';
  const W = anchoGraf(), H = 180, PAD = 4, max = Math.max(...dias.map((d) => d.monto), 1);
  // Un lugar por cada día del mes: se ve cuánto del mes ya pasó.
  const ancho = (W - PAD) / Math.max(v.avance.diasMes, dias.length);
  const cada = W < 500 ? 3 : 2;
  const barras = dias.map((d, i) => {
    const h = (d.monto / max) * (H - 30);
    const wd = new Date(`${d.fecha}T12:00:00Z`).getUTCDay();
    return `<g><title>${esc(fmtFecha(d.fecha))}: ${gs(d.monto)}</title>
      <rect class="ps-dia${wd === 0 || wd === 6 ? ' ps-dia-finde' : ''}" x="${(PAD + i * ancho + 1.5).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${Math.max(ancho - 3, 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3" style="animation-delay:${(i * 0.015).toFixed(3)}s"/>
      ${i % cada === 0 ? `<text class="ps-eje" x="${(PAD + i * ancho + ancho / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${Number(d.fecha.slice(8))}</text>` : ''}</g>`;
  }).join('');
  const prom = v.avance.promedioDia;
  const yProm = H - 18 - (prom / max) * (H - 30);
  return `
    <div class="card ps-card">
      <div class="card-head"><h2>Venta por día</h2><span class="muted small"><span class="ps-sw ps-sw-finde"></span> sábado y domingo · línea: promedio</span></div>
      <svg class="ps-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Venta por día del mes">
        ${barras}
        <line class="ps-prom" x1="${PAD}" x2="${W}" y1="${yProm.toFixed(1)}" y2="${yProm.toFixed(1)}"/>
      </svg>
    </div>`;
}

// Historial: el año y los dos anteriores, mes a mes, con la variación interanual.
function historialHtml(v) {
  const h = v.historial;
  const Y = h.anio;
  const s1 = h.series[Y - 1], s2 = h.series[Y - 2];
  // El mes en curso no entra en la línea (está a medias): va como proyección punteada.
  const iCurso = h.mesEnCurso ? h.mesEnCurso - 1 : null;
  const s0 = h.series[Y].map((val, i) => (i === iCurso ? null : val));
  const proy = iCurso !== null && v.avance.proyeccion ? v.avance.proyeccion : null;
  const hay = (s) => s.some((x) => x !== null);
  if (!hay(s0) && !hay(s1) && !hay(s2) && !proy) return '';
  const W = anchoGraf(), H = 220, IZQ = 34, DER = 10, ARR = 14, ABA = 26;
  const todos = [...s0, ...s1, ...s2, proy].filter((x) => x !== null);
  const max = Math.max(...todos) * 1.08, min = Math.min(...todos) * 0.85;
  const x = (i) => IZQ + (i * (W - IZQ - DER)) / 11;
  const y = (val) => ARR + (1 - (val - min) / (max - min || 1)) * (H - ARR - ABA);
  const linea = (s, clase) => {
    let d = '', abierto = false;
    s.forEach((val, i) => {
      if (val === null) { abierto = false; return; }
      d += `${abierto ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`;
      abierto = true;
    });
    return d ? `<path class="ps-l ${clase}" d="${d}" pathLength="1"/>` : '';
  };
  const puntos = (s, clase) => s.map((val, i) => (val === null ? '' : `<circle class="${clase}" cx="${x(i).toFixed(1)}" cy="${y(val).toFixed(1)}" r="${clase === 'ps-p0' ? 4.5 : 3.5}"><title>${MESES[i]} ${clase === 'ps-p0' ? Y : clase === 'ps-p1' ? Y - 1 : Y - 2}: ${gs(val)}</title></circle>`)).join('');
  const previo = iCurso > 0 ? s0[iCurso - 1] : null;
  const proyHtml = proy === null ? '' : `
    ${previo !== null ? `<line class="ps-lproy" x1="${x(iCurso - 1).toFixed(1)}" y1="${y(previo).toFixed(1)}" x2="${x(iCurso).toFixed(1)}" y2="${y(proy).toFixed(1)}"/>` : ''}
    <circle class="ps-pproy" cx="${x(iCurso).toFixed(1)}" cy="${y(proy).toFixed(1)}" r="4.5"><title>${MESES[iCurso]} ${Y}: proyección ${gs(Math.round(proy))}</title></circle>`;
  const eje = MES_CORTO.map((m, i) => `<text class="ps-eje" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${m}</text>`).join('');
  const marcas = [min, (min + max) / 2, max].map((val) => `<text class="ps-eje" x="${IZQ - 6}" y="${(y(val) + 4).toFixed(1)}" text-anchor="end">${Math.round(val / 1e6)}</text>`).join('');

  const acu = h.acumulado;
  const filas = MESES.map((m, i) => {
    const varI = h.variaciones[i];
    const enCurso = h.mesEnCurso === i + 1;
    return `<tr${enCurso ? ' class="ps-fila-curso"' : ''}>
      <td><span class="ps-mes-l">${m}</span><span class="ps-mes-c">${MES_CORTO[i]}</span>${enCurso ? ' <span class="muted small ps-mes-l">(en curso)</span>' : ''}</td>
      <td class="r opc">${mill(s2[i])}</td><td class="r">${mill(s1[i])}</td>
      <td class="r">${enCurso ? `<b>${mill(h.series[Y][i])}</b>${proy ? `<br><span class="muted small">proy. ${mill(proy)}</span>` : ''}` : `<b>${mill(s0[i])}</b>`}</td>
      <td class="r ${signo(enCurso ? v.vsAnioAnterior.variacion : varI)}">${enCurso ? `${fmtVar(v.vsAnioAnterior.variacion)}${v.vsAnioAnterior.variacion !== null ? '<br><span class="muted small">proyectado</span>' : ''}` : fmtVar(varI)}</td></tr>`;
  }).join('');
  return `
    <div class="card ps-card">
      <div class="card-head">
        <div>
          <h2>Crecimiento interanual</h2>
          <p class="muted small" style="margin:2px 0 0">${acu ? `En lo que va del año (${acu.meses} mes${acu.meses === 1 ? '' : 'es'} cerrado${acu.meses === 1 ? '' : 's'}): <b class="${signo(acu.variacion)}">${fmtVar(acu.variacion)}</b> contra ${Y - 1}` : `Montos en millones de guaraníes`}</p>
        </div>
        <div class="ps-leyenda small"><span><i class="ps-sw ps-sw-0"></i>${Y}</span><span><i class="ps-sw ps-sw-1"></i>${Y - 1}</span><span><i class="ps-sw ps-sw-2"></i>${Y - 2}</span></div>
      </div>
      <svg class="ps-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Venta mensual de ${Y}, ${Y - 1} y ${Y - 2}">
        ${marcas}${eje}
        ${linea(s2, 'ps-l2')}${linea(s1, 'ps-l1')}${linea(s0, 'ps-l0')}
        ${puntos(s2, 'ps-p2')}${puntos(s1, 'ps-p1')}${puntos(s0, 'ps-p0')}${proyHtml}
      </svg>
      <div class="table-wrap" style="margin-top:12px">
        <table class="suc-tabla ps-tabla">
          <thead><tr><th>Mes</th><th class="r opc">${Y - 2}</th><th class="r">${Y - 1}</th><th class="r">${Y}</th><th class="r">vs ${Y - 1}</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <p class="muted small" style="margin:8px 0 0">Montos en millones de guaraníes.</p>
    </div>`;
}

iniciar();
