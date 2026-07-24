# App Android

`PlazaP2P.apk` es la app Android — un wrapper TWA (Trusted Web Activity)
firmado que abre esta misma PWA en pantalla completa, sin barra de
navegador. Mismo código, mismos datos: no es una app aparte.

**Instalación:** descarga `PlazaP2P.apk` y ábrelo en tu teléfono (Android
te pedirá permitir "instalar apps de fuentes desconocidas" la primera vez —
es normal al instalar fuera de Google Play). Requiere Android 5.0+.

**Verificación de la firma** (huella SHA-256 del certificado, útil para
comprobar que el APK no se ha modificado):

```
D3:C0:95:56:C7:5D:C1:D9:C9:84:C9:5C:1F:54:8B:31:D8:F9:66:C3:AA:59:3A:BA:D8:B2:C7:31:E3:46:EF:76
```

El código fuente del wrapper Android (TWA/Gradle) vive en un proyecto
separado, no en este repositorio — solo se publica aquí el binario
compilado y firmado.
