// ========== CONTENT SCRIPT DE SIGED ==========
// Este script se inyecta en las páginas de SIGED y espera mensajes del popup

console.log('✅ SIGED Extension - Content Script cargado');
console.log('📍 URL actual:', window.location.href);

// Listener para mensajes del popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log('📨 Mensaje recibido:', request.action);
    
    if (request.action === 'cargarNotas') {
        try {
            cargarNotasEnSIGED(request.entries, request.formato, request.tipo, sendResponse);
            return true; // Mantener canal abierto para respuesta asíncrona
        } catch (error) {
            console.error('❌ Error general:', error);
            sendResponse({
                success: false,
                error: 'Error inesperado: ' + error.message
            });
            return false;
        }
    }
});

function cargarNotasEnSIGED(entries, formato, tipo, sendResponse) {
    console.log('🚀 Iniciando carga de notas en SIGED...');
    console.log('📊 Entradas:', entries.length);
    console.log('📋 Formato:', formato);
    console.log('🎯 Tipo:', tipo);
    
    // Verificar que estamos en la página correcta
    const url = window.location.href;
    if (!url.includes('siged3.siged.com.uy')) {
        console.error('❌ URL incorrecta:', url);
        sendResponse({
            success: false,
            error: 'No estás en la página de SIGED'
        });
        return;
    }
    
    console.log('✅ URL verificada:', url);
    
    // Funciones auxiliares para matching
    function tokens(txt) {
        return txt.normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .replace(/[^A-Z0-9 ]+/gi, ' ')
                  .toUpperCase()
                  .split(/\s+/)
                  .filter(Boolean)
                  .sort();
    }
    
    function isSubset(small, big) {
        for (let t of small) {
            if (!big.includes(t)) return false;
        }
        return true;
    }
    
    // Buscar campos en la página
    let procesados = 0;
    let encontrados = 0;
    const errores = [];
    const coincidencias = [];
    
    console.log('🔍 Buscando campos en la página...');
    
    for (let i = 1; i <= 60; i++) {
        const idx = String(i).padStart(4, '0');
        
        // Buscar el span con el nombre del estudiante
        const spanId = 'span_vFALUNOMCOM_' + idx;
        const span = document.getElementById(spanId);
        
        if (!span) {
            // No hay más filas
            if (i === 1) {
                console.warn('⚠️ No se encontró ningún campo de estudiante');
                console.warn('⚠️ Verifica que estés en la página de calificaciones de SIGED');
            }
            continue;
        }
        
        procesados++;
        const nombreEnPagina = span.innerText || span.textContent;
        
        if (!nombreEnPagina || nombreEnPagina.trim() === '') {
            continue;
        }
        
        const rowTok = tokens(nombreEnPagina);
        const match = entries.find(e => isSubset(e.tok, rowTok));
        
        if (!match) {
            if (procesados <= 5) {
                console.log(`⚠️ Sin match: "${nombreEnPagina}" [${rowTok.join(' ')}]`);
            }
            continue;
        }
        
        encontrados++;
        coincidencias.push({
            nombre: nombreEnPagina,
            nota: match.nota,
            comentario: match.com
        });
        
        console.log(`✅ Match #${encontrados}: "${nombreEnPagina}" → Nota: ${match.nota}`);
        
        // Cargar la nota en el select
        const selectId = 'vCALIFCOD_' + idx;
        const selectElement = document.getElementById(selectId);
        
        if (selectElement) {
            selectElement.value = match.nota;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`  ✓ Nota cargada en ${selectId}`);
        } else {
            errores.push(`Campo de nota no encontrado para: ${nombreEnPagina}`);
            console.warn(`  ⚠️ Select no encontrado: ${selectId}`);
        }
        
        // Cargar comentario si existe
        if (match.com && match.com.trim() !== '') {
            const textareaId = 'vLIBDCOMENTARIO_' + idx;
            const textarea = document.getElementById(textareaId);
            
            if (textarea) {
                textarea.value = match.com;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                console.log(`  ✓ Comentario cargado: "${match.com.substring(0, 30)}..."`);
            } else {
                console.warn(`  ⚠️ Campo de comentario no encontrado: ${textareaId}`);
            }
        }
    }
    
    // Resumen de la operación
    console.log('');
    console.log('========== RESUMEN ==========');
    console.log(`📊 Filas procesadas: ${procesados}`);
    console.log(`✅ Coincidencias encontradas: ${encontrados}`);
    console.log(`📝 Entradas enviadas: ${entries.length}`);
    console.log(`⚠️ Errores: ${errores.length}`);
    console.log('============================');
    
    if (errores.length > 0) {
        console.warn('⚠️ Errores encontrados:');
        errores.forEach(err => console.warn('  - ' + err));
    }
    
    if (encontrados === 0) {
        // No se encontró ninguna coincidencia
        let mensajeError = 'No se encontraron coincidencias. ';
        
        if (procesados === 0) {
            mensajeError += 'Verifica que estés en la página de calificaciones de SIGED con la tabla de estudiantes visible.';
        } else {
            mensajeError += `Se procesaron ${procesados} estudiantes pero ninguno coincidió con los datos del CSV.`;
        }
        
        console.error('❌', mensajeError);
        sendResponse({
            success: false,
            error: mensajeError
        });
        return;
    }
    
    // Mostrar alerta de confirmación en la página
    const resumen = `✅ NOTAS CARGADAS EN SIGED\n\n` +
                  `📊 ${encontrados} de ${procesados} estudiantes procesados\n` +
                  `📝 ${entries.length} entradas enviadas\n\n` +
                  `⚠️ IMPORTANTE: Revisa las notas y haz clic en GUARDAR en SIGED`;
    
    alert(resumen);
    
    // Enviar respuesta exitosa
    sendResponse({
        success: true,
        count: encontrados,
        processed: procesados,
        errors: errores,
        matches: coincidencias
    });
}

// Log cuando la página carga
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('📄 Página SIGED cargada y lista');
    });
} else {
    console.log('📄 Página SIGED ya estaba cargada');
}
