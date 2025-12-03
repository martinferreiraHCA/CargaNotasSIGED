// ========== VARIABLES GLOBALES ==========
let datosCSV = [];
let formatoCSV = '';
let actividadesDisponibles = [];
let datosActividadActual = [];
let estudiantesUnicos = 0;

// ========== FUNCIONES AUXILIARES ==========
function removeAccents(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokens(text) {
    const txt = removeAccents(text).replace(/[^A-Z0-9 ]+/gi, ' ').toUpperCase().trim();
    return txt.split(/\s+/).filter(Boolean).sort();
}

function formatearNombre(apellido, nombre) {
    const apellidoFormateado = apellido ? removeAccents(apellido.trim()).toUpperCase() : '';
    const nombreFormateado = nombre ? nombre.trim()[0].toUpperCase() + nombre.trim().slice(1).toLowerCase() : '';
    return apellidoFormateado && nombreFormateado ? `${apellidoFormateado} ${nombreFormateado}` : apellidoFormateado || nombreFormateado;
}

function formatearNombreCompleto(nombreCompleto) {
    if (!nombreCompleto) return "";
    const partes = nombreCompleto.trim().split(/\s+/);
    if (partes.length === 1) return partes[0].toUpperCase();
    if (partes.length >= 2) {
        const apellidos = partes.slice(0, -1).join(" ");
        const nombre = partes[partes.length - 1];
        return formatearNombre(apellidos, nombre);
    }
    return nombreCompleto.trim();
}

function notaInt(val) {
    try {
        const f = parseFloat(String(val).replace(',', '.'));
        return Math.max(1, Math.min(10, Math.round(f)));
    } catch (e) {
        return 1;
    }
}

function mostrarAlerta(tipo, mensaje) {
    const alertBox = document.getElementById('alertBox');
    alertBox.innerHTML = `<div class="alert alert-${tipo}">${mensaje}</div>`;
    setTimeout(() => alertBox.innerHTML = '', 5000);
}

// ========== CSV PROCESSING ==========
function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return { headers: [], rows: [] };
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        rows.push(row);
    }
    
    return { headers, rows };
}

function detectarFormatoCSV(headers) {
    const columnas = new Set(headers);
    const gradebookCols = ['Nombre', 'Apellido', 'Título de la tarea', 'Calificación'];
    const equiposV1Cols = ['Estudiante', 'Calificacion_Individual', 'Categoria', 'Etapa'];
    const equiposV2Cols = ['Nombre', 'Nota_Individual', 'Nota_Equipo', 'Grupo'];
    
    if (gradebookCols.every(col => columnas.has(col))) return 'gradebook';
    if (equiposV2Cols.every(col => columnas.has(col))) return 'equipos_v2';
    if (equiposV1Cols.every(col => columnas.has(col))) return 'equipos_v1';
    return 'desconocido';
}

function procesarCSV(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const text = e.target.result;
            const { headers, rows } = parseCSV(text);
            
            if (headers.length === 0 || rows.length === 0) {
                mostrarAlerta('danger', 'Archivo CSV vacío o mal formateado');
                return;
            }
            
            datosCSV = rows;
            formatoCSV = detectarFormatoCSV(headers);
            
            console.log('📊 Formato detectado:', formatoCSV);
            console.log('📋 Columnas:', headers);
            console.log('📝 Filas:', rows.length);
            
            if (formatoCSV === 'desconocido') {
                mostrarAlerta('danger', `Formato no reconocido. Columnas: ${headers.join(', ')}`);
                return;
            }
            
            procesarSegunFormato();
            actualizarInterfaz();
        } catch (error) {
            console.error('❌ Error:', error);
            mostrarAlerta('danger', `Error: ${error.message}`);
        }
    };
    reader.readAsText(file);
}

function procesarSegunFormato() {
    if (formatoCSV === 'gradebook') {
        const estudiantesSet = new Set();
        datosCSV.forEach(row => {
            if (row['Nombre'] && row['Apellido']) {
                estudiantesSet.add(`${row['Apellido']}_${row['Nombre']}`);
            }
        });
        estudiantesUnicos = estudiantesSet.size;
        
        const actividadesSet = new Set(datosCSV.map(row => row['Título de la tarea']).filter(Boolean));
        actividadesDisponibles = Array.from(actividadesSet).sort();
        
    } else if (formatoCSV === 'equipos_v1') {
        estudiantesUnicos = new Set(datosCSV.map(row => row['Estudiante']).filter(Boolean)).size;
        
        const actividadesSet = new Set();
        datosCSV.forEach(row => {
            if (row['Etapa'] && row['Categoria']) {
                actividadesSet.add(`Etapa ${row['Etapa']} - ${row['Categoria']}`);
            }
        });
        actividadesDisponibles = Array.from(actividadesSet).sort();
        
    } else if (formatoCSV === 'equipos_v2') {
        estudiantesUnicos = new Set(datosCSV.map(row => row['Nombre']).filter(Boolean)).size;
        actividadesDisponibles = Array.from(new Set(datosCSV.map(row => row['Grupo']).filter(Boolean))).sort();
    }
    
    console.log('✅ Procesado:', estudiantesUnicos, 'estudiantes,', actividadesDisponibles.length, 'actividades');
}

function actualizarInterfaz() {
    const formatoTexto = {
        'gradebook': 'Gradebook Export',
        'equipos_v1': 'Equipos v1 (Individual/Equipo)',
        'equipos_v2': 'Equipos v2 (Individual/Equipo)'
    };
    
    document.getElementById('formatoInfo').textContent = `📋 ${formatoTexto[formatoCSV]}`;
    document.getElementById('estudiantesInfo').textContent = `👥 ${estudiantesUnicos} estudiantes`;
    document.getElementById('actividadesInfo').textContent = `📝 ${actividadesDisponibles.length} actividades`;
    document.getElementById('fileInfo').classList.remove('hidden');
    
    // Mostrar selector de actividad
    const select = document.getElementById('actividadSelect');
    select.innerHTML = '<option value="">Seleccionar actividad...</option>';
    actividadesDisponibles.forEach(actividad => {
        const option = document.createElement('option');
        option.value = actividad;
        option.textContent = actividad;
        select.appendChild(option);
    });
    
    document.getElementById('configSection').classList.remove('hidden');
    
    // Mostrar selector de tipo solo para equipos
    if (formatoCSV === 'equipos_v1' || formatoCSV === 'equipos_v2') {
        document.getElementById('tipoGroup').classList.remove('hidden');
    } else {
        document.getElementById('tipoGroup').classList.add('hidden');
    }
    
    mostrarAlerta('success', '✅ CSV cargado correctamente');
}

function filtrarPorActividad(actividadSeleccionada) {
    if (!actividadSeleccionada) {
        datosActividadActual = [];
        document.getElementById('counter').classList.add('hidden');
        document.getElementById('actionSection').classList.add('hidden');
        document.getElementById('btnCargar').disabled = true;
        return;
    }
    
    console.log('🔍 Filtrando actividad:', actividadSeleccionada);
    
    if (formatoCSV === 'gradebook') {
        datosActividadActual = datosCSV.filter(row => 
            row['Título de la tarea'] === actividadSeleccionada &&
            row['Calificación'] && row['Calificación'].trim() !== ''
        );
    } else if (formatoCSV === 'equipos_v1') {
        const [etapaPart, categoria] = actividadSeleccionada.split(' - ');
        const etapa = etapaPart.replace('Etapa ', '');
        datosActividadActual = datosCSV.filter(row =>
            row['Etapa'] === etapa && row['Categoria'] === categoria
        );
    } else if (formatoCSV === 'equipos_v2') {
        datosActividadActual = datosCSV.filter(row => row['Grupo'] === actividadSeleccionada);
    }
    
    console.log('📊 Estudiantes filtrados:', datosActividadActual.length);
    
    actualizarContador();
}

function actualizarContador() {
    const contador = datosActividadActual.length;
    
    if (contador > 0) {
        document.getElementById('counter').textContent = `${contador} estudiantes listos para cargar`;
        document.getElementById('counter').classList.remove('hidden');
        document.getElementById('actionSection').classList.remove('hidden');
        document.getElementById('btnCargar').disabled = false;
    } else {
        document.getElementById('counter').classList.add('hidden');
        document.getElementById('actionSection').classList.add('hidden');
        document.getElementById('btnCargar').disabled = true;
        mostrarAlerta('warning', 'No hay estudiantes en esta actividad');
    }
}

function cargarEnSIGED() {
    if (datosActividadActual.length === 0) {
        mostrarAlerta('warning', 'Selecciona una actividad primero');
        return;
    }
    
    console.log('🚀 Preparando carga de notas...');
    
    // Obtener tipo de calificación
    const tipoRadio = document.querySelector('input[name="tipo"]:checked');
    const tipo = tipoRadio ? tipoRadio.value : 'individual';
    
    console.log('📋 Tipo seleccionado:', tipo);
    console.log('📊 Formato CSV:', formatoCSV);
    
    const entries = [];
    
    datosActividadActual.forEach((item, idx) => {
        let nombreCompleto = '';
        let calificacion = '';
        let comentario = '';
        
        if (formatoCSV === 'gradebook') {
            nombreCompleto = formatearNombre(item['Apellido'], item['Nombre']);
            calificacion = item['Calificación'];
            comentario = '';
            
        } else if (formatoCSV === 'equipos_v1') {
            nombreCompleto = formatearNombreCompleto(item['Estudiante']);
            if (tipo === 'individual') {
                calificacion = item['Calificacion_Individual'] || '';
                comentario = item['Comentarios_Individuales'] || '';
            } else {
                calificacion = item['Calificacion_Equipo'] || '';
                comentario = item['Comentarios_Equipo'] || '';
            }
            
        } else if (formatoCSV === 'equipos_v2') {
            nombreCompleto = formatearNombreCompleto(item['Nombre']);
            if (tipo === 'individual') {
                calificacion = item['Nota_Individual'] || '';
                comentario = item['Comentario_Individual'] || '';
            } else {
                calificacion = item['Nota_Equipo'] || '';
                comentario = item['Comentario_Equipo'] || '';
            }
        }
        
        if (nombreCompleto && calificacion) {
            entries.push({
                tok: tokens(nombreCompleto),
                nota: notaInt(calificacion),
                com: comentario || ''
            });
            
            if (idx < 3) { // Log primeros 3 para debug
                console.log(`✅ Entry ${idx + 1}:`, nombreCompleto, '→', notaInt(calificacion));
            }
        }
    });
    
    console.log('📦 Total entries:', entries.length);
    
    if (entries.length === 0) {
        mostrarAlerta('danger', 'No hay calificaciones válidas para cargar');
        return;
    }
    
    // Verificar que estamos en una pestaña activa
    chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
        if (!tabs || tabs.length === 0) {
            mostrarAlerta('danger', 'No hay pestaña activa');
            return;
        }
        
        const currentTab = tabs[0];
        console.log('📍 URL actual:', currentTab.url);
        
        // Verificar que estamos en SIGED
        if (!currentTab.url || !currentTab.url.includes('siged.com.uy')) {
            mostrarAlerta('danger', '⚠️ Debes estar en la página de SIGED (siged.com.uy)');
            return;
        }
        
        mostrarAlerta('info', 'Conectando con SIGED...');
        
        // Intentar enviar mensaje
        const enviarMensaje = () => {
            chrome.tabs.sendMessage(currentTab.id, {
                action: 'cargarNotas',
                entries: entries,
                formato: formatoCSV,
                tipo: tipo
            }, function(response) {
                if (chrome.runtime.lastError) {
                    console.error('❌ Error de comunicación:', chrome.runtime.lastError.message);
                    
                    // Intentar inyectar el content script manualmente
                    console.log('🔧 Intentando inyectar content script...');
                    
                    chrome.scripting.executeScript({
                        target: { tabId: currentTab.id },
                        files: ['content.js']
                    }, function() {
                        if (chrome.runtime.lastError) {
                            console.error('❌ No se pudo inyectar:', chrome.runtime.lastError.message);
                            mostrarAlerta('danger', 
                                '❌ Error: No se puede conectar con SIGED. ' +
                                'Soluciones:\n' +
                                '1. Recarga esta página (F5)\n' +
                                '2. Cierra y vuelve a abrir la extensión\n' +
                                '3. Recarga la extensión en chrome://extensions/'
                            );
                        } else {
                            console.log('✅ Content script inyectado manualmente');
                            mostrarAlerta('info', 'Reintentando en 1 segundo...');
                            
                            // Reintentar después de 1 segundo
                            setTimeout(() => {
                                enviarMensaje();
                            }, 1000);
                        }
                    });
                } else if (response && response.success) {
                    console.log('✅ Respuesta exitosa:', response);
                    mostrarAlerta('success', `✅ ${response.count} notas cargadas en SIGED`);
                } else if (response && response.error) {
                    console.error('❌ Error del servidor:', response.error);
                    mostrarAlerta('danger', '❌ ' + response.error);
                } else {
                    console.warn('⚠️ Respuesta inesperada:', response);
                    mostrarAlerta('warning', '⚠️ Respuesta inesperada. Verifica SIGED.');
                }
            });
        };
        
        // Primer intento
        enviarMensaje();
    });
}

// ========== EVENT LISTENERS ==========
document.getElementById('csvFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('fileName').textContent = file.name;
        procesarCSV(file);
    }
});

document.getElementById('actividadSelect').addEventListener('change', function(e) {
    filtrarPorActividad(e.target.value);
});

// Listener para cambio de tipo de calificación
document.querySelectorAll('input[name="tipo"]').forEach(radio => {
    radio.addEventListener('change', function() {
        console.log('🔄 Tipo cambiado a:', this.value);
        // Re-contar cuando cambie el tipo
        actualizarContador();
    });
});

document.getElementById('btnCargar').addEventListener('click', cargarEnSIGED);

// Log inicial
console.log('✅ SIGED Extension popup cargado');
