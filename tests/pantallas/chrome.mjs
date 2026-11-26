// Chrome sin ventana manejado por el protocolo de DevTools (WebSocket de Node), sin dependencias.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATOS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

export const buscarChrome = () => CANDIDATOS.find((p) => p && fs.existsSync(p)) || null;

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function abrirChrome(ejecutable) {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'pantallas-'));
  const proc = spawn(ejecutable, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  const archivoPuerto = path.join(perfil, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(archivoPuerto); i++) await esperar(100);
  if (!fs.existsSync(archivoPuerto)) { proc.kill(); throw new Error('Chrome no abrió el puerto de DevTools.'); }
  await esperar(100);
  const [puerto, ruta] = fs.readFileSync(archivoPuerto, 'utf8').trim().split(/\r?\n/);
  const ws = new WebSocket(`ws://127.0.0.1:${puerto}${ruta}`);
  await new Promise((ok, mal) => { ws.onopen = ok; ws.onerror = mal; });

  let id = 0;
  const pendientes = new Map();
  const oyentes = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendientes.has(m.id)) {
      const { ok, mal } = pendientes.get(m.id);
      pendientes.delete(m.id);
      if (m.error) mal(new Error(`${m.error.message}`)); else ok(m.result);
    } else if (m.method) oyentes.forEach((f) => f(m));
  };
  const enviar = (method, params = {}, sessionId) => new Promise((ok, mal) => {
    const n = ++id;
    pendientes.set(n, { ok, mal });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  // Una pestaña nueva en su propio perfil (cookies y almacenamiento aparte: cada usuario con su sesión).
  async function nuevaPestana() {
    const { browserContextId } = await enviar('Target.createBrowserContext');
    const { targetId } = await enviar('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });
    const cmd = (method, params) => enviar(method, params, sessionId);
    const errores = [];
    const enVuelo = new Map(); // requestId → url
    let ultimoCambio = Date.now();
    oyentes.add((m) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params;
      if (m.method === 'Runtime.exceptionThrown') errores.push(`Excepción: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') errores.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (m.method === 'Log.entryAdded' && p.entry.level === 'error') errores.push(`${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ''}`);
      // Solo cuentan los pedidos al portal (las fuentes de Google y similares no frenan las pruebas).
      if (m.method === 'Network.requestWillBeSent' && /^http:\/\/127\.0\.0\.1/.test(p.request.url)) { enVuelo.set(p.requestId, p.request.url); ultimoCambio = Date.now(); }
      if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') { if (enVuelo.delete(p.requestId)) ultimoCambio = Date.now(); }
    });
    await Promise.all(['Runtime.enable', 'Log.enable', 'Network.enable', 'Page.enable'].map((m) => cmd(m)));

    const pestana = {
      errores,
      cmd,
      // Espera a que no haya pedidos en curso durante un rato (o hasta el máximo).
      async quieta(ms = 350, max = 8000) {
        const inicio = Date.now();
        await esperar(60);
        while (Date.now() - inicio < max) {
          if (enVuelo.size === 0 && Date.now() - ultimoCambio >= ms) return;
          await esperar(40);
        }
        if (process.env.DETALLE) console.log(`    (sigue esperando: ${[...enVuelo.values()].join(', ')})`);
      },
      // Al cambiar de página, lo que quedó pendiente de la anterior ya no cuenta.
      async ir(url) { enVuelo.clear(); await cmd('Page.navigate', { url }); await pestana.quieta(); },
      async eval(expr) {
        const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(`Error evaluando: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        return r.result.value;
      },
      async tecla(key, { ctrl = false, code } = {}) {
        const base = { key, code: code || (key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key), modifiers: ctrl ? 2 : 0, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 }[key] };
        await cmd('Input.dispatchKeyEvent', { type: key.length === 1 && !ctrl ? 'keyDown' : 'rawKeyDown', ...base, ...(key.length === 1 && !ctrl ? { text: key } : {}) });
        await cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        await pestana.quieta(200);
      },
      async escribir(texto) { await cmd('Input.insertText', { text: texto }); await pestana.quieta(150); },
      async tamano(ancho, alto, movil = false) {
        await cmd('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil });
        await esperar(150);
      },
      cerrar: () => enviar('Target.closeTarget', { targetId }),
    };
    return pestana;
  }

  return {
    nuevaPestana,
    async cerrar() {
      try { await enviar('Browser.close'); } catch { /* ya cerrado */ }
      ws.close();
      await esperar(300);
      proc.kill();
      try { fs.rmSync(perfil, { recursive: true, force: true }); } catch { /* Windows a veces lo retiene */ }
    },
  };
}
