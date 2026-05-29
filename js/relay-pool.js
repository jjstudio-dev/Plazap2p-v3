// relay-pool.js — WebSocket relay pool for Nostr (NIP-01)
// Manages connections, subscriptions, and automatic reconnect

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS  = 60000;

export class RelayPool {
  #relays = {};
  #subs = {};
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
      const ws = new WebSocket(url);
      this.#relays[url] = { ws, status: 'connecting', failCount };

      ws.onopen = () => {
        this.#relays[url].status = 'connected';
        this.#relays[url].failCount = 0;
        for (const [id, sub] of Object.entries(this.#subs)) {
          ws.send(JSON.stringify(['REQ', id, ...sub.filters]));
        }
        this.#onConnect?.(url);
      };

      ws.onmessage = ({ data }) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (!Array.isArray(msg)) return;
        const [type, subId, payload] = msg;
        if (type === 'EVENT' && payload) this.#subs[subId]?.onEvent?.(payload, url);
        else if (type === 'EOSE') this.#subs[subId]?.onEose?.(url);
        else if (type === 'NOTICE') console.warn(`[relay notice ${url}]`, msg[1]);
      };

      ws.onerror = () => ws.close();

      ws.onclose = () => {
        if (!this.#relays[url] || this.#closed) return;
        const fails = (this.#relays[url].failCount ?? 0) + 1;
        this.#relays[url].status = 'disconnected';
        this.#relays[url].failCount = fails;
        this.#onDisconnect?.(url);
        const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, fails - 1), RECONNECT_MAX_MS);
        setTimeout(() => { if (this.#relays[url] && !this.#closed) this.#connectOne(url); }, delay);
      };
    } catch (e) {
      console.error(`[relay] ${url}:`, e);
    }
  }

  subscribe(id, filters, { onEvent, onEose } = {}) {
    this.#subs[id] = { filters, onEvent, onEose };
    for (const { ws, status } of Object.values(this.#relays)) {
      if (status === 'connected') ws.send(JSON.stringify(['REQ', id, ...filters]));
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

  close() {
    this.#closed = true;
    for (const { ws } of Object.values(this.#relays)) { try { ws.close(); } catch {} }
    this.#relays = {};
    this.#subs = {};
  }
}
