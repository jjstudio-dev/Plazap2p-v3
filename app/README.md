# App Android — historia de esta carpeta

Esta carpeta es el registro de cómo llegamos a la idea de "una app" para PlazaP2P, antes de asentarse en la vía actual.

1. **Bot de Telegram V3** — la primera idea de "app"/asistente fuera del navegador. Diseño completo, pero nunca se desplegó en producción; se retiró del repositorio (ver README principal).
2. **Wrapper TWA** — instalar la web como si fuera una app, en pantalla completa y sin barra de navegador, mismo código y mismos datos que la PWA. Se llegó a preparar y firmar una build interna (huella SHA-256 abajo), pero **nunca se publicó en abierto ni se distribuyó**: en el propio proceso de diseño se decidió que, por usabilidad, merecía más la pena portar la idea a una app nativa de verdad.
3. **PlazaP2P Android** (vía activa) — app nativa, con su propia interfaz e integraciones (Amber, Wallet, Mensajería), en un proyecto aparte (código todavía privado). Es la que sustituye de verdad al bot y al wrapper TWA.

## Estado de PlazaP2P Android

El código fuente de la app nativa vive en un proyecto aparte, pero vinculado a las raíces de este mismo repositorio. Sus versiones se publican para descarga en esta misma carpeta.

| Versión | Archivo | SHA-256 |
|---|---|---|
| 1.0.2 (octubre de 2026) | [`PlazaP2P-3.1-Android-App-v1.0.2.apk`](PlazaP2P-3.1-Android-App-v1.0.2.apk) | `15523DF442AA3D5211220E66455DAEDE986C1F80931BF6BCD7230788009C8A2D` |

Es un APK de instalación directa (no está en Google Play). Antes de instalarlo, comprueba que la suma SHA-256 del archivo descargado coincide con la de la tabla (también en `PlazaP2P-3.1-Android-App-v1.0.2.apk.sha256`).

La 1.0.2 sustituye a la v1 (1.0.0, julio de 2026), que se retiró porque podía cerrarse sola tras una hora de uso. Las dos llevan la misma firma (`CN=PlazaP2P Upload`), así que la 1.0.2 se instala encima de la v1 sin perder los datos.

## Estado de build TWA

**Huella SHA-256** de la build TWA firmada que se llegó a preparar (referencia histórica, nunca distribuida):

```
D3:C0:95:56:C7:5D:C1:D9:C9:84:C9:5C:1F:54:8B:31:D8:F9:66:C3:AA:59:3A:BA:D8:B2:C7:31:E3:46:EF:76
```

El código fuente del wrapper TWA (Android/Gradle) vivía en un proyecto separado, no en este repositorio, y quedó abandonado a medio terminar en cuanto se decidió apostar por PlazaP2P Android.
