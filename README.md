# 📚 SIGED - Carga Automática de Notas

Extensión de Chrome/Edge para cargar notas automáticamente en el sistema SIGED desde archivos CSV, con **matching inteligente de estudiantes** que tolera errores de ortografía, tildes, y diferencias en nombres/apellidos.

![Version](https://img.shields.io/badge/version-2.2-blue)
![Chrome](https://img.shields.io/badge/Chrome-Compatible-brightgreen)
![Edge](https://img.shields.io/badge/Edge-Compatible-brightgreen)

## ✨ Características Principales

### 🎯 Matching Inteligente de Estudiantes
- **Fuzzy matching robusto** con algoritmo Levenshtein
- **Tolerancia a errores:**
  - ✅ Tildes incorrectas: "GARCIA" ↔ "GARCÍA"
  - ✅ Errores de ortografía: "RODRIGUEZ" ↔ "RODRIQUEZ"
  - ✅ Diferencias de mayúsculas/minúsculas
  - ✅ Comas entre nombres: "GARCÍA, JUAN" ↔ "GARCÍA JUAN"
  - ✅ Nombres parciales: "GARCÍA JUAN" ↔ "GARCÍA PÉREZ JUAN PABLO"
  - ✅ Apellidos compuestos variables

### 💡 Sistema de Sugerencias
- Muestra candidatos cuando no hay match automático
- Porcentajes de similitud para decisión informada
- Logging detallado en consola para debugging

### 🌐 Versatilidad
- **Compatible con cualquier instalación de SIGED**
- Detección automática de páginas compatibles
- No requiere configuración por dominio
- Soporta HTTP y HTTPS

### 📊 Formatos CSV Soportados
1. **Gradebook Export:** `Nombre, Apellido, Título de la tarea, Calificación`
2. **Equipos v1:** `Estudiante, Calificacion_Individual, Categoria, Etapa`
3. **Equipos v2:** `Nombre, Nota_Individual, Nota_Equipo, Grupo`

## 🚀 Instalación Rápida

### Para Uso Personal (5 minutos)

1. **Descarga el código:**
   ```bash
   git clone https://github.com/martinferreiraHCA/CargaNotasSIGED.git
   cd CargaNotasSIGED
   ```

2. **Abre Chrome/Edge** y ve a:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`

3. **Activa "Modo de desarrollador"** (switch en esquina superior derecha)

4. **Clic en "Cargar extensión sin empaquetar"**

5. **Selecciona la carpeta** `CargaNotasSIGED`

¡Listo! 🎉

> Para instrucciones detalladas de instalación, distribución y publicación, consulta [INSTALACION.md](./INSTALACION.md)

## 📖 Cómo Usar

### Paso 1: Preparar el CSV
- Exporta las calificaciones desde tu sistema (Moodle, Excel, etc.)
- Asegúrate de que incluya nombres/apellidos de estudiantes
- Verifica que las calificaciones estén en escala 1-10

### Paso 2: Abrir SIGED
- Ve a tu página de ingreso de notas en SIGED
- La página debe tener la tabla de estudiantes visible

### Paso 3: Cargar Notas
1. Haz clic en el ícono de la extensión
2. Selecciona tu archivo CSV
3. Verifica el formato detectado
4. Clic en **"Cargar Notas en SIGED"**

### Paso 4: Verificar
- Las notas se cargarán automáticamente
- Revisa los matches en la consola (F12)
- **IMPORTANTE:** Haz clic en GUARDAR en SIGED

## 🧠 Algoritmo de Matching

### Ejemplos de Matching

| CSV | SIGED | Similitud | Match |
|-----|-------|-----------|-------|
| GARCÍA JUAN | GARCIA JUAN | 100% | ✅ |
| RODRÍGUEZ MARÍA | RODRIGUEZ MARIA | 100% | ✅ |
| GARCÍA PÉREZ JUAN PABLO | GARCÍA JUAN | 100% | ✅ |
| FERRARI, MÁXIMO | FERRARI RODRÍGUEZ Máximo | 88% | ✅ |
| HERNÁNDEZ RAMÍREZ M. Victoria | Hernández, María Victoria | 90% | ✅ |

## 📊 Logging y Debugging

Abre la consola del navegador (F12) para ver información detallada:

```
✅ Match #1: "GARCÍA JUAN" → Nota: 8 (Similitud: 100.0%)
✓ Match #2: "RODRÍGUEZ MARÍA" → Nota: 7 (Similitud: 92.5%)
  📊 Tokens CSV (4): [MARIA, RODRIGUEZ, RAMIREZ, VICTORIA]
  📊 Tokens SIGED (3): [MARIA, RODRIGUEZ, VICTORIA]

⚠️ Sin match: "PÉREZ LUIS"
   💡 Sugerencias (requiere ≥70% para match automático):
      1. PERES LUIS (65.0%)
      2. PÉREZ LUCÍA (55.3%)
```

## 🔧 Configuración Avanzada

### Ajustar Threshold de Similitud

**Archivo:** `content.js` línea 398

```javascript
// Más permisivo (más matches, posibles falsos positivos)
const matchResult = findBestMatch(entries, rowTok, 0.60);  // 60%

// Más estricto (menos matches, más precisión)
const matchResult = findBestMatch(entries, rowTok, 0.80);  // 80%
```

## 🌍 Compatibilidad

### Navegadores
- ✅ Chrome 88+
- ✅ Microsoft Edge 88+
- ✅ Brave
- ✅ Opera

### Dominios SIGED Soportados
- `*.siged.com.uy` - Uruguay
- `*.siged.com` - Internacional
- `*.siged.edu.uy` - Educativo Uruguay
- HTTP y HTTPS

## 📁 Estructura del Proyecto

```
CargaNotasSIGED/
├── manifest.json          # Configuración de la extensión
├── content.js            # Script inyectado en SIGED (matching logic)
├── popup.html            # Interfaz de usuario
├── popup.js              # Lógica del popup (parsing CSV)
├── icon16.png            # Ícono 16x16
├── icon48.png            # Ícono 48x48
├── icon128.png           # Ícono 128x128
├── README.md             # Este archivo
└── INSTALACION.md        # Guía de instalación detallada
```

## 🐛 Reportar Problemas

Si encuentras un bug o tienes una sugerencia:

1. Abre un [Issue](https://github.com/martinferreiraHCA/CargaNotasSIGED/issues)
2. Describe el problema claramente
3. Incluye capturas de pantalla si es posible
4. Incluye los logs de la consola (F12)

## 📝 Changelog

### v2.2 (2024)
- ✨ Detección automática de páginas compatibles
- ✨ Soporte multi-dominio
- 🐛 Mejoras en mensajes de error

### v2.1 (2024)
- ✨ Sistema de sugerencias inteligente
- ✨ Matching bidireccional para nombres parciales
- 🐛 Mejoras en fuzzy matching

### v2.0 (2024)
- ✨ Algoritmo de Levenshtein para fuzzy matching
- ✨ Scoring avanzado con tolerancia a errores
- ✨ Logging detallado con porcentajes

## 📄 Licencia

Uso libre para instituciones educativas.

## 👨‍💻 Autor

**Martín Ferreira**
- GitHub: [@martinferreiraHCA](https://github.com/martinferreiraHCA)

---

**Versión:** 2.2
**Última actualización:** 2024

⭐ Si esta extensión te fue útil, considera darle una estrella en GitHub!
