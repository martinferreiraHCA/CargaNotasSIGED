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
     * Calcula score en una dirección (source → target)
     * Busca el mejor match para cada token de source en target
     * @private
     */
    function calculateDirectionalScore(sourceTokens, targetTokens) {
        const usedIndices = new Set();
        const details = [];
        let totalScore = 0;

        for (const sourceToken of sourceTokens) {
            const bestMatch = findBestTokenMatch(sourceToken, targetTokens, 0);

            if (bestMatch.index !== -1) {
                usedIndices.add(bestMatch.index);
                totalScore += bestMatch.similarity;
                details.push({
                    sourceToken,
                    targetToken: bestMatch.token,
                    similarity: bestMatch.similarity
                });
            } else {
                details.push({
                    sourceToken,
                    targetToken: null,
                    similarity: 0
                });
            }
        }

        const avgScore = sourceTokens.length > 0 ? totalScore / sourceTokens.length : 0;
        const matchedCount = usedIndices.size;

        return { avgScore, matchedCount, details };
    }

    /**
     * Calcula score de similitud entre dos conjuntos de tokens
     *
     * MEJORA PARA NOMBRES PARCIALES:
     * Maneja correctamente casos donde un sistema tiene más nombres/apellidos:
     * - CSV: "GARCÍA PÉREZ JUAN PABLO" vs SIGED: "GARCÍA JUAN"
     * - CSV: "RODRÍGUEZ MARÍA" vs SIGED: "RODRÍGUEZ GONZÁLEZ MARÍA JOSÉ"
     *
     * Estrategia bidireccional:
     * 1. Calcula similitud CSV → SIGED
     * 2. Calcula similitud SIGED → CSV
     * 3. Usa scoring inteligente que favorece subsets de alta calidad
     *
     * @returns { score, details, direction } donde score es 0-1
     */
    function calculateMatchScore(csvTokens, sigedTokens) {
        if (csvTokens.length === 0 || sigedTokens.length === 0) {
            return { score: 0, details: [], direction: 'none' };
        }

        // Calcular scoring en ambas direcciones
        const csvToSiged = calculateDirectionalScore(csvTokens, sigedTokens);
        const sigedToCsv = calculateDirectionalScore(sigedTokens, csvTokens);

        // Estrategia de scoring adaptativa:
        // Si uno tiene significativamente más tokens, priorizar la dirección del más corto
        const csvLen = csvTokens.length;
        const sigedLen = sigedTokens.length;
        const ratio = Math.max(csvLen, sigedLen) / Math.min(csvLen, sigedLen);

        let finalScore, details, direction;

        if (ratio <= 1.5) {
            // Longitudes similares: usar promedio ponderado de ambas direcciones
            const weight1 = 0.6;
            const weight2 = 0.4;
            finalScore = (csvToSiged.avgScore * weight1) + (sigedToCsv.avgScore * weight2);
            details = csvToSiged.details;
            direction = 'bidirectional';
        } else {
            // Diferencia significativa en longitud: usar la mejor dirección
            // Esto favorece casos como "GARCÍA JUAN" matching "GARCÍA PÉREZ JUAN PABLO"

            if (csvLen < sigedLen) {
                // CSV más corto: priorizar que todos los tokens del CSV tengan match
                // Ejemplo: CSV="GARCÍA JUAN" debe matchear bien con SIGED="GARCÍA PÉREZ JUAN PABLO"
                finalScore = csvToSiged.avgScore;

                // Bonus si todos los tokens del CSV tienen buen match
                if (csvToSiged.matchedCount === csvLen && csvToSiged.avgScore >= 0.8) {
                    finalScore = Math.min(1.0, finalScore * 1.1); // Bonus 10%
                }

                details = csvToSiged.details;
                direction = 'csv-to-siged';
            } else {
                // SIGED más corto: priorizar que todos los tokens de SIGED tengan match
                // Ejemplo: SIGED="GARCÍA JUAN" debe matchear bien con CSV="GARCÍA PÉREZ JUAN PABLO"
                finalScore = sigedToCsv.avgScore;

                // Bonus si todos los tokens de SIGED tienen buen match
                if (sigedToCsv.matchedCount === sigedLen && sigedToCsv.avgScore >= 0.8) {
                    finalScore = Math.min(1.0, finalScore * 1.1); // Bonus 10%
                }

                // Convertir details a formato esperado (desde perspectiva del CSV)
                details = sigedToCsv.details.map(d => ({
                    csvToken: d.targetToken,
                    sigedToken: d.sourceToken,
                    similarity: d.similarity
                }));
                direction = 'siged-to-csv';
            }
        }

        // Penalización muy suave solo si NO hay ningún match decente
        const hasGoodMatches = details.some(d => d.similarity >= 0.7);
        if (!hasGoodMatches && details.length > 0) {
            finalScore *= 0.9; // Penalización 10% si no hay ningún match decente
        }

        return {
            score: Math.max(0, Math.min(1, finalScore)),
            details,
            direction,
            csvLen,
            sigedLen
        };
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

    /**
     * Encuentra los top N mejores candidatos para un nombre de SIGED
     * Útil para sugerencias cuando no hay match válido
     * @param {string} nombreSiged - Nombre completo del estudiante en SIGED
     * @param {Array} entries - Array de entries del CSV
     * @param {number} topN - Cantidad de sugerencias a retornar
     * @returns {Array} - Array de {entry, score, nombreOriginal} ordenados por score descendente
     */
    function findTopCandidates(nombreSiged, entries, topN = 3) {
        const sigedTokens = tokens(nombreSiged);
        const candidates = [];

        for (const entry of entries) {
            const result = calculateMatchScore(entry.tok, sigedTokens);
            candidates.push({
                entry: entry,
                score: result.score,
                nombreOriginal: entry.nombre || entry.tok.join(' ')
            });
        }

        // Ordenar por score descendente y tomar los top N
        candidates.sort((a, b) => b.score - a.score);
        return candidates.slice(0, topN);
    }

    // Buscar campos en la página
    let procesados = 0;
    let encontrados = 0;
    const errores = [];
    const coincidencias = [];
    const sinMatch = [];  // Estudiantes de SIGED sin match con sugerencias

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
            // No hay match válido - buscar sugerencias
            const sugerencias = findTopCandidates(nombreEnPagina, entries, 3);

            sinMatch.push({
                nombre: nombreEnPagina,
                tokens: rowTok,
                sugerencias: sugerencias
            });

            console.log(`⚠️ Sin match: "${nombreEnPagina}" [${rowTok.join(' ')}]`);

            // Mostrar sugerencias en consola
            if (sugerencias.length > 0 && sugerencias[0].score > 0.4) {
                console.log(`   💡 Sugerencias (requiere ≥70% para match automático):`);
                sugerencias.forEach((sug, idx) => {
                    const percent = (sug.score * 100).toFixed(1);
                    console.log(`      ${idx + 1}. ${sug.nombreOriginal} (${percent}%)`);
                });
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
            console.log(`  📊 Tokens CSV (${match.tok.length}): [${match.tok.join(', ')}]`);
            console.log(`  📊 Tokens SIGED (${rowTok.length}): [${rowTok.join(', ')}]`);

            // Mostrar información sobre matching direccional si hay diferencia de longitud
            if (matchResult.direction && match.tok.length !== rowTok.length) {
                const diffInfo = match.tok.length < rowTok.length
                    ? '📝 CSV tiene menos tokens → Match basado en subset'
                    : '📝 SIGED tiene menos tokens → Match basado en subset';
                console.log(`  ${diffInfo}`);
            }

            if (matchResult.details) {
                const detailsStr = matchResult.details
                    .map(d => `${d.csvToken || d.sourceToken}≈${d.sigedToken || d.targetToken || 'N/A'}(${(d.similarity * 100).toFixed(0)}%)`)
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
    console.log(`❌ Sin coincidencia: ${sinMatch.length}`);
    console.log(`📝 Entradas enviadas: ${entries.length}`);
    console.log(`⚠️ Errores: ${errores.length}`);
    console.log('============================');

    if (errores.length > 0) {
        console.warn('⚠️ Errores encontrados:');
        errores.forEach(err => console.warn('  - ' + err));
    }

    // Mostrar sugerencias detalladas para estudiantes sin match
    if (sinMatch.length > 0) {
        console.log('');
        console.log('========== SUGERENCIAS PARA ESTUDIANTES SIN MATCH ==========');
        console.log(`Se encontraron ${sinMatch.length} estudiante(s) en SIGED sin match automático (requiere ≥70% similitud)`);
        console.log('A continuación se muestran los candidatos más cercanos del CSV:');
        console.log('');

        sinMatch.forEach((item, idx) => {
            console.log(`${idx + 1}. 🔴 SIGED: "${item.nombre}"`);

            if (item.sugerencias.length > 0) {
                console.log('   Candidatos del CSV:');
                item.sugerencias.forEach((sug, sugIdx) => {
                    const percent = (sug.score * 100).toFixed(1);
                    const emoji = sug.score >= 0.60 ? '🟡' : sug.score >= 0.40 ? '🟠' : '⚪';
                    console.log(`   ${emoji} ${sugIdx + 1}. ${sug.nombreOriginal} - Similitud: ${percent}%`);
                });
            } else {
                console.log('   ⚠️ No hay candidatos cercanos en el CSV');
            }
            console.log('');
        });

        console.log('💡 TIP: Si alguna sugerencia es correcta, verifica:');
        console.log('   - Que los nombres estén escritos correctamente en ambos sistemas');
        console.log('   - Considera ajustar el umbral si hay muchos errores de ortografía');
        console.log('============================================================');
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
    let resumen = `✅ NOTAS CARGADAS EN SIGED\n\n` +
                  `📊 ${encontrados} de ${procesados} estudiantes procesados\n` +
                  `📝 ${entries.length} entradas enviadas\n`;

    // Agregar información sobre estudiantes sin match
    if (sinMatch.length > 0) {
        resumen += `\n❌ ${sinMatch.length} estudiante(s) en SIGED sin match\n`;
        resumen += `💡 Revisa la consola (F12) para ver sugerencias\n`;

        // Mostrar primeros 3 estudiantes sin match
        const mostrar = Math.min(3, sinMatch.length);
        resumen += `\nEstudiantes sin match:\n`;
        for (let i = 0; i < mostrar; i++) {
            resumen += `• ${sinMatch[i].nombre}\n`;
            if (sinMatch[i].sugerencias.length > 0) {
                const mejorSug = sinMatch[i].sugerencias[0];
                const percent = (mejorSug.score * 100).toFixed(0);
                resumen += `  Mejor candidato: ${mejorSug.nombreOriginal} (${percent}%)\n`;
            }
        }
        if (sinMatch.length > 3) {
            resumen += `... y ${sinMatch.length - 3} más\n`;
        }
    }

    resumen += `\n⚠️ IMPORTANTE: Revisa las notas y haz clic en GUARDAR en SIGED`;

    alert(resumen);
    
    // Enviar respuesta exitosa
    sendResponse({
        success: true,
        count: encontrados,
        processed: procesados,
        unmatched: sinMatch.length,
        errors: errores,
        matches: coincidencias,
        suggestions: sinMatch
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
