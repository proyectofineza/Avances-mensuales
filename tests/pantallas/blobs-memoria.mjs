// Reemplazo de @netlify/blobs para las pruebas de pantallas: todo queda en memoria.
const mem = globalThis.__blobsPrueba || (globalThis.__blobsPrueba = new Map());

export function getStore() {
  return {
    async get(k, o) { const v = mem.get(k); return v === undefined ? null : (o?.type === 'json' ? JSON.parse(v) : v); },
    async setJSON(k, v) { mem.set(k, JSON.stringify(v)); },
    async set(k, v) { mem.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    async delete(k) { mem.delete(k); },
    async list(o) { return { blobs: [...mem.keys()].filter((key) => !o?.prefix || key.startsWith(o.prefix)).map((key) => ({ key })) }; },
  };
}
