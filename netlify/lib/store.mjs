// Acceso a Netlify Blobs (store "ventas") y gestión de usuarios.
import { getStore } from '@netlify/blobs';
import { hashPin } from './auth.mjs';

export function store() {
  return getStore({ name: 'ventas', consistency: 'strong' });
}

export async function getJSON(key, fallback = null) {
  const v = await store().get(key, { type: 'json' });
  return v ?? fallback;
}

export async function setJSON(key, value) {
  await store().setJSON(key, value);
}

export async function deleteKey(key) {
  await store().delete(key);
}

// Devuelve la lista de usuarios. Si está vacía, crea el primer admin
// desde las variables de entorno ADMIN_CI / ADMIN_PIN / ADMIN_NOMBRE.
export async function getUsers() {
  let users = await getJSON('users', []);
  if (users.length === 0) {
    const ci = String(process.env.ADMIN_CI || '').replace(/\D/g, '');
    const pin = String(process.env.ADMIN_PIN || '');
    if (ci && /^\d{4,6}$/.test(pin)) {
      const { hash, salt } = await hashPin(pin);
      users = [{
        ci,
        nombre: process.env.ADMIN_NOMBRE || 'Administrador',
        rol: 'admin',
        activo: true,
        pinHash: hash,
        pinSalt: salt,
        creado: new Date().toISOString(),
        intentosFallidos: 0,
        bloqueadoHasta: null,
      }];
      await setJSON('users', users);
    }
  }
  return users;
}

export async function saveUsers(users) {
  await setJSON('users', users);
}

export function publicUser(u) {
  return { ci: u.ci, nombre: u.nombre, rol: u.rol, activo: u.activo, creado: u.creado };
}
