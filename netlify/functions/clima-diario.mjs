// Tarea programada: renueva el pronóstico y el historial de clima dos veces por día,
// aunque nadie abra el portal. 02:00 y 14:00 UTC = 23:00 y 11:00 en Asunción: la de la
// noche deja guardado el pronóstico del día siguiente con menos de 24 h de anticipación.
import { getJSON, setJSON } from '../lib/store.mjs';
import { renovarClima } from '../lib/clima.mjs';

export default async () => {
  try {
    const clima = await renovarClima({ getJSON, setJSON });
    console.log('Clima renovado', clima.actualizado, `${clima.dias.length} días`);
  } catch (err) {
    console.error('No se pudo renovar el clima', err);
  }
};

export const config = { schedule: '0 2,14 * * *' };
