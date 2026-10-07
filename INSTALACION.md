# 🚀 Guía de Instalación - Asistente de SIGED

## Opción 1: Instalación Local (Modo Desarrollador)

### Paso 1: Preparar los Archivos
1. Descarga o clona este repositorio
2. Asegúrate de tener todos los archivos y carpetas:
   - `manifest.json`
   - `content.js`
   - `shared/matching.js`, `shared/formatos.js`, `shared/detalle.js` y `shared/corrector.js`
   - `lib/xlsx.full.min.js`
   - `popup.js` y `popup.html`
   - `icon16.png`, `icon48.png`, `icon128.png`

### Paso 2: Instalar en Chrome/Edge

1. **Abre Chrome** (o cualquier navegador basado en Chromium: Edge, Brave, Opera)

2. **Ve a la página de extensiones:**
   - Chrome: Escribe en la barra de direcciones: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Opera: `opera://extensions`

3. **Activa el "Modo de desarrollador"**
   - Busca el switch en la esquina superior derecha
   - Actívalo (debe ponerse azul)

4. **Carga la extensión:**
   - Clic en el botón **"Cargar extensión sin empaquetar"** o **"Load unpacked"**
   - Selecciona la carpeta `CargaNotasSIGED` (la carpeta que contiene `manifest.json`)
   - Clic en **"Seleccionar carpeta"**

5. **¡Listo!** La extensión aparecerá en tu lista de extensiones

### Paso 3: Fijar la Extensión (Recomendado)

1. Busca el ícono de puzzle 🧩 en la barra de herramientas (junto a la barra de direcciones)
2. Encuentra "Asistente de SIGED"
3. Haz clic en el ícono de pin 📌 para fijarla a la barra

### Paso 4: Usar la Extensión

1. Entra a SIGED y recarga la página (F5) si ya la tenías abierta.
2. Abajo a la derecha aparece el panel **🎓 Asistente de SIGED** (si está minimizado, haz clic en el botón).
3. El panel reconoce solo la página:
   - **Libro del Profesor:** botón para descargar la plantilla del grupo.
   - **Evaluaciones** y **Pasaje de calificaciones boletín:** botones para exportar e importar notas.
   - **Orales, Escritos y O. Actividades:** botón para descargar el Excel con notas, comentarios y promedios por período.
   - **Cierre de promedios por alumno:** selector para ver la ficha del alumno (notas por materia) o recorrer todos los alumnos y descargar el Excel con los juicios de todas las reuniones.
   - **Corrector por curso:** mini ficha del alumno con foto, promedio, bajas, faltas y materias que subieron o bajaron.
4. Al importar, revisa la vista previa, haz clic en **Cargar notas en la página** y luego en **Guardar** en SIGED.

También puedes hacer clic en el ícono de la extensión: muestra dónde estás y abre el panel.

---

## Opción 2: Empaquetar para Distribución Interna

Si quieres compartir la extensión con otros usuarios de tu institución:

### Paso 1: Empaquetar la Extensión

1. Ve a `chrome://extensions`
2. Activa "Modo de desarrollador"
3. Clic en **"Empaquetar extensión"** o **"Pack extension"**
4. En "Directorio raíz de la extensión": selecciona la carpeta `CargaNotasSIGED`
5. Deja "Archivo de clave privada" en blanco (primera vez)
6. Clic en **"Empaquetar extensión"**

Esto generará dos archivos:
- `CargaNotasSIGED.crx` - El paquete de la extensión
- `CargaNotasSIGED.pem` - La clave privada (¡GUÁRDALA EN LUGAR SEGURO!)

### Paso 2: Distribuir el Archivo .crx

Comparte el archivo `.crx` con tus colegas. Ellos pueden:
1. Arrastrar el archivo `.crx` a `chrome://extensions`
2. Confirmar la instalación

**Nota:** Chrome puede mostrar advertencias para extensiones no publicadas en la Web Store.

---

## Opción 3: Publicar en Chrome Web Store (Distribución Pública)

Para publicar la extensión oficialmente:

### Requisitos:
- Cuenta de desarrollador de Chrome ($5 USD pago único)
- Íconos y capturas de pantalla
- Descripción detallada
- Política de privacidad (si aplica)

### Pasos:

1. **Registrarte como Desarrollador:**
   - Ve a: https://chrome.google.com/webstore/devconsole
   - Paga la tarifa de registro ($5 USD)

2. **Preparar Materiales:**
   - Capturas de pantalla (1280x800 o 640x400)
   - Descripción detallada (en español e inglés)
   - Categoría: "Productividad"
   - Íconos de buena calidad

3. **Crear el Paquete ZIP:**
   - Usá el ZIP ya armado que está en la carpeta `dist/` del repositorio (`asistente-de-siged-<versión>.zip`), o generalo con:
   ```bash
   ./empaquetar.sh
   ```
   - El ZIP debe tener `manifest.json` en la raíz. **No sirve el ZIP que descarga GitHub** ("Code → Download ZIP"), porque mete todo dentro de una carpeta y además incluye documentación e imágenes que no van en la extensión.
   - Las imágenes de la ficha (ícono de tienda, capturas y mosaicos) están en `store/`.

4. **Subir a Chrome Web Store:**
   - Ve al Developer Dashboard
   - Clic en "Nuevo elemento"
   - Sube el archivo ZIP
   - Completa todos los campos requeridos
   - Enviar para revisión

5. **Esperar Aprobación:**
   - Google revisa la extensión (1-3 días generalmente)
   - Una vez aprobada, estará disponible públicamente

---

## Opción 4: Enterprise/Educación (Google Workspace)

Para instituciones educativas con Google Workspace:

1. **Distribución mediante Política de Grupo:**
   - Admin Console → Devices → Chrome → Apps & Extensions
   - Agregar la extensión por ID
   - Aplicar a toda la organización o unidades específicas

2. **Instalación Forzada:**
   - Los usuarios la recibirán automáticamente
   - No pueden desinstalarla

---

## 🔄 Actualizar la Extensión

### Si instalaste localmente:
1. Haz los cambios en los archivos
2. Ve a `chrome://extensions`
3. Clic en el botón de "Recargar" 🔄 de la extensión

### Si distribuiste el .crx:
1. Empaqueta nuevamente usando la **misma clave .pem**
2. Distribuye el nuevo `.crx`
3. Los usuarios deben instalarlo sobre la versión anterior

### Si publicaste en Chrome Web Store:
1. Sube una nueva versión con número actualizado en `manifest.json`
2. Los usuarios recibirán la actualización automáticamente

---

## ⚠️ Notas Importantes

### Modo Desarrollador:
- ✅ Perfecto para uso personal y testing
- ⚠️ Chrome mostrará advertencias al inicio
- ⚠️ La extensión puede desactivarse si Chrome se cierra inesperadamente

### Archivo .crx:
- ✅ Fácil de distribuir internamente
- ⚠️ Chrome puede bloquear instalación (desde 2019)
- ⚠️ Edge y otros navegadores son más permisivos

### Chrome Web Store:
- ✅ Distribución oficial y confiable
- ✅ Actualizaciones automáticas
- ✅ Sin advertencias de seguridad
- ❌ Requiere pago de $5 USD
- ❌ Proceso de revisión de Google

---

## 🆘 Solución de Problemas

### "Las extensiones sin empaquetar no se pueden instalar"
- Verifica que el "Modo de desarrollador" esté activado
- Asegúrate de seleccionar la carpeta correcta (la que contiene `manifest.json`)

### "Manifest file is missing or unreadable"
- Verifica que el archivo `manifest.json` esté en la raíz de la carpeta
- Verifica que el JSON sea válido (sin errores de sintaxis)

### "Could not load icon"
- Asegúrate de que los archivos de íconos existan
- Verifica los nombres: `icon16.png`, `icon48.png`, `icon128.png`

### La extensión no funciona en SIGED
- Recarga la página de SIGED (F5) después de instalar o actualizar la extensión
- Abre la consola (F12) para ver errores
- Verifica que estés en una página compatible de SIGED (Evaluaciones, Pasaje de calificaciones boletín o Libro del Profesor)
- Revisa que los elementos HTML tengan los IDs correctos

### No aparece el panel
- Puede estar minimizado: busca el botón "🎓 Asistente de SIGED" abajo a la derecha
- Si lo arrastraste fuera de la pantalla, abre el ícono de la extensión y usa "Mostrar el panel en la página"

### El archivo Excel no se lee
- Deja los nombres de los alumnos en una columna llamada "Estudiante" (o "Apellido" y "Nombre") y las notas en "Nota"
- Si el archivo tiene varias hojas, la extensión usa la hoja "Notas" o la primera
- Como alternativa, guarda el archivo como CSV desde Excel

---

## 📞 Soporte

Si tienes problemas:
1. Revisa la consola del navegador (F12) para errores
2. Verifica que todos los archivos estén presentes
3. Asegúrate de tener la última versión de Chrome/Edge
4. Consulta la documentación de SIGED de tu institución

---

**Versión:** 2.2
**Última actualización:** 2024
