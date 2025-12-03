# 🎓 SIGED - Extensión de Chrome para Carga de Notas

Extensión de navegador para cargar notas automáticamente en SIGED desde archivos CSV.

## ✨ Características

- ✅ Carga automática de notas en SIGED
- ✅ Soporte para múltiples formatos CSV (Gradebook, Equipos v1, Equipos v2)
- ✅ Interfaz simple y minimalista
- ✅ Sin necesidad de bookmarklets
- ✅ Funciona directamente desde el navegador

## 📦 Instalación

### Chrome / Edge / Brave

1. **Descarga la extensión:**
   - Descarga todos los archivos de la carpeta `siged-extension`

2. **Abre el menú de extensiones:**
   - Ve a `chrome://extensions/`
   - O accede desde el menú: ⋮ → Más herramientas → Extensiones

3. **Activa el modo desarrollador:**
   - Activa el interruptor "Modo de desarrollador" en la esquina superior derecha

4. **Carga la extensión:**
   - Click en "Cargar extensión sin empaquetar"
   - Selecciona la carpeta `siged-extension` completa

5. **¡Listo!**
   - Verás el ícono de la extensión en la barra de herramientas
   - Fija la extensión para acceso rápido

### Firefox

1. **Descarga la extensión**

2. **Abre el menú de depuración:**
   - Ve a `about:debugging#/runtime/this-firefox`

3. **Carga temporal:**
   - Click en "Cargar complemento temporal"
   - Selecciona el archivo `manifest.json`

## 🚀 Uso

1. **Inicia sesión en SIGED:**
   - Ve a https://siged3.siged.com.uy/sigedxCandersen/
   - Navega a la página de calificaciones

2. **Abre la extensión:**
   - Click en el ícono de la extensión en la barra de herramientas

3. **Carga tu CSV:**
   - Click en "Seleccionar CSV"
   - Elige tu archivo de calificaciones

4. **Selecciona la actividad:**
   - Elige la actividad del menú desplegable

5. **Carga las notas:**
   - Click en "🚀 Cargar Notas en SIGED"
   - Las notas se cargarán automáticamente en la página

6. **Verifica y guarda:**
   - Revisa que las notas estén correctas
   - Guarda los cambios en SIGED

## 📋 Formatos CSV Soportados

### 1. Gradebook Export
```
Nombre,Apellido,Título de la tarea,Calificación
```

### 2. Calificaciones por Equipos v1
```
Estudiante,Calificacion_Individual,Categoria,Etapa
```

### 3. Calificaciones por Equipos v2
```
Nombre,Nota_Individual,Nota_Equipo,Grupo
```

## ⚙️ Permisos Requeridos

La extensión solicita los siguientes permisos:

- **activeTab**: Para acceder a la página actual de SIGED
- **storage**: Para guardar temporalmente los datos del CSV
- **host_permissions**: Para inyectar código solo en siged3.siged.com.uy

## 🔒 Privacidad

- ✅ Todos los datos se procesan localmente en tu navegador
- ✅ No se envía información a servidores externos
- ✅ Los datos del CSV solo se almacenan temporalmente
- ✅ La extensión solo funciona en el sitio de SIGED

## 🐛 Solución de Problemas

### La extensión no carga las notas

1. **Verifica que estés en la página correcta:**
   - Debe ser la página de calificaciones de SIGED
   - La URL debe contener `siged3.siged.com.uy`

2. **Recarga la página:**
   - Presiona F5 para recargar SIGED
   - Vuelve a intentar

3. **Verifica el CSV:**
   - Asegúrate de que el formato sea correcto
   - Verifica que las columnas tengan los nombres exactos

4. **Abre la consola:**
   - Presiona F12
   - Ve a la pestaña "Consola"
   - Busca mensajes de error

### La extensión no aparece

1. **Verifica la instalación:**
   - Ve a `chrome://extensions/`
   - Asegúrate de que la extensión esté activada

2. **Fija la extensión:**
   - Click en el ícono de puzzle en la barra de herramientas
   - Click en el pin junto a "SIGED - Carga de Notas"

## 📝 Notas Adicionales

- La extensión busca hasta 60 estudiantes en la página
- Los nombres se normalizan automáticamente (sin tildes en apellidos)
- Las notas se redondean o truncan según configuración
- Los comentarios se cargan automáticamente si están disponibles

## 🔄 Actualización

Para actualizar la extensión:

1. Descarga la nueva versión
2. Ve a `chrome://extensions/`
3. Click en el botón de actualizar (🔄) en la extensión

## 📧 Soporte

Si tienes problemas o sugerencias:

1. Abre la consola del navegador (F12)
2. Revisa los mensajes de error
3. Reporta el problema con capturas de pantalla

## 📄 Licencia

Uso libre para el Colegio y Liceo Hans Christian Andersen.

---

**Versión:** 1.0  
**Última actualización:** 2024
