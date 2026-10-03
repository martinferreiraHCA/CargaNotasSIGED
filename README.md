# 🎓 Asistente de SIGED

Extensión de Chrome/Edge para **importar y exportar notas en SIGED sin pasarlas una por una**.
Muestra un panel dentro de la propia página de SIGED que **detecta solo en qué pantalla estás** y
ofrece únicamente los botones que sirven ahí. Pensada para docentes: todo se hace con dos o tres clics.

![Version](https://img.shields.io/badge/version-3.4-blue)
![Chrome](https://img.shields.io/badge/Chrome-Compatible-brightgreen)
![Edge](https://img.shields.io/badge/Edge-Compatible-brightgreen)

## ✨ Qué hace en cada página de SIGED

| Página de SIGED | Qué ofrece el panel |
|-----------------|---------------------|
| **Libro del Profesor** (lista de alumnos del grupo) | 📥 Descargar la **plantilla del grupo** (Excel o CSV) con todos los alumnos y columnas *Nota* y *Comentario* para completar. |
| **Evaluaciones** (escritos, parciales, orales, etc.) | 📥 Exportar las notas ya cargadas · 📤 Importar notas desde un archivo. |
| **Pasaje de calificaciones boletín por libreta** (semestrales, reuniones) | 📥 Exportar notas y juicios · 📤 Importar notas y juicios desde un archivo. |
| **Orales, Escritos y O. Actividades** (detalle por alumno) | 📥 Descargar un Excel con **todas las notas y comentarios**, los **promedios por período** (notas por tipo, rendimiento e inasistencias) y un resumen por alumno. De un alumno o de todos los visibles. |
| **Cierre de promedios por alumno** | 🔄 **Recorre solo todos los alumnos** de la libreta (la página cambia de alumno sola) y al terminar avisa y descarga un Excel con los **juicios y rendimientos de todas las reuniones**, todos los alumnos en una misma hoja. También exporta el alumno visible. |
| Cualquier otra página | El panel queda minimizado (botón "🎓 Asistente de SIGED") y avisa que ahí no hay notas para cargar. |

El panel se puede minimizar, arrastrar y recuerda su posición. También se puede abrir desde el ícono de la extensión.

## 🔄 Flujos típicos

### 1. Pasar notas desde una planilla (sin tipear una por una)
1. Entrá al **Libro del Profesor**, elegí la libreta y hacé clic en **Descargar plantilla del grupo**.
2. Abrí el Excel, completá la columna **Nota** (y **Comentario** si querés). No cambies los nombres.
3. Entrá en SIGED a la **evaluación** (o al **boletín**) donde van esas notas.
4. **Importar notas desde archivo** → revisá la vista previa → **Cargar notas en la página**.
5. Hacé clic en **Guardar** en SIGED (el panel te lleva al botón; el guardado siempre lo hacés vos).

### 2. Copiar las notas de una evaluación a otra (por ejemplo de "Escritos" a "Parciales" o al boletín)
1. En la evaluación de origen: **Descargar notas de esta página**.
2. En la evaluación de destino (o en el pasaje al boletín): **Importar notas desde archivo** con ese mismo archivo.

### 3. Subir la exportación de calificaciones de CREA
1. En CREA exportá el libro de calificaciones (CSV con `Nombre, Apellido, Título de la tarea, Calificación`).
2. En la evaluación de SIGED: **Importar notas desde archivo**, elegí la tarea de CREA que querés cargar.

### 3b. Copiar una evaluación a otro apartado sin archivos (por ejemplo de Escritos a Parcial)
1. En **Orales, Escritos y O. Actividades** (con TODOS los alumnos a la vista) elegí la evaluación en **Copiar una evaluación a otro apartado** (se listan por tipo y fecha, por ejemplo "Escritos · 15/09/2026") y hacé clic en **Guardar en el asistente**. También podés hacerlo desde la propia página de **Evaluaciones** con el enlace "Guardar estas notas en el asistente".
2. Entrá en SIGED a la evaluación de destino (por ejemplo Parcial): el panel muestra la tarjeta **Notas guardadas en el asistente** con la evaluación, la cantidad de alumnos y hace cuánto se guardó.
3. **Cargar estas notas acá** abre la misma vista previa que una importación: revisás y confirmás. Las notas y comentarios guardados se conservan en el navegador hasta 30 días o hasta que elijas "Ya no las necesito".

> Se guarda una sola evaluación a la vez para que sea simple. Si preferís un archivo, cada evaluación también se puede descargar en Excel desde el mismo lugar.

### 4. Exportar todas las notas de la libreta con promedios (Orales, Escritos y O. Actividades)
1. Entrá en SIGED a **Orales, Escritos y O. Actividades**. Si solo ves un alumno, hacé clic en **TODOS** (el panel tiene un botón que lo hace por vos) y en **Mostrar detalle (todos)**.
2. Elegí en el panel si querés el Excel de **todos los alumnos visibles** o de **un alumno**, y hacé clic en **Descargar Excel**.
3. El archivo tiene tres hojas con el mismo formato para cada alumno:
   - **Notas:** una fila por evaluación con período, fecha, tipo, nota, comentario y quién la registró.
   - **Promedios:** una fila por alumno y período con las notas por tipo (Orales, Escritas, O. Act), el **Rendimiento (R)** y las inasistencias (justificadas, no justificadas, fictas).
   - **Resumen:** una fila por alumno con documento, curso, antecedentes, calificaciones semestrales y el rendimiento de cada período.

> Los **juicios de las reuniones** no aparecen en esa página de SIGED. Para tenerlos todos juntos usá el flujo 5 (Cierre de promedios por alumno).

### 5. Exportar los juicios y notas históricas de todos los alumnos (Cierre de promedios por alumno)
1. Entrá en SIGED a **Cierre de promedios por alumno** y elegí la libreta (se muestra un alumno por vez).
2. En el panel hacé clic en **Recorrer los N alumnos y exportar todo**. La extensión pasa alumno por alumno usando los números de lista de SIGED; la página se recarga en cada paso y el panel muestra el avance. No uses la pestaña hasta que termine.
3. Al terminar, el panel avisa y el Excel se descarga solo. Si querés cortar antes, **Detener y descargar lo leído** genera el archivo con lo que ya se recorrió.
4. El Excel tiene, además de Notas, Promedios y Resumen, dos hojas de juicios:
   - **Juicios:** un alumno por fila; para cada reunión, el **rendimiento** y el **juicio de asignatura** (y el juicio de reunión si existe). Ideal para ver todos los juicios viejos juntos.
   - **Juicios (lista):** una fila por alumno y reunión con rendimiento, calidad, fecha y juicios.

> El avance del recorrido se guarda en la pestaña (sessionStorage), así sobrevive a cada recarga. Si pasó más de una hora o abriste otra página, se descarta.

## 🧾 Archivos que entiende

- **Excel** (`.xlsx`, `.xls`, `.ods`) y **CSV** (`;` o `,`, con cualquier codificación que use Excel).
- Columnas reconocidas (no importa mayúsculas ni tildes):
  - Estudiante: `Estudiante`, `Alumno`, `Nombre completo` … o bien `Apellido` + `Nombre` por separado.
  - Nota: `Nota`, `Calificación`, `Rend.` …
  - Comentario: `Comentario`, `Juicio`, `Observaciones` …
  - Opcionales: `Fecha`, `Conducta`, y `Título de la tarea` / `Evaluación` para elegir qué columna cargar.
- Formatos de versiones anteriores (`Equipos v1` y `Equipos v2`, con nota individual / por equipo).
- Las notas con decimales se redondean (7,5 → 8) y se ajustan a la escala que permita la página (1 a 10, 1 a 12, etc.).
- En evaluaciones de tipo Semáforo, la columna Nota acepta `Verde`, `Amarillo`, `Rojo` (o `V`, `A`, `R`).

## 🎯 Matching inteligente de nombres
- Tolera tildes, mayúsculas, comas y errores de tipeo ("AREBALO" ↔ "AREVALO").
- Tolera nombres parciales: "AMBROSIO María" (del Libro del Profesor) ↔ "AMBROSIO CALVIÑO María José" (del boletín).
- Cada entrada del archivo se asigna a **un solo** alumno (prioriza las coincidencias más altas).
- En la vista previa podés **corregir a mano** cualquier asignación antes de cargar, y se avisa de los alumnos sin nota y de las entradas del archivo que no corresponden a nadie.

## 🚀 Instalación rápida

1. Descargá o cloná este repositorio.
2. Abrí `chrome://extensions` (o `edge://extensions`), activá **Modo de desarrollador**.
3. **Cargar extensión sin empaquetar** → elegí la carpeta `CargaNotasSIGED`.
4. Recargá la página de SIGED (F5): el panel **Asistente de SIGED** aparece abajo a la derecha (se puede minimizar y arrastrar).

> Instrucciones detalladas de instalación y distribución en [INSTALACION.md](./INSTALACION.md).
> Para publicar en la Chrome Web Store: subí el ZIP de `dist/` (o generalo con `./empaquetar.sh`) y usá las imágenes de `store/`.

## 🛡️ Seguridad y privacidad
- Todo ocurre en tu navegador: los archivos no se suben a ningún servidor.
- La extensión **nunca guarda por vos**: solo completa los campos y te lleva al botón *Guardar* de SIGED para que revises.
- Solo se activa en dominios de SIGED (`*.siged.com.uy`, `*.siged.com`, `*.siged.edu.uy`).

## 📁 Estructura del proyecto

```
CargaNotasSIGED/
├── manifest.json          # Configuración de la extensión (Manifest V3)
├── content.js             # Panel en la página: detección de página, importar/exportar, carga de notas
├── shared/
│   ├── matching.js        # Comparación de nombres (Levenshtein, tokens, asignación única)
│   ├── formatos.js        # Lectura/escritura de Excel y CSV, detección de columnas y formatos
│   └── detalle.js         # Lectura de "Orales, Escritos y O. Act." y "Cierre de promedios por alumno"; Excel con juicios y promedios
├── lib/xlsx.full.min.js   # SheetJS (Apache-2.0) para leer y generar archivos Excel
├── popup.html / popup.js  # Ventana del ícono: muestra dónde estás y abre el panel
├── icon16.png, icon48.png, icon128.png
├── README.md
└── INSTALACION.md
```

## 🔧 Cómo se detecta cada página
La detección se hace por el contenido, no por la URL:
- **Boletín:** existe el campo `vCALIFXREUCALIFCOD_0001` (nota) y `vCALIFXREUJUICIO_0001` (juicio).
- **Evaluaciones (Calificaciones Libreta):** existe el campo `vCALIFCOD_0001` (nota) y `vLIBDCOMENTARIO_0001` (comentario). El panel muestra el tipo de evaluación (Escritos, Parcial, Orales…), su fecha y la reunión a la que está asignada. Si la evaluación es de tipo **Semáforo**, acepta Verde / Amarillo / Rojo en la columna Nota.
- **Libro del Profesor:** existe el selector de libreta `vLIBIDSELEC` y las tarjetas de alumnos.
- **Cierre de promedios por alumno:** existen `GridjuiciosContainerTbl`, `TXTAPELLIDO` y la botonera `TXTALUMNOS`. Se leen las filas de "Calificaciones y juicios" (`span_CTLREUDSC1_XXXX`, `vCALIFXREUCALIFCOD_XXXX`, `vCALIFXREUJUICIO_XXXX`, `span_CTLJFALXREUJUICIO_XXXX`) y lo mismo que en la página de detalle.
- **Orales, Escritos y O. Actividades:** existen `TXTNROLISTA_0001` y `TXTAPELLIDO_0001`. Se leen las tablas por período (`beTableLibretaEval`), las semestrales (`TXTCALIFICACION_XXXX`) y la grilla de detalle (`span_vLIBDFEC_RRRRXXXX`, `span_vTDLIBDSCPAN_…`, `span_vCALIFICACION_…`, `span_vLIBDCOMENTARIOGRID_…`). El período de cada evaluación se deduce del orden en que SIGED la muestra en el resumen y, si no coincide, de los meses del nombre del período.
- Los nombres de los alumnos se leen de `span_vFALUNOMCOM_XXXX`. Si SIGED recarga la grilla (por ejemplo al cambiar de libreta), el panel se actualiza solo.

## 🐛 Reportar problemas
1. Abrí un [Issue](https://github.com/martinferreiraHCA/CargaNotasSIGED/issues).
2. Contá en qué página de SIGED estabas y qué archivo usaste (sin datos de alumnos).
3. Si podés, agregá una captura del panel y los mensajes de la consola (F12).

## 📝 Changelog

### v3.4
- ✨ **Copiar una evaluación a otro apartado sin archivos:** desde el detalle por alumno (o desde Evaluaciones) se guarda una evaluación en el asistente y la página de destino ofrece cargarla con un clic.

### v3.3
- 🎨 El panel pasa a llamarse **Asistente de SIGED** y aparece abajo a la derecha.

### v3.2
- ✨ **Cierre de promedios por alumno:** recorrido automático de todos los alumnos y Excel con los juicios y rendimientos de todas las reuniones (todos los alumnos en una hoja), más notas, promedios y resumen.

### v3.1
- ✨ Exportación de la página **Orales, Escritos y O. Actividades**: Excel con todas las evaluaciones y comentarios, promedios por período (notas por tipo, rendimiento, inasistencias) y resumen por alumno. De un alumno o de todos.

### v3.0
- ✨ Panel flotante dentro de SIGED que detecta automáticamente la página (Libro del Profesor, Evaluaciones, Boletín).
- ✨ **Exportar** notas (y juicios) desde Evaluaciones y Boletín a Excel/CSV.
- ✨ **Importar** notas y juicios en el **Pasaje de calificaciones boletín por libreta**.
- ✨ **Plantilla del grupo** descargable desde el Libro del Profesor.
- ✨ Soporte de archivos **Excel** (`.xlsx`) además de CSV; detección flexible de columnas.
- ✨ Vista previa con corrección manual de asignaciones antes de cargar.
- ✨ Asignación única alumno ↔ entrada del archivo.
- ♻️ Popup convertido en lanzador; la lógica de matching y formatos pasó a `shared/`.

### v2.2
- Detección automática de páginas compatibles, soporte multi-dominio, mejoras de mensajes.

### v2.0 - v2.1
- Fuzzy matching con Levenshtein, matching bidireccional para nombres parciales, sugerencias para alumnos sin match.

## 📄 Licencia
MIT. Incluye [SheetJS Community Edition](https://sheetjs.com) bajo licencia Apache-2.0.
