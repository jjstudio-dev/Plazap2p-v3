// relay-pool.js — WebSocket relay pool for Nostr (NIP-01)
// Manages connections, subscriptions, and automatic reconnect
//
// SEC-001: ningún evento llega a un callback onEvent sin pasar por
// validateSignedEvent() (estructura + id recalculado + firma Schnorr) y sin
// encajar en los filtros de su suscripción. Un relay comprometido no puede
// inventar autores ni colar kinds inesperados.

import { verifyEvent } from './vendor/nostr-crypto.js';

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS  = 60000;
const MAX_STORED_EVENTS_PER_RELAY = 2000;   // por consulta y relay, antes de su EOSE
const MAX_FUTURE_DRIFT_S = 900;   // eventos >15 min en el futuro: rechazados

/**
 * Valida un evento recibido de un relay: estructura NIP-01, created_at no
 * futuro y verificación criptográfica (id recalculado + firma Schnorr).
 *
 * Sin caché propia por id A PROPÓSITO: una caché por id sería envenenable
 * (un relay malicioso podría reenviar un id "verificado" con contenido
 * alterado, o pre-rechazar el id de un evento legítimo). nostr-tools ya
 * cachea el veredicto POR OBJETO (Symbol interno), que es seguro. Coste:
 * ~1 ms/evento síncrono; con <100 eventos/carga no necesita worker — no
 * "optimizar" sin medir primero.
 *
 * @param {object} ev — payload EVENT crudo del relay
 * @returns {boolean}
 */
export function validateSignedEvent(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return false;
  if (typeof ev.id !== 'string' || !/^[0-9a-f]{64}$/.test(ev.id)) return false;

  const structureOk =
    typeof ev.sig === 'string' && /^[0-9a-f]{128}$/.test(ev.sig)
    && typeof ev.pubkey === 'string' && /^[0-9a-f]{64}$/.test(ev.pubkey)
    && Number.isInteger(ev.kind) && ev.kind >= 0 && ev.kind <= 65535
    && Number.isInteger(ev.created_at)
    && ev.created_at <= Math.floor(Date.now() / 1000) + MAX_FUTURE_DRIFT_S
    && typeof ev.content === 'string'
    && Array.isArray(ev.tags)
    && ev.tags.every(t => Array.isArray(t) && t.every(x => typeof x === 'string'));

  if (!structureOk) return false;
  try { return verifyEvent(ev) === true; } catch { return false; }
}

/**
 * Matching de filtros NIP-01: kinds, authors, ids, #etiquetas, since y until
 * cuando el filtro los declara. Basta con que UN filtro de la suscripción
 * encaje. Un relay defectuoso o malicioso puede devolver eventos reales y
 * bien firmados pero de otro tema: aquí se descartan, para que ningún
 * callback dependa de acordarse de volver a comprobarlo.
 */
export function matchesFilters(ev, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.some(f => {
    if (!f || typeof f !== 'object') return false;
    if (Array.isArray(f.kinds) && !f.kinds.includes(ev.kind)) return false;
    if (Array.isArray(f.authors) && !f.authors.includes(ev.pubkey)) return false;
    if (Array.isArray(f.ids) && !f.ids.includes(ev.id)) return false;
    if (Number.isInteger(f.since) && ev.created_at < f.since) return false;
    if (Number.isInteger(f.until) && ev.created_at > f.until) return false;
    for (const [key, values] of Object.entries(f)) {
      if (key[0] !== '#' || !Array.isArray(values)) continue;
      const name = key.slice(1);
      const tags = Array.isArray(ev.tags) ? ev.tags : [];
      if (!tags.some(t => t[0] === name && values.includes(t[1]))) return false;
    }
    return true;
  });
}

/**
 * Consulta puntual: entrega eventos a `onEvent` hasta que TODOS los relays
 * de los que cabe esperar respuesta han enviado EOSE, o vence el timeout.
 *
 * Terminar con el PRIMER EOSE (lo que hacían reputacion.js, zaps.js y
 * profile.js) da resultados falsos: el relay más rápido puede no tener el
 * dato — p.ej. un relay que solo guarda perfiles responde EOSE vacío a una
 * consulta de valoraciones antes que nadie.
 *
 * @returns {Promise<{complete:boolean, answered:number}>} complete=false si se
 *   cortó por timeout (el resultado puede ser parcial: no cachearlo como
 *   definitivo); answered = cuántos relays llegaron a contestar (0 = no se
 *   sabe nada: quien llama no debe tomar el vacío por una respuesta).
 */
export function collectUntilEose(pool, filters, { onEvent, timeoutMs = 6000, prefix = 'q' } = {}) {
  return new Promise(resolve => {
    const subId = `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
    const eoseFrom = new Set();
    let settled = false;
    let timer = null;
    let tick = null;

    const finish = (complete) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(tick);
      pool.unsubscribe(subId);
      resolve({ complete, answered: eoseFrom.size });
    };
    // Pools sin expectedCount (dobles de test mínimos): se espera un solo EOSE.
    const expected = () => Number.isInteger(pool.expectedCount) ? pool.expectedCount : 1;
    const check = () => { if (eoseFrom.size > 0 && eoseFrom.size >= expected()) finish(true); };

    timer = setTimeout(() => finish(false), timeoutMs);
    // Un relay que se cae a mitad de consulta reduce expectedCount sin emitir
    // nada: re-evaluar periódicamente evita esperar al timeout completo.
    tick = setInterval(check, 300);

    pool.subscribe(subId, filters, {
      onEvent: (ev, url) => { if (!settled) onEvent?.(ev, url); },
      onEose: (url) => { eoseFrom.add(url ?? `anon-${eoseFrom.size}`); check(); },
    });
  });
}

export class RelayPool {
  #relays = {};
  #subs = {};
  #publishCallbacks = new Map(); // eventId → (url, accepted, message) → void
  #closed = false;
  #onConnect;
  #onDisconnect;

  constructor(urls, { onConnect, onDisconnect } = {}) {
    this.urls = [...new Set(urls)];
    this.#onConnect = onConnect;
    this.#onDisconnect = onDisconnect;
  }

  connect() {
    this.#closed = false;
    for (const url of this.urls) this.#connectOne(url);
  }

  #connectOne(url) {
    if (this.#closed) return;
    if (this.#relays[url]?.ws?.readyState === WebSocket.CONNECTING) return;
    const failCount = this.#relays[url]?.failCount ?? 0;
    try {
      this.#relays[url]?.ws?.close(); // evitar WebSocket huérfano al reconectar
      const ws = new WebSocket(url);
      this.#relays[url] = { ws, status: 'connecting', failCount };

      ws.onopen = () => {
        if (this.#relays[url]?.ws !== ws) return;
        this.#relays[url].status = 'connected';
        this.#relays[url].failCount = 0;
        for (const [id, sub] of Object.entries(this.#subs)) {
          try { ws.send(JSON.stringify(['REQ', id, ...sub.filters])); } catch (e) { console.warn(`[relay] send REQ failed ${url}`, e); }
        }
        this.#onConnect?.(url);
      };

      ws.onmessage = ({ data }) => {
        if (this.#relays[url]?.ws !== ws) return;
        if (data.length > 1_000_000) return; // protección DoS — descartar mensajes >1 MB
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (!Array.isArray(msg)) return;
        const [type, subId, payload] = msg;
        if (type === 'EVENT' && payload) {
          const sub = this.#subs[subId];
          if (!sub) return;
          // Tope de lo almacenado que un relay puede volcar por consulta: cada
          // evento cuesta ~1 ms de comprobación de firma en el hilo de la
          // pantalla, y un relay hostil podía congelarla (VW1-07). Tras su
          // EOSE el contador ya no aplica: lo que llega es tiempo real.
          if (!sub.eoseFrom?.has(url)) {
            const seen = (sub.storedCount.get(url) || 0) + 1;
            sub.storedCount.set(url, seen);
            if (seen > MAX_STORED_EVENTS_PER_RELAY) {
              if (seen === MAX_STORED_EVENTS_PER_RELAY + 1) console.warn(`[relay] ${url} supera el tope de eventos de la consulta ${subId}; el resto se descarta`);
              return;
            }
          }
          // SEC-001: verificar antes de entregar; descartar lo que no encaje
          // en los filtros de la suscripción (relays que ignoran el REQ).
          if (!validateSignedEvent(payload)) {
            console.warn(`[relay] evento inválido descartado (${url})`, payload?.id ?? '(sin id)');
            return;
          }
          if (!matchesFilters(payload, sub.filters)) return;
          sub.onEvent?.(payload, url);
        }
        else if (type === 'EOSE') {
          this.#subs[subId]?.eoseFrom.add(url);
          this.#subs[subId]?.onEose?.(url);
        }
        // CLOSED: el relay rechaza la suscripción (auth-required, rate-limited…)
        // y no va a mandar EOSE. Para quien espera respuestas equivale a "este
        // relay ya ha contestado": sin esto, un solo relay que exija
        // autenticación hacía agotar el timeout completo en cada consulta.
        else if (type === 'CLOSED') {
          console.warn(`[relay] ${url} cerró la suscripción ${subId}:`, typeof payload === 'string' ? payload : '');
          this.#subs[subId]?.onEose?.(url);
        }
        else if (type === 'OK') {
          const [, eventId, accepted, message] = msg;
          this.#publishCallbacks.get(eventId)?.(url, !!accepted, message || '');
        }
        else if (type === 'NOTICE') console.warn(`[relay notice ${url}]`, msg[1]);
      };

      ws.onerror = () => { console.warn(`[relay] error en ${url}`); ws.close(); };

      ws.onclose = () => {
        if (this.#relays[url]?.ws !== ws || this.#closed) return;
        const fails = (this.#relays[url].failCount ?? 0) + 1;
        this.#relays[url].status = 'disconnected';
        this.#relays[url].failCount = fails;
        this.#onDisconnect?.(url);
        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, fails - 1), RECONNECT_MAX_MS);
        setTimeout(() => { if (this.#relays[url]?.ws === ws && !this.#closed) this.#connectOne(url); }, delay);
      };
    } catch (e) {
      console.error(`[relay] ${url}:`, e);
    }
  }

  subscribe(id, filters, { onEvent, onEose } = {}) {
    this.#subs[id] = { filters, onEvent, onEose, storedCount: new Map(), eoseFrom: new Set() };
    for (const { ws, status } of Object.values(this.#relays)) {
      if (status === 'connected') {
        try { ws.send(JSON.stringify(['REQ', id, ...filters])); } catch (e) { console.warn('[relay] subscribe send failed', e); }
      }
    }
  }

  unsubscribe(id) {
    if (!this.#subs[id]) return;
    for (const { ws, status } of Object.values(this.#relays)) {
      if (status === 'connected') {
        try { ws.send(JSON.stringify(['CLOSE', id])); } catch {}
      }
    }
    delete this.#subs[id];
  }

  get status() {
    return Object.entries(this.#relays).map(([url, r]) => ({ url, status: r.status }));
  }

  get connectedCount() {
    return Object.values(this.#relays).filter(r => r.status === 'connected').length;
  }

  /**
   * Relays de los que aún cabe esperar un EOSE: los conectados más los que
   * están en su PRIMER intento de conexión. Un relay caído (ya falló al menos
   * una vez) no cuenta — si no, un solo relay muerto obligaría a agotar el
   * timeout en cada consulta.
   */
  get expectedCount() {
    return Object.values(this.#relays)
      .filter(r => r.status === 'connected' || (r.status === 'connecting' && r.failCount === 0)).length;
  }

  /**
   * Envía sin esperar respuesta. Devuelve a cuántos relays se envió: con
   * cero conectados no se envía nada, y antes eso pasaba en silencio (VW1-05).
   */
  publish(event) {
    const msg = JSON.stringify(['EVENT', event]);
    let sent = 0;
    for (const relay of Object.values(this.#relays)) {
      if (relay.status === 'connected') {
        try { relay.ws.send(msg); sent++; } catch {}
      }
    }
    return sent;
  }

  publishWithFeedback(event, timeout = 6000) {
    const msg     = JSON.stringify(['EVENT', event]);
    const eventId = event.id;
    const connected = Object.entries(this.#relays)
      .filter(([, r]) => r.status === 'connected');

    if (connected.length === 0) return Promise.resolve([]);

    const results = [];
    let pending = connected.length;

    return new Promise((resolve) => {
      const finish = () => {
        this.#publishCallbacks.delete(eventId);
        resolve(results);
      };
      const timer = setTimeout(finish, timeout);

      const seen = new Set();   // un relay podría enviar OK duplicado
      this.#publishCallbacks.set(eventId, (url, accepted, message) => {
        if (seen.has(url)) return;
        seen.add(url);
        results.push({ url, accepted, message });
        if (--pending <= 0) { clearTimeout(timer); finish(); }
      });

      for (const [, relay] of connected) {
        try { relay.ws.send(msg); }
        catch { if (--pending <= 0) { clearTimeout(timer); finish(); } }
      }
    });
  }

  close() {
    this.#closed = true;
    for (const { ws } of Object.values(this.#relays)) { try { ws.close(); } catch {} }
    this.#relays = {};
    this.#subs = {};
  }
}
