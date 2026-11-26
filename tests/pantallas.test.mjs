// Pruebas de pantallas: abre el portal en un Chrome sin ventana, con datos inventados, y recorre todas las
// pantallas y pestañas como administrador y como comercial, en computadora y en celular.
// Falla si alguna pantalla tira un error, queda vacía o se sale de ancho en el celular.
// Uso: npm run test:pantallas  (si no hay Chrome ni Edge instalado, se omite).
import assert from 'node:assert/strict';
import { abrirChrome, buscarChrome } from './pantallas/chrome.mjs';
import { arrancarServidor, USUARIOS } from './pantallas/servidor.mjs';

const chromePath = buscarChrome();
if (!chromePath) {
  console.log('pantallas: se omiten (no se encontró Chrome ni Edge; se puede indicar con CHROME_PATH)');
  process.exit(0);
}

const SUBS = ['resumen', 'informe', 'ranking', 'matriz', 'supervisores', 'zonas', 'calor', 'comparar', 'alertas'];
const servidor = await arrancarServidor();
const chrome = await abrirChrome(chromePath);
const fallas = [];
let pruebas = 0;

// Corre una prueba; los errores de la página durante la prueba también la hacen fallar.
// Cada prueba tiene 20 s como máximo. Con DETALLE=1 se muestra cada paso.
async function prueba(pestana, nombre, fn) {
  pruebas++;
  pestana.errores.length = 0;
  const inicio = Date.now();
  if (process.env.DETALLE) console.log(`  … ${nombre}`);
  try {
    let reloj;
    await Promise.race([fn(), new Promise((_, mal) => { reloj = setTimeout(() => mal(new Error('tardó más de 20 s')), 20000); })]).finally(() => clearTimeout(reloj));
    if (process.env.DETALLE) console.log(`    ok (${Date.now() - inicio} ms)`);
    assert.deepEqual(pestana.errores, [], 'la página mostró errores');
  } catch (err) {
    fallas.push(`${nombre}: ${err.message}${pestana.errores.length ? `\n      ${pestana.errores.join('\n      ')}` : ''}`);
  }
}

async function ingresar(pestana, quien) {
  await pestana.ir(`${servidor.url}/index.html`);
  const r = await pestana.eval(`fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(USUARIOS[quien])}) }).then((r) => r.status)`);
  assert.equal(r, 200, `no se pudo ingresar como ${quien}`);
  pestana.errores.length = 0; // el 401 de /api/me antes de ingresar es esperado
}

const textoDe = (pestana, sel) => pestana.eval(`(document.querySelector(${JSON.stringify(sel)})?.innerText || '').trim()`);
const visible = (pestana, sel) => pestana.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`);
const anchoSobra = (pestana) => pestana.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth');
const barraInferior = (pestana) => pestana.eval(`[...document.querySelectorAll('.nav-inferior .tab')].filter((t) => t.getClientRects().length).map((t) => t.querySelector('span').textContent.trim())`);

async function irA(pestana, hash) {
  await pestana.eval(`location.hash = ${JSON.stringify(hash)}`);
  await pestana.quieta();
}

try {
  // ---------- Administrador en la computadora ----------
  const admin = await chrome.nuevaPestana();
  await admin.tamano(1366, 900);
  await ingresar(admin, 'admin');
  await admin.ir(`${servidor.url}/app.html#dashboard`);

  await prueba(admin, 'admin · Dashboard', async () => {
    assert.match(await textoDe(admin, '#dash'), /Avance de ventas/);
    assert.ok(await visible(admin, '.rapido'), 'falta la vista rápida');
  });
  await prueba(admin, 'admin · atajo del Dashboard a Sucursales', async () => {
    await admin.eval(`document.querySelector('.u-ir').click()`);
    await admin.quieta();
    assert.equal(await admin.eval('location.hash'), '#sucursales/ranking');
  });
  for (const sub of SUBS) {
    await prueba(admin, `admin · Sucursales → ${sub}`, async () => {
      await irA(admin, `#sucursales/${sub}`);
      assert.equal(await admin.eval(`document.querySelector('#suc-subtabs .active')?.dataset.sub`), sub);
      assert.ok((await textoDe(admin, '#suc-contenido')).length > 40, 'la pestaña quedó vacía');
    });
  }
  await prueba(admin, 'admin · panel de una sucursal', async () => {
    await irA(admin, '#sucursales/ranking');
    await admin.eval(`document.querySelector('#suc-contenido [data-suc]').click()`);
    await admin.quieta();
    assert.ok(await visible(admin, '#suc-panel'), 'no se abrió el panel');
    assert.match(await textoDe(admin, '#suc-panel-body'), /Venta del mes/);
    await admin.tecla('Escape');
    assert.equal(await visible(admin, '#suc-panel'), false, 'Esc no cerró el panel');
  });
  await prueba(admin, 'admin · botón Administrar', async () => {
    assert.equal(await visible(admin, '#suc-carga'), false, 'las cajas de administración deberían empezar ocultas');
    await admin.eval(`document.getElementById('suc-admin-btn').click()`);
    assert.ok(await visible(admin, '#suc-carga'), 'Administrar no mostró las cajas');
    await admin.eval(`document.getElementById('suc-admin-btn').click()`);
    assert.equal(await visible(admin, '#suc-carga'), false);
  });
  await prueba(admin, 'admin · buscador (Ctrl+K, buscar, Enter)', async () => {
    await irA(admin, '#dashboard');
    await admin.tecla('k', { ctrl: true });
    assert.equal(await admin.eval(`document.getElementById('buscador').open`), true, 'Ctrl+K no abrió el buscador');
    await admin.escribir('lambare');
    const n = await admin.eval(`document.querySelectorAll('#buscador-lista [data-i]').length`);
    assert.ok(n > 0, 'sin resultados para "lambare" (sin tilde)');
    const primero = await admin.eval(`document.querySelector('#buscador-lista [data-i]').dataset.buscarSuc`);
    await admin.tecla('Enter');
    assert.equal(await admin.eval(`document.getElementById('buscador').open`), false);
    assert.equal(await textoDe(admin, '#suc-panel-titulo'), primero, 'Enter no abrió la sucursal elegida');
    assert.equal(await admin.eval('location.hash'), '#dashboard', 'el buscador no debería cambiar de pantalla');
    await admin.tecla('Escape');
  });
  await prueba(admin, 'admin · tecla "/" abre el buscador', async () => {
    await admin.eval('document.activeElement?.blur()');
    await admin.tecla('/', { code: 'Slash' });
    assert.equal(await admin.eval(`document.getElementById('buscador').open`), true);
    await admin.tecla('Escape');
    assert.equal(await admin.eval(`document.getElementById('buscador').open`), false);
  });
  await prueba(admin, 'admin · teclas 1 a 7', async () => {
    await admin.eval('document.activeElement?.blur()');
    await admin.tecla('2');
    assert.match(await admin.eval('location.hash'), /^#sucursales/);
    await admin.tecla('4');
    assert.equal(await admin.eval('location.hash'), '#cierre');
    await admin.tecla('1');
    assert.equal(await admin.eval('location.hash'), '#dashboard');
  });
  for (const [hash, sel] of [['#cierre', '#cierre-contenido'], ['#anual', '#view-anual'], ['#ventas', '#view-ventas'], ['#objetivos', '#view-objetivos'], ['#usuarios', '#view-usuarios']]) {
    await prueba(admin, `admin · ${hash.slice(1)}`, async () => {
      await irA(admin, hash);
      assert.ok(await visible(admin, `#view-${hash.slice(1)}`), 'la pantalla no se mostró');
      assert.ok((await textoDe(admin, sel)).length > 40, 'la pantalla quedó vacía');
    });
  }
  await prueba(admin, 'admin · objetivo anual: guardar el crecimiento', async () => {
    await irA(admin, '#anual');
    assert.match(await textoDe(admin, '.an-meta'), /Objetivo anual \d{4}/);
    assert.ok(await admin.eval(`document.querySelectorAll('.an-meta tbody tr').length`) >= 4, 'faltan filas por unidad');
    await admin.eval(`document.getElementById('meta-crec').value = '12'; document.querySelector('[data-meta-guardar]').click()`);
    await admin.quieta();
    assert.match(await textoDe(admin, '.an-meta'), /\+12%/);
    assert.match(await textoDe(admin, '#meta-msg'), /guardado/i);
  });
  await prueba(admin, 'admin · objetivo sugerido: año anterior + %', async () => {
    await irA(admin, '#objetivos');
    await admin.eval(`document.querySelector('[data-obj="anioant"]').click()`);
    const v = await admin.eval(`document.querySelector('#obj-contenido input[data-neg="may"]').value`);
    assert.ok(v.replace(/\D/g, '').length >= 7, `no se completó el sugerido (${v})`);
  });
  await prueba(admin, 'admin · marcar a un usuario como supervisor', async () => {
    await irA(admin, '#usuarios');
    await admin.eval(`document.querySelector('[data-accion="supervisor"][data-ci="${USUARIOS.comercial.ci}"]').click()`);
    await admin.quieta();
    assert.ok(await admin.eval(`document.querySelectorAll('#sup-lista option').length`) > 0, 'no sugiere los supervisores del listado');
    await admin.eval(`document.getElementById('sup-input').value = 'Supervisor Dos'; document.querySelector('[data-accion="guardar-sup"]').click()`);
    await admin.quieta();
    assert.match(await textoDe(admin, '#users-body'), /Supervisor: Supervisor Dos/);
  });
  await prueba(admin, 'admin · mismo mes entre Sucursales y Cierre', async () => {
    await irA(admin, '#cierre');
    await admin.eval(`(() => { const s = document.getElementById('cierre-mes'); s.value = ${JSON.stringify(servidor.datos.previo)}; s.dispatchEvent(new Event('change')); })()`);
    await admin.quieta();
    await irA(admin, '#sucursales/resumen');
    assert.equal(await admin.eval(`document.getElementById('suc-mes').value`), servidor.datos.previo);
  });
  await prueba(admin, 'admin · abre en la última pantalla usada', async () => {
    await irA(admin, '#anual');
    await admin.ir(`${servidor.url}/app.html`);
    assert.equal(await admin.eval('location.hash'), '#anual');
  });

  // ---------- Administrador en el celular ----------
  await admin.tamano(375, 812, true);
  await admin.ir(`${servidor.url}/app.html#dashboard`);
  await prueba(admin, 'admin celular · barra inferior', async () => {
    assert.deepEqual(await barraInferior(admin), ['Inicio', 'Sucursales', 'Cargar', 'Cierre', 'Más']);
    assert.equal(await textoDe(admin, '#tab-badge-inf'), '1', 'falta el aviso de la solicitud pendiente sobre "Más"');
  });
  for (const hash of ['#dashboard', '#sucursales/ranking', '#sucursales/matriz', '#sucursales/calor', '#cierre', '#anual', '#ventas', '#objetivos', '#usuarios']) {
    await prueba(admin, `admin celular · ${hash} entra a lo ancho`, async () => {
      await irA(admin, hash);
      assert.ok(await anchoSobra(admin) <= 1, `la página se sale ${await anchoSobra(admin)} px de ancho`);
    });
  }
  await prueba(admin, 'admin celular · "Más" marcado en Usuarios', async () => {
    await irA(admin, '#usuarios');
    assert.equal(await admin.eval(`document.getElementById('nav-mas').classList.contains('active')`), true);
  });
  await prueba(admin, 'admin celular · lupa abre el buscador', async () => {
    await admin.eval(`document.querySelector('.topbar-buscar').click()`);
    await admin.quieta();
    assert.equal(await admin.eval(`document.getElementById('buscador').open`), true);
    await admin.tecla('Escape');
  });
  await admin.cerrar();

  // ---------- Comercial ----------
  const com = await chrome.nuevaPestana();
  await com.tamano(375, 812, true);
  await ingresar(com, 'comercial');
  await com.ir(`${servidor.url}/app.html#dashboard`);
  await prueba(com, 'comercial celular · barra inferior', async () => {
    assert.deepEqual(await barraInferior(com), ['Inicio', 'Sucursales', 'Cierre', 'Anual', 'Más']);
  });
  await prueba(com, 'comercial · no entra a pantallas de admin', async () => {
    await irA(com, '#ventas');
    assert.equal(await com.eval('location.hash'), '#dashboard');
    assert.equal(await visible(com, '#suc-admin-btn'), false);
  });
  await prueba(com, 'comercial supervisor · ve primero sus sucursales', async () => {
    await irA(com, '#dashboard');
    assert.match(await textoDe(com, '.rapido-lista'), /Tus \d+ sucursales/);
    await irA(com, '#sucursales/ranking');
    assert.equal(await com.eval(`document.getElementById('suc-supervisor')?.value`), 'Supervisor Dos');
  });
  await prueba(com, 'comercial · ve el objetivo anual pero no lo cambia', async () => {
    await irA(com, '#anual');
    assert.match(await textoDe(com, '.an-meta'), /Objetivo anual/);
    assert.equal(await com.eval(`!!document.getElementById('meta-crec')`), false);
  });
  for (const hash of ['#sucursales/resumen', '#sucursales/ranking', '#cierre', '#anual']) {
    await prueba(com, `comercial · ${hash}`, async () => {
      await irA(com, hash);
      assert.ok(await anchoSobra(com) <= 1, 'la página se sale de ancho');
    });
  }
  await com.cerrar();
} finally {
  await chrome.cerrar();
  await servidor.cerrar();
}

if (fallas.length) {
  console.error(`pantallas: ${fallas.length} de ${pruebas} pruebas fallaron\n  - ${fallas.join('\n  - ')}`);
  process.exit(1);
}
console.log(`pantallas: las ${pruebas} pruebas pasaron`);
process.exit(0);
