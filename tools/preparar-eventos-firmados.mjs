// Prepara los eventos kind 30078 (NIP-78) SIN FIRMAR con el contenido de data/.
// Uso: node tools/preparar-eventos-firmados.mjs [--desde-github] > eventos-sin-firmar.json
// Luego se firman con la clave del mantenedor (Amber, nak...) — ver tools/publicar-config.md.
//
// La app y la web comparan el contenido firmado byte a byte con el archivo tal como lo sirve
// GitHub (incluidos los finales de línea). --desde-github lo descarga de ahí, que es lo seguro:
// subir primero los cambios y después preparar los eventos.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW_BASE = 'https://raw.githubusercontent.com/jjstudio-dev/Plazap2p-v3/main/'
const MAINTAINER = 'e67420a604251e691eeb5584879b67ae4fe475749b9d25b8edf29d8b95cfbd46'
const FILES = {
  'plazap2p-config': 'data/config.json',
  'plazap2p-comunidades': 'data/comunidades.json',
  'plazap2p-herramientas': 'data/herramientas.json',
  'plazap2p-multimedia': 'data/multimedia.json',
}
const fromGithub = process.argv.includes('--desde-github')

async function read(file) {
  if (!fromGithub) return readFileSync(path.join(ROOT, file), 'utf8')
  const res = await fetch(RAW_BASE + file, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  return await res.text()
}

const now = Math.floor(Date.now() / 1000)
const events = []
for (const [d, file] of Object.entries(FILES)) {
  const content = await read(file)
  JSON.parse(content) // falla aquí si el JSON no es válido
  if (!fromGithub) {
    process.stderr.write(`aviso: ${file} leído del disco; firmar solo si es idéntico al de GitHub\n`)
  }
  events.push({ pubkey: MAINTAINER, created_at: now, kind: 30078, tags: [['d', d]], content })
}
process.stdout.write(JSON.stringify(events, null, 2) + '\n')
