// ========== MATCHING DE NOMBRES (compartido) ==========
// Algoritmo de comparación de nombres tolerante a tildes, errores de
// ortografía, orden distinto de apellidos/nombres y nombres parciales.
// Se usa tanto desde el panel en la página (content.js) como desde el popup.

(function (global) {
    'use strict';

    /** Distancia de Levenshtein entre dos strings */
    function levenshteinDistance(s1, s2) {
        const len1 = s1.length;
        const len2 = s2.length;
        const matrix = [];
        for (let i = 0; i <= len1; i++) matrix[i] = [i];
        for (let j = 0; j <= len2; j++) matrix[0][j] = j;
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }
        return matrix[len1][len2];
    }

    /** Similitud 0..1 entre dos strings */
    function stringSimilarity(s1, s2) {
        if (s1 === s2) return 1.0;
        if (s1.length === 0 || s2.length === 0) return 0.0;
        const distance = levenshteinDistance(s1, s2);
        return 1.0 - (distance / Math.max(s1.length, s2.length));
    }

    /** Normaliza texto: sin tildes, solo letras/números, mayúsculas */
    function normalizeText(txt) {
        return String(txt || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^A-Z0-9 ]+/gi, ' ')
            .toUpperCase()
            .trim();
    }

    /** Texto → tokens normalizados y ordenados */
    function tokens(txt) {
        return normalizeText(txt).split(/\s+/).filter(Boolean).sort();
    }

    function findBestTokenMatch(searchToken, targetTokens, minSimilarity) {
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

    function calculateDirectionalScore(sourceTokens, targetTokens) {
        const usedIndices = new Set();
        const details = [];
        let totalScore = 0;
        for (const sourceToken of sourceTokens) {
            const bestMatch = findBestTokenMatch(sourceToken, targetTokens, 0);
            if (bestMatch.index !== -1) {
                usedIndices.add(bestMatch.index);
                totalScore += bestMatch.similarity;
                details.push({ sourceToken, targetToken: bestMatch.token, similarity: bestMatch.similarity });
            } else {
                details.push({ sourceToken, targetToken: null, similarity: 0 });
            }
        }
        const avgScore = sourceTokens.length > 0 ? totalScore / sourceTokens.length : 0;
        return { avgScore, matchedCount: usedIndices.size, details };
    }

    /**
     * Score 0..1 entre dos conjuntos de tokens (bidireccional, tolera
     * nombres parciales: "GARCIA JUAN" vs "GARCIA PEREZ JUAN PABLO").
     */
    function calculateMatchScore(csvTokens, sigedTokens) {
        if (csvTokens.length === 0 || sigedTokens.length === 0) {
            return { score: 0, details: [], direction: 'none' };
        }
        const csvToSiged = calculateDirectionalScore(csvTokens, sigedTokens);
        const sigedToCsv = calculateDirectionalScore(sigedTokens, csvTokens);
        const csvLen = csvTokens.length;
        const sigedLen = sigedTokens.length;
        const ratio = Math.max(csvLen, sigedLen) / Math.min(csvLen, sigedLen);

        let finalScore, details, direction;
        if (ratio <= 1.5) {
            finalScore = (csvToSiged.avgScore * 0.6) + (sigedToCsv.avgScore * 0.4);
            details = csvToSiged.details;
            direction = 'bidirectional';
        } else if (csvLen < sigedLen) {
            finalScore = csvToSiged.avgScore;
            if (csvToSiged.matchedCount === csvLen && csvToSiged.avgScore >= 0.8) {
                finalScore = Math.min(1.0, finalScore * 1.1);
            }
            details = csvToSiged.details;
            direction = 'csv-to-siged';
        } else {
            finalScore = sigedToCsv.avgScore;
            if (sigedToCsv.matchedCount === sigedLen && sigedToCsv.avgScore >= 0.8) {
                finalScore = Math.min(1.0, finalScore * 1.1);
            }
            details = sigedToCsv.details.map(d => ({
                csvToken: d.targetToken, sigedToken: d.sourceToken, similarity: d.similarity
            }));
            direction = 'siged-to-csv';
        }

        const hasGoodMatches = details.some(d => d.similarity >= 0.7);
        if (!hasGoodMatches && details.length > 0) finalScore *= 0.9;

        return { score: Math.max(0, Math.min(1, finalScore)), details, direction, csvLen, sigedLen };
    }

    /** Mejor entrada (con propiedad .tok) para un nombre de SIGED */
    function findBestMatch(entries, sigedTokens, minScore) {
        let bestEntry = null;
        let bestScore = (minScore === undefined ? 0.70 : minScore);
        let bestDetails = null;
        for (const entry of entries) {
            const result = calculateMatchScore(entry.tok, sigedTokens);
            if (result.score > bestScore) {
                bestScore = result.score;
                bestEntry = entry;
                bestDetails = result.details;
            }
        }
        return bestEntry ? { entry: bestEntry, score: bestScore, details: bestDetails } : null;
    }

    /** Top N candidatos para un nombre de SIGED (para sugerencias) */
    function findTopCandidates(nombreSiged, entries, topN) {
        const sigedTokens = tokens(nombreSiged);
        const candidates = entries.map(entry => ({
            entry,
            score: calculateMatchScore(entry.tok, sigedTokens).score,
            nombreOriginal: entry.nombre || entry.tok.join(' ')
        }));
        candidates.sort((a, b) => b.score - a.score);
        return candidates.slice(0, topN || 3);
    }

    /**
     * Asignación única: cada entrada del archivo se asigna como máximo a una
     * fila de SIGED, priorizando las parejas con mayor similitud.
     * @param {Array} filas    - [{tok, ...}] filas de SIGED
     * @param {Array} entradas - [{tok, ...}] entradas del archivo
     * @returns {Array} por cada fila: {entrada, score} | null
     */
    function asignarUnico(filas, entradas, minScore) {
        const umbral = (minScore === undefined ? 0.70 : minScore);
        const pares = [];
        filas.forEach((fila, fi) => {
            entradas.forEach((entrada, ei) => {
                const r = calculateMatchScore(entrada.tok, fila.tok);
                if (r.score >= umbral) pares.push({ fi, ei, score: r.score });
            });
        });
        pares.sort((a, b) => b.score - a.score);
        const resultado = new Array(filas.length).fill(null);
        const entradasUsadas = new Set();
        for (const p of pares) {
            if (resultado[p.fi] || entradasUsadas.has(p.ei)) continue;
            resultado[p.fi] = { entrada: entradas[p.ei], indice: p.ei, score: p.score };
            entradasUsadas.add(p.ei);
        }
        return resultado;
    }

    global.SigedMatching = {
        levenshteinDistance,
        stringSimilarity,
        normalizeText,
        tokens,
        calculateMatchScore,
        findBestMatch,
        findTopCandidates,
        asignarUnico
    };
})(typeof window !== 'undefined' ? window : globalThis);
