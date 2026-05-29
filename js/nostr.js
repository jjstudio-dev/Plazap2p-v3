// nostr.js — minimal Nostr protocol utilities (NIP-19 bech32, NIP-99 tag helpers)
// Pure vanilla JS, zero dependencies

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHAR_MAP = Object.fromEntries([...CHARSET].map((c, i) => [c, i]));
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const td = new TextDecoder();
const te = new TextEncoder();

function polymod(values) {
  let c = 1;
  for (const v of values) {
    const c0 = c >>> 25;
    c = ((c & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((c0 >> i) & 1) c ^= GEN[i];
  }
  return c;
}

function hrpExpand(hrp) {
  const r = [];
  for (const ch of hrp) r.push(ch.charCodeAt(0) >> 5);
  r.push(0);
  for (const ch of hrp) r.push(ch.charCodeAt(0) & 31);
  return r;
}

function verifyChecksum(hrp, data) {
  return polymod([...hrpExpand(hrp), ...data]) === 1;
}

function createChecksum(hrp, data) {
  const pm = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  return Array.from({ length: 6 }, (_, i) => (pm >> (5 * (5 - i))) & 31);
}

function convertBits(data, from, to, pad = true) {
  let acc = 0, bits = 0;
  const ret = [], maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; ret.push((acc >> bits) & maxv); }
  }
  if (pad && bits > 0) ret.push((acc << (to - bits)) & maxv);
  return ret;
}

function bech32Decode(str) {
  const s = str.toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1) return null;
  const hrp = s.slice(0, pos);
  const data = [];
  for (let i = pos + 1; i < s.length; i++) {
    const d = CHAR_MAP[s[i]];
    if (d === undefined) return null;
    data.push(d);
  }
  if (!verifyChecksum(hrp, data)) return null;
  return { hrp, data: data.slice(0, -6) };
}

function bech32Encode(hrp, data) {
  const combined = [...data, ...createChecksum(hrp, data)];
  return hrp + '1' + combined.map(d => CHARSET[d]).join('');
}

function parseTLV(bytes) {
  const r = {};
  let i = 0;
  while (i + 1 < bytes.length) {
    const type = bytes[i++], len = bytes[i++];
    if (i + len > bytes.length) break;
    if (!r[type]) r[type] = [];
    r[type].push(bytes.slice(i, i + len));
    i += len;
  }
  return r;
}

export function decodeNaddr(naddr) {
  const decoded = bech32Decode(naddr);
  if (!decoded || decoded.hrp !== 'naddr') throw new Error('Not an naddr');
  const bytes = convertBits(decoded.data, 5, 8, false);
  const tlv = parseTLV(bytes);
  return {
    identifier: tlv[0]?.[0] ? td.decode(new Uint8Array(tlv[0][0])) : '',
    pubkey: tlv[2]?.[0] ? Array.from(tlv[2][0]).map(b => b.toString(16).padStart(2, '0')).join('') : '',
    kind: tlv[3]?.[0] ? (tlv[3][0][0] << 24 | tlv[3][0][1] << 16 | tlv[3][0][2] << 8 | tlv[3][0][3]) : 0,
    relays: (tlv[1] || []).map(r => td.decode(new Uint8Array(r)))
  };
}

export function encodeNaddr({ kind, pubkey, identifier, relays = [] }) {
  const tlv = [];
  const idBytes = te.encode(identifier);
  tlv.push(0, idBytes.length, ...idBytes);
  const pkBytes = pubkey.match(/.{2}/g).map(b => parseInt(b, 16));
  tlv.push(2, 32, ...pkBytes);
  tlv.push(3, 4, (kind >>> 24) & 0xff, (kind >>> 16) & 0xff, (kind >>> 8) & 0xff, kind & 0xff);
  for (const r of relays) {
    const rb = te.encode(r);
    tlv.push(1, rb.length, ...rb);
  }
  return bech32Encode('naddr', convertBits(tlv, 8, 5));
}

export function hexToNpub(hex) {
  const bytes = hex.match(/.{2}/g).map(b => parseInt(b, 16));
  return bech32Encode('npub', convertBits(bytes, 8, 5));
}

export function hexToNote(hex) {
  const bytes = hex.match(/.{2}/g).map(b => parseInt(b, 16));
  return bech32Encode('note', convertBits(bytes, 8, 5));
}

export function decodeNpub(npub) {
  const decoded = bech32Decode(npub);
  if (!decoded || decoded.hrp !== 'npub') throw new Error('Not an npub');
  const bytes = convertBits(decoded.data, 5, 8, false);
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function decodeNote(note) {
  const decoded = bech32Decode(note);
  if (!decoded || decoded.hrp !== 'note') throw new Error('Not a note');
  const bytes = convertBits(decoded.data, 5, 8, false);
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getTagValue(tags, name) {
  return tags.find(t => t[0] === name)?.[1] ?? null;
}

export function getTagValues(tags, name) {
  return tags.filter(t => t[0] === name).map(t => t[1]);
}
