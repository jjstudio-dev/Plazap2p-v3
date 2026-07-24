// notify.js — BON-011 (alcance MVP tras auditoría del plan)
//
// Sin backend propio no hay forma de despertar la app cuando está
// completamente cerrada (eso exigiría un servidor manteniendo
// suscripciones Push — justo lo que "sin servidor propio" prohíbe).
// Alcance elegido: Notification API directa, SOLO mientras la
// pestaña/PWA está abierta (aunque en segundo plano) — cero Service
// Worker, cero infraestructura Push real. No es "push" en sentido
// estricto, y la UI debe dejarlo dicho (igual que ya hace BON-002).
//
// Notification.requestPermission() solo puede dispararse desde un gesto
// directo del usuario (clic) — nunca desde un callback de red o timeout.

export function isSupported() {
  return typeof Notification !== 'undefined'
}

/** @returns {'granted'|'denied'|'default'|'unsupported'} */
export function permissionState() {
  return isSupported() ? Notification.permission : 'unsupported'
}

/** Debe llamarse desde un handler de click — el navegador ignora la
 * petición si no hay gesto de usuario reciente. */
export async function requestPermission() {
  if (!isSupported()) return 'unsupported'
  try { return await Notification.requestPermission() } catch { return 'denied' }
}

/** No lanza si no hay permiso o el entorno no soporta Notification. */
export function notify(title, options = {}) {
  if (permissionState() !== 'granted') return null
  try { return new Notification(title, options) } catch { return null }
}
