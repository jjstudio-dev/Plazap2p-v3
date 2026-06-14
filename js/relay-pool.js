// relay-pool.js — WebSocket relay pool for Nostr (NIP-01)
// Manages connections, subscriptions, and automatic reconnect

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS  = 60000;

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
        if (type === 'EVENT' && payload) this.#subs[subId]?.onEvent?.(payload, url);
        else if (type === 'EOSE') this.#subs[subId]?.onEose?.(url);
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
    this.#subs[id] = { filters, onEvent, onEose };
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

  publish(event) {
    const msg = JSON.stringify(['EVENT', event]);
    for (const relay of Object.values(this.#relays)) {
      if (relay.status === 'connected') {
        try { relay.ws.send(msg); } catch {}
      }
    }
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

      this.#publishCallbacks.set(eventId, (url, accepted, message) => {
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
