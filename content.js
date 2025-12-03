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
    
    // ========== FUNCIONES AUXILIARES PARA MATCHING ROBUSTO ==========

    /**
     * Calcula la distancia de Levenshtein entre dos strings
     * Retorna un número que indica cuántas operaciones (inserción, eliminación, sustitución)
     * se necesitan para transformar s1 en s2
     */
    function levenshteinDistance(s1, s2) {
        const len1 = s1.length;
        const len2 = s2.length;
        const matrix = [];

        // Inicializar matriz
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }

        // Calcular distancias
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,      // eliminación
                    matrix[i][j - 1] + 1,      // inserción
                    matrix[i - 1][j - 1] + cost // sustitución
                );
            }
        }

        return matrix[len1][len2];
    }

    /**
     * Calcula similitud entre dos strings (0 = diferentes, 1 = idénticos)
     * Usa Levenshtein normalizado
     */
    function stringSimilarity(s1, s2) {
        if (s1 === s2) return 1.0;
        if (s1.length === 0 || s2.length === 0) return 0.0;

        const distance = levenshteinDistance(s1, s2);
        const maxLen = Math.max(s1.length, s2.length);
        return 1.0 - (distance / maxLen);
    }

    /**
     * Normalización avanzada para nombres españoles
     * Maneja: tildes, ñ, espacios, caracteres especiales, mayúsculas
     */
    function normalizeText(txt) {
        return txt.normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')  // Eliminar tildes
                  .replace(/[^A-Z0-9 ]+/gi, ' ')    // Solo letras, números y espacios
                  .toUpperCase()
                  .trim();
    }

    /**
     * Convierte texto a tokens normalizados y ordenados
     */
    function tokens(txt) {
        return normalizeText(txt)
                  .split(/\s+/)
                  .filter(Boolean)
                  .sort();
    }

    /**
     * Encuentra el mejor match entre un token y una lista de tokens
     * Retorna: { token, similarity, index }
     */
    function findBestTokenMatch(searchToken, targetTokens, minSimilarity = 0.75) {
        let bestMatch = null;
        let bestSimilarity = minSimilarity;
        let bestIndex = -1;

        for (let i = 0; i < targetTokens.length; i++) {
            const similarity = stringSimilarity(searchToken, targetTokens[i]);
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = targetTokens[i];
                bestIndex = i;
            }
        }

        return { token: bestMatch, similarity: bestSimilarity, index: bestIndex };
    }

    /**
     * Calcula score de similitud entre dos conjuntos de tokens
     * Estrategia: Para cada token del CSV, busca el mejor match en SIGED
     * Retorna: { score, details } donde score es 0-1
     */
    function calculateMatchScore(csvTokens, sigedTokens) {
        if (csvTokens.length === 0 || sigedTokens.length === 0) {
            return { score: 0, details: [] };
        }

        const usedIndices = new Set();
        const details = [];
        let totalScore = 0;

        // Para cada token del CSV, encontrar el mejor match en SIGED
        for (const csvToken of csvTokens) {
            const availableTokens = sigedTokens.map((t, i) =>
                usedIndices.has(i) ? null : t
            ).filter(t => t !== null);

            if (availableTokens.length === 0) {
                // No hay más tokens disponibles
                details.push({
                    csvToken,
                    sigedToken: null,
                    similarity: 0
                });
                continue;
            }

            const bestMatch = findBestTokenMatch(csvToken, sigedTokens, 0);

            if (bestMatch.index !== -1) {
                usedIndices.add(bestMatch.index);
                totalScore += bestMatch.similarity;
                details.push({
                    csvToken,
                    sigedToken: bestMatch.token,
                    similarity: bestMatch.similarity
                });
            } else {
                details.push({
                    csvToken,
                    sigedToken: null,
                    similarity: 0
                });
            }
        }

        // Score promedio
        const avgScore = totalScore / csvTokens.length;

        // Penalizar si hay muchos tokens extras en SIGED que no se usaron
        const unmatchedRatio = (sigedTokens.length - usedIndices.size) / sigedTokens.length;
        const penalty = unmatchedRatio * 0.1; // Penalización leve del 10% por tokens no usados

        const finalScore = Math.max(0, avgScore - penalty);

        return { score: finalScore, details };
    }

    /**
     * Encuentra el mejor match de una entrada CSV entre las filas de SIGED
     * @param {Array} entries - Array de entries del CSV con propiedad 'tok'
     * @param {Array} sigedTokens - Tokens del nombre en SIGED
     * @param {number} minScore - Score mínimo para considerar un match (0-1)
     * @returns {Object|null} - Entry con mejor match o null si ninguno supera minScore
     */
    function findBestMatch(entries, sigedTokens, minScore = 0.70) {
        let bestEntry = null;
        let bestScore = minScore;
        let bestDetails = null;

        for (const entry of entries) {
            const result = calculateMatchScore(entry.tok, sigedTokens);

            if (result.score > bestScore) {
                bestScore = result.score;
                bestEntry = entry;
                bestDetails = result.details;
            }
        }

        if (bestEntry) {
            return {
                entry: bestEntry,
                score: bestScore,
                details: bestDetails
            };
        }

        return null;
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

        // Usar fuzzy matching para encontrar el mejor match
        // minScore = 0.70 significa que se requiere al menos 70% de similitud
        const matchResult = findBestMatch(entries, rowTok, 0.70);

        if (!matchResult) {
            if (procesados <= 5) {
                console.log(`⚠️ Sin match: "${nombreEnPagina}" [${rowTok.join(' ')}]`);
            }
            continue;
        }

        const match = matchResult.entry;
        const score = matchResult.score;

        encontrados++;
        coincidencias.push({
            nombre: nombreEnPagina,
            nota: match.nota,
            comentario: match.com,
            score: score
        });

        // Logging mejorado con score de similitud
        const scorePercent = (score * 100).toFixed(1);
        const scoreEmoji = score >= 0.95 ? '✅' : score >= 0.85 ? '✓' : '⚠️';
        console.log(`${scoreEmoji} Match #${encontrados}: "${nombreEnPagina}" → Nota: ${match.nota} (Similitud: ${scorePercent}%)`);

        // Mostrar detalles si la similitud no es perfecta
        if (score < 0.95 && procesados <= 10) {
            console.log(`  📊 Tokens CSV: [${match.tok.join(', ')}]`);
            console.log(`  📊 Tokens SIGED: [${rowTok.join(', ')}]`);
            if (matchResult.details) {
                const detailsStr = matchResult.details
                    .map(d => `${d.csvToken}≈${d.sigedToken || 'N/A'}(${(d.similarity * 100).toFixed(0)}%)`)
                    .join(', ');
                console.log(`  🔍 Detalles: ${detailsStr}`);
            }
        }
        
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
