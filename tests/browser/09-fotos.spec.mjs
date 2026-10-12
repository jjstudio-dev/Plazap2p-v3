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
]
