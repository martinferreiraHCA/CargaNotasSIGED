# Ficha de la Chrome Web Store — Asistente de SIGED

Texto listo para pegar en el Developer Dashboard (pestañas **Ficha de Play Store / Store listing**, **Privacidad** y **Distribución**).

## Detalles del producto

**Título del paquete:** Asistente de SIGED

**Resumen del paquete (máx. 132):**
Cargá notas en SIGED desde Excel, armá grupos con las fotos de tus alumnos y exportá juicios y promedios. Detecta sola la página.

**Descripción:**

```
Cargá notas en SIGED sin pasarlas una por una y armá grupos con las fotos de tus alumnos

Asistente de SIGED es una extensión pensada para docentes que trabajan con el sistema SIGED (Sistema de Gestión Educativa). Agrega un panel dentro de las propias páginas de SIGED que reconoce solo en qué pantalla estás y te ofrece únicamente los botones que sirven ahí. Todo se hace con dos o tres clics y siempre con una vista previa antes de confirmar.

QUÉ HACE EN CADA PÁGINA DE SIGED

• Libro del Profesor: armá grupos de trabajo con un clic. Se abre una página con la ficha y la foto de cada alumno: repartilos al azar o en orden de lista (en N grupos o en grupos de N), tocá o arrastrá las fichas para acomodarlos, ponele nombre a la actividad y nota a cada grupo (con nota distinta para algún integrante si hace falta). Las notas se mandan al asistente y se cargan en la evaluación de SIGED que elijas, sin planillas. Los grupos quedan guardados por actividad en tu navegador para retomarlos, duplicarlos, imprimirlos con las fotos o bajarlos en Excel. También podés descargar la plantilla del grupo en Excel para completarla con las notas.

• Evaluaciones (orales, escritos, parciales, etc.): importá notas y comentarios desde Excel o CSV, o exportá las que ya están cargadas. Funciona también con evaluaciones tipo Semáforo.

• Pasaje de calificaciones boletín por libreta: importá y exportá notas y juicios de la reunión.

• Orales, Escritos y O. Actividades: exportá todas las evaluaciones con comentarios, los promedios por período (notas por tipo, rendimiento e inasistencias) y un resumen por alumno. También podés elegir una evaluación puntual y guardarla en el asistente para cargarla en otro apartado (por ejemplo de Escritos a Parcial) sin descargar ningún archivo.

• Cierre de promedios por alumno: ficha del alumno con foto, promedio, bajas, faltas y materias que subieron o bajaron respecto del período anterior. O recorre solo todos los alumnos de la libreta y, al terminar, descarga un Excel con los juicios y rendimientos de todas las reuniones, con todos los alumnos en una misma hoja.

• Corrector por curso: mini ficha de cada alumno al corregir o visar boletines (foto, promedio general, bajas y en qué materias, faltas justificadas, injustificadas y fictas, y qué materias subieron o bajaron). Se actualiza sola al cambiar de alumno.

CÓMO FUNCIONA LA IMPORTACIÓN

1. Entrá en SIGED a la evaluación o al boletín donde van las notas.
2. En el panel, elegí "Importar notas desde archivo" (Excel o CSV) o usá las notas guardadas en el asistente.
3. Revisá la vista previa: cada alumno de SIGED aparece con la nota que va a recibir. Podés corregir cualquier asignación a mano.
4. Cargá las notas en la página y hacé clic en Guardar en SIGED. La extensión nunca guarda por vos.

MATCHING INTELIGENTE DE NOMBRES

Tolera tildes, mayúsculas, comas, errores de tipeo y nombres parciales (por ejemplo "AMBROSIO María" frente a "AMBROSIO CALVIÑO María José"). Cada entrada del archivo se asigna a un solo alumno y se avisa de los que quedan sin nota.

ARCHIVOS QUE ENTIENDE

Excel (.xlsx) y CSV con columnas Estudiante (o Apellido y Nombre), Nota y Comentario. También la exportación de calificaciones de CREA y los formatos de equipos de versiones anteriores. Las notas con decimales se redondean y se ajustan a la escala de la página.

SEGURIDAD Y PRIVACIDAD

• Todo ocurre en tu navegador: los archivos y las notas no se envían a ningún servidor.
• Solo se activa en los dominios de SIGED.
• No recopila ni transmite información personal. Lo que guarda queda en tu navegador: la posición del panel, una evaluación que elijas copiar a otro apartado y, si usás "Armar grupos", los grupos de cada actividad con el nombre y una copia reducida de la foto de los alumnos de esa libreta. Se borra al desinstalar la extensión.

Desarrollado por un docente para docentes de Uruguay. Código abierto: https://github.com/martinferreiraHCA/CargaNotasSIGED
```

**Categoría:** Educación

**Idioma:** español (Latinoamérica)

## Recursos gráficos (archivos de la carpeta `store/`)

| Campo | Archivo |
|-------|---------|
| Icono de Chrome Web Store (128×128) | `icono-tienda-128.png` |
| Captura de pantalla 1 | `captura-1-boletin-importar.png` |
| Captura de pantalla 2 | `captura-2-evaluaciones.png` |
| Captura de pantalla 3 | `captura-3-armar-grupos.png` |
| Captura de pantalla 4 | `captura-4-detalle-promedios.png` |
| Captura de pantalla 5 | `captura-5-cierre-juicios.png` |
| Imagen en mosaico promocional pequeña (440×280) | `promo-pequeno-440x280.png` |
| Imagen en mosaico promocional con desplazamiento (1400×560) | `promo-marquesina-1400x560.png` |
| Vídeo promocional | (vacío) |

## Campos adicionales

- **URL oficial:** Ninguna (salvo que verifiques un sitio en Search Console).
- **URL de la página principal:** https://github.com/martinferreiraHCA/CargaNotasSIGED
- **URL de asistencia:** https://github.com/martinferreiraHCA/CargaNotasSIGED/issues
- **Contenido para adultos:** No.
- **Google Analytics 4:** desactivado.

## Pestaña Privacidad

**Finalidad única (single purpose):**
Ayudar al docente a cargar y exportar calificaciones, juicios y promedios en las páginas del sistema SIGED: completa los formularios de notas a partir de archivos Excel o CSV o de grupos de trabajo armados con los alumnos de la libreta, y genera planillas con los datos que muestra la página.

**Justificación de permisos:**

- `activeTab`: Para actuar sobre la pestaña de SIGED que el usuario tiene abierta cuando hace clic en la extensión.
- `scripting`: Para inyectar el panel del asistente en la pestaña de SIGED si todavía no está cargado (por ejemplo, cuando la página estaba abierta antes de instalar la extensión).
- `storage` y `unlimitedStorage`: Para guardar en el navegador del docente los grupos de trabajo de cada actividad y las fichas de los alumnos (nombre y una copia reducida de la foto) que se usan en la página "Armar grupos", de modo que pueda retomarlos después. Las fotos ocupan más que el límite normal de storage.
- Permisos de host (`*.siged.com.uy`, `*.siged.com`, `*.siged.edu.uy`): La extensión solo funciona dentro del sistema SIGED; necesita leer la lista de alumnos y completar los campos de notas y comentarios de esas páginas.

**¿Usa código remoto?** No. Todo el código, incluida la librería para leer y generar Excel (SheetJS), va empaquetado en la extensión.

**Uso de datos:** marcar "No recopila ni usa datos de usuario". La extensión no recopila ni transmite datos: los archivos se procesan localmente, las notas solo se escriben en el formulario de SIGED que el usuario tiene abierto y los grupos con las fichas de los alumnos quedan únicamente en el almacenamiento local del navegador (chrome.storage.local), sin salir del equipo.

**Certificaciones:** marcar las tres (no vende datos, no los usa para fines ajenos a la funcionalidad, no los usa para solvencia crediticia).

**Política de privacidad (URL):** https://github.com/martinferreiraHCA/CargaNotasSIGED#%EF%B8%8F-seguridad-y-privacidad

## Pestaña Distribución

- **Visibilidad:** Pública (o "No incluida en la lista" si preferís compartir solo el enlace con colegas).
- **Regiones:** todas, o solo Uruguay.
- **Pago:** gratis.
