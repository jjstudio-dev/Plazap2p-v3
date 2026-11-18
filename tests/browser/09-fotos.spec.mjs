// Fotos: antes de subirla, la imagen se redibuja para que no lleve dentro el
// lugar, la fecha ni el modelo de teléfono (W3-02). Aquí se prueba con el
// lienzo real del navegador, que los tests de lógica no tienen.

export const tests = [
  {
    name: 'una foto con datos ocultos sale sin ellos y sigue siendo una imagen válida',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: {} })
      await page.goto(server.origin + '/publicar.html')
      const r = await page.evaluate(`(async () => {
        const { stripImageMetadata } = await import('/js/media-upload.js')
        const canvas = document.createElement('canvas')
        canvas.width = 8; canvas.height = 6
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f7931a'; ctx.fillRect(0, 0, 8, 6)
        const jpeg = new Uint8Array(await (await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9))).arrayBuffer())
        // Segmento APP1 (Exif) justo tras el inicio del JPEG, como lo deja una cámara.
        const payload = new TextEncoder().encode('Exif\0\0GPS-SECRETO-40.4168,-3.7038')
        const app1 = new Uint8Array([0xFF, 0xE1, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF, ...payload])
        const withExif = new File([jpeg.slice(0, 2), app1, jpeg.slice(2)], 'foto.jpg', { type: 'image/jpeg' })
        const has = async blob => new TextDecoder('latin1').decode(await blob.arrayBuffer()).includes('GPS-SECRETO')
        const clean = await stripImageMetadata(withExif)
        const bitmap = await createImageBitmap(clean)
        return { before: await has(withExif), after: await has(clean), type: clean.type, w: bitmap.width, h: bitmap.height }
      })()`)
      t.assert.equal(r.before, true, 'la foto de prueba lleva el dato')
      t.assert.equal(r.after, false, 'lo que se subiría no lo lleva')
      t.assert.deepEqual([r.type, r.w, r.h], ['image/jpeg', 8, 6])
    },
  },
  {
    name: 'una foto enorme se reduce a 1600 px y sale como JPEG ligero; un PNG transparente no sale negro',
    async run(t) {
      const server = await t.server()
      const page = await t.open({ scenario: {} })
      await page.goto(server.origin + '/publicar.html')
      const r = await page.evaluate(`(async () => {
        const { stripImageMetadata, MAX_OUTPUT_BYTES } = await import('/js/media-upload.js')
        const canvas = document.createElement('canvas')
        canvas.width = 4000; canvas.height = 3000
        const ctx = canvas.getContext('2d')
        for (let i = 0; i < 400; i++) { ctx.fillStyle = 'hsl(' + (i * 37 % 360) + ',80%,50%)'; ctx.fillRect((i * 97) % 4000, (i * 61) % 3000, 300, 200) }
        const png = new File([await new Promise(res => canvas.toBlob(res, 'image/png'))], 'grande.png', { type: 'image/png' })
        const out = await stripImageMetadata(png)
        const bm = await createImageBitmap(out)
        const tr = document.createElement('canvas'); tr.width = 10; tr.height = 10
        const tp = new File([await new Promise(res => tr.toBlob(res, 'image/png'))], 't.png', { type: 'image/png' })
        const tOut = await createImageBitmap(await stripImageMetadata(tp))
        const c2 = document.createElement('canvas'); c2.width = 10; c2.height = 10
        const x2 = c2.getContext('2d'); x2.drawImage(tOut, 0, 0)
        const px = [...x2.getImageData(5, 5, 1, 1).data]
        return { type: out.type, w: bm.width, h: bm.height, small: out.size <= MAX_OUTPUT_BYTES, px }
      })()`)
      t.assert.deepEqual([r.type, r.w, r.h, r.small], ['image/jpeg', 1600, 1200, true])
      t.assert.ok(r.px[0] > 240 && r.px[1] > 240 && r.px[2] > 240, 'fondo blanco, no negro: ' + r.px)
    },
  },
]
