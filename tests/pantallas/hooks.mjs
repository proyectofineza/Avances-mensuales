// Hace que las funciones usen los Blobs en memoria en lugar de @netlify/blobs.
export async function resolve(spec, ctx, next) {
  if (spec === '@netlify/blobs') return { url: new URL('./blobs-memoria.mjs', import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
