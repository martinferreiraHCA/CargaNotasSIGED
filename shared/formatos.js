// ========== LECTURA / ESCRITURA DE ARCHIVOS DE NOTAS (compartido) ==========
// Soporta:
//   • Planilla SIGED (la que genera esta extensión): Estudiante / Nota / Comentario [/ Fecha / Conducta]
//   • Exportación de calificaciones de CREA (Nombre, Apellido, Título de la tarea, Calificación)
//   • Formatos de equipos (v1 y v2) de versiones anteriores
//   • Cualquier CSV/Excel con una columna de nombre y una de nota
// Archivos: .xlsx / .xls / .ods (vía SheetJS si está disponible) y .csv / .txt

(function (global) {
    'use strict';

    const M = global.SigedMatching;

    // ---------- normalización de encabezados ----------
    function normHeader(s) {
        return String(s || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    const SINONIMOS = {
        estudiante: ['estudiante', 'estudiantes', 'alumno', 'alumna', 'alumno a', 'alumnos', 'nombre completo',
                     'nombre y apellido', 'apellido y nombre', 'apellido nombre', 'nombre apellido',
                     'apellidos y nombres', 'nombres y apellidos', 'nombrecompleto', 'persona'],
        apellido:   ['apellido', 'apellidos', 'last name', 'lastname'],
        nombre:     ['nombre', 'nombres', 'first name', 'firstname'],
        nota:       ['nota', 'notas', 'calificacion', 'calificaciones', 'calif', 'nota final', 'puntaje', 'puntuacion',
                     'calificacion final', 'rend', 'rendimiento', 'grade', 'score', 'nota individual', 'calificacion individual'],
        comentario: ['comentario', 'comentarios', 'juicio', 'juicios', 'juicio asignatura', 'observacion', 'observaciones',
                     'comentario individual', 'comentarios individuales', 'comment', 'comments'],
        fecha:      ['fecha', 'fecha de la evaluacion', 'fecha evaluacion', 'date'],
        conducta:   ['conducta', 'comp', 'comportamiento'],
        actividad:  ['titulo de la tarea', 'tarea', 'actividad', 'evaluacion', 'instancia', 'columna', 'prueba', 'assignment']
    };

    function mapearColumnas(headers) {
        const mapa = {};
        const normalizados = headers.map(normHeader);
        for (const campo of Object.keys(SINONIMOS)) {
            const lista = SINONIMOS[campo];
            let mejor = -1;
            let mejorPos = 999;
            normalizados.forEach((h, i) => {
                const pos = lista.indexOf(h);
                if (pos !== -1 && pos < mejorPos) { mejor = i; mejorPos = pos; }
            });
            if (mejor !== -1) mapa[campo] = headers[mejor];
        }
        // "Nombre" sin "Apellido" → es el nombre completo
        if (!mapa.estudiante && mapa.nombre && !mapa.apellido) {
            mapa.estudiante = mapa.nombre;
            delete mapa.nombre;
        }
        return mapa;
    }

    function tieneColumnaDeNombre(mapa) {
        return !!(mapa.estudiante || (mapa.apellido && mapa.nombre));
    }

    // ---------- formatos heredados (equipos) ----------
    function detectarFormatoHeredado(headers) {
        const cols = new Set(headers.map(h => String(h).trim()));
        const equiposV1 = ['Estudiante', 'Calificacion_Individual', 'Categoria', 'Etapa'];
        const equiposV2 = ['Nombre', 'Nota_Individual', 'Nota_Equipo', 'Grupo'];
        if (equiposV2.every(c => cols.has(c))) return 'equipos_v2';
        if (equiposV1.every(c => cols.has(c))) return 'equipos_v1';
        return null;
    }

    // ---------- CSV ----------
    function detectarDelimitador(linea) {
        const candidatos = [';', ',', '\t', '|'];
        let mejor = ',';
        let mejorCant = -1;
        for (const d of candidatos) {
            let cant = 0;
            let enComillas = false;
            for (const ch of linea) {
                if (ch === '"') enComillas = !enComillas;
                else if (ch === d && !enComillas) cant++;
            }
            if (cant > mejorCant) { mejorCant = cant; mejor = d; }
        }
        return mejor;
    }

    /** Parser CSV con soporte de comillas, saltos de línea dentro de campos y delimitador automático */
    function parseCSV(texto, delimitador) {
        texto = String(texto || '').replace(/^﻿/, '');
        const primeraLinea = texto.split(/\r?\n/).find(l => l.trim()) || '';
        const d = delimitador || detectarDelimitador(primeraLinea);
        const filas = [];
        let fila = [];
        let campo = '';
        let enComillas = false;
        for (let i = 0; i < texto.length; i++) {
            const ch = texto[i];
            if (enComillas) {
                if (ch === '"') {
                    if (texto[i + 1] === '"') { campo += '"'; i++; }
                    else enComillas = false;
                } else {
                    campo += ch;
                }
            } else if (ch === '"') {
                enComillas = true;
            } else if (ch === d) {
                fila.push(campo); campo = '';
            } else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && texto[i + 1] === '\n') i++;
                fila.push(campo); campo = '';
                filas.push(fila); fila = [];
            } else {
                campo += ch;
            }
        }
        if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
        return filas.map(f => f.map(c => String(c).trim())).filter(f => f.some(c => c !== ''));
    }

    function decodificarBuffer(buffer) {
        const bytes = new Uint8Array(buffer);
        // UTF-8 con BOM
        if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
            return new TextDecoder('utf-8').decode(bytes.subarray(3));
        }
        // UTF-16 LE con BOM (Excel "Texto Unicode")
        if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
            return new TextDecoder('utf-16le').decode(bytes.subarray(2));
        }
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (e) {
            // Excel en español suele guardar CSV en ANSI (windows-1252)
            return new TextDecoder('windows-1252').decode(bytes);
        }
    }

    // ---------- matriz (filas x columnas) → datos ----------
    function desdeMatriz(aoa) {
        // Buscar la fila de encabezado dentro de las primeras 15 filas
        let idxHeader = -1;
        let headers = null;
        let mapa = null;
        let formato = 'universal';
        for (let i = 0; i < Math.min(aoa.length, 15); i++) {
            const h = aoa[i].map(c => String(c === null || c === undefined ? '' : c).trim());
            if (h.filter(Boolean).length < 2) continue;
            const heredado = detectarFormatoHeredado(h);
            const m = mapearColumnas(h);
            if (heredado || (tieneColumnaDeNombre(m) && m.nota)) {
                idxHeader = i; headers = h; mapa = m; formato = heredado || 'universal';
                break;
            }
            if (idxHeader === -1 && tieneColumnaDeNombre(m)) {
                // Hay columna de nombre pero no de nota: la guardamos por si no aparece nada mejor
                idxHeader = i; headers = h; mapa = m; formato = 'universal';
            }
        }
        if (idxHeader === -1) {
            throw new Error('No se encontró una fila de encabezados con una columna de nombre de estudiante ' +
                            '(por ejemplo "Estudiante" o "Apellido" + "Nombre").');
        }

        const filas = [];
        for (let i = idxHeader + 1; i < aoa.length; i++) {
            const valores = aoa[i];
            if (!valores || !valores.some(v => String(v === null || v === undefined ? '' : v).trim() !== '')) continue;
            const obj = {};
            headers.forEach((h, j) => {
                if (!h) return;
                const v = valores[j];
                obj[h] = (v === null || v === undefined) ? '' : String(v).trim();
            });
            filas.push(obj);
        }

        const datos = { headers, filas, mapa, formato, actividades: [], requiereTipo: false };

        if (formato === 'equipos_v1') {
            const set = new Set();
            filas.forEach(r => { if (r['Etapa'] && r['Categoria']) set.add(`Etapa ${r['Etapa']} - ${r['Categoria']}`); });
            datos.actividades = Array.from(set).sort();
            datos.requiereTipo = true;
        } else if (formato === 'equipos_v2') {
            datos.actividades = Array.from(new Set(filas.map(r => r['Grupo']).filter(Boolean))).sort();
            datos.requiereTipo = true;
        } else if (mapa.actividad) {
            datos.actividades = Array.from(new Set(filas.map(r => r[mapa.actividad]).filter(Boolean))).sort();
        }

        if (formato === 'universal' && !mapa.nota) {
            datos.advertencia = 'El archivo tiene nombres de estudiantes pero no se encontró una columna "Nota".';
        }

        datos.estudiantes = contarEstudiantes(datos);
        return datos;
    }

    function nombreDeFila(datos, fila) {
        const mapa = datos.mapa;
        if (datos.formato === 'equipos_v1') return fila['Estudiante'] || '';
        if (datos.formato === 'equipos_v2') return fila['Nombre'] || '';
        if (mapa.estudiante) return fila[mapa.estudiante] || '';
        if (mapa.apellido && mapa.nombre) {
            return `${fila[mapa.apellido] || ''} ${fila[mapa.nombre] || ''}`.trim();
        }
        return '';
    }

    function contarEstudiantes(datos) {
        const set = new Set();
        datos.filas.forEach(f => {
            const n = M.normalizeText(nombreDeFila(datos, f));
            if (n) set.add(n);
        });
        return set.size;
    }

    /**
     * Construye las entradas a cargar: [{nombre, tok, nota, comentario, fecha, conducta}]
     * @param {Object} datos     - resultado de leerArchivo()
     * @param {Object} opciones  - {actividad, tipo: 'individual'|'equipo'}
     */
    function construirEntradas(datos, opciones) {
        opciones = opciones || {};
        const mapa = datos.mapa;
        const tipo = opciones.tipo || 'individual';
        const entradas = [];

        datos.filas.forEach(fila => {
            let nombre = nombreDeFila(datos, fila);
            let nota = '';
            let comentario = '';
            let fecha = '';
            let conducta = '';

            if (datos.formato === 'equipos_v1') {
                if (opciones.actividad) {
                    const [etapaPart, categoria] = opciones.actividad.split(' - ');
                    const etapa = (etapaPart || '').replace('Etapa ', '');
                    if (fila['Etapa'] !== etapa || fila['Categoria'] !== categoria) return;
                }
                nota = tipo === 'individual' ? (fila['Calificacion_Individual'] || '') : (fila['Calificacion_Equipo'] || '');
                comentario = tipo === 'individual' ? (fila['Comentarios_Individuales'] || '') : (fila['Comentarios_Equipo'] || '');
            } else if (datos.formato === 'equipos_v2') {
                if (opciones.actividad && fila['Grupo'] !== opciones.actividad) return;
                nota = tipo === 'individual' ? (fila['Nota_Individual'] || '') : (fila['Nota_Equipo'] || '');
                comentario = tipo === 'individual' ? (fila['Comentario_Individual'] || '') : (fila['Comentario_Equipo'] || '');
            } else {
                if (mapa.actividad && opciones.actividad && fila[mapa.actividad] !== opciones.actividad) return;
                nota = mapa.nota ? (fila[mapa.nota] || '') : '';
                comentario = mapa.comentario ? (fila[mapa.comentario] || '') : '';
                fecha = mapa.fecha ? (fila[mapa.fecha] || '') : '';
                conducta = mapa.conducta ? (fila[mapa.conducta] || '') : '';
            }

            nombre = String(nombre).trim();
            nota = String(nota).trim();
            if (!nombre) return;
            if (!nota && !comentario) return; // nada para cargar

            entradas.push({
                nombre,
                tok: M.tokens(nombre),
                nota,
                comentario: String(comentario || '').trim(),
                fecha: String(fecha || '').trim(),
                conducta: String(conducta || '').trim()
            });
        });

        return entradas;
    }

    // ---------- lectura de archivos ----------
    async function leerArchivo(file) {
        const nombre = (file.name || '').toLowerCase();
        const buffer = await file.arrayBuffer();
        let aoa;
        if (/\.(xlsx|xlsm|xls|ods|xlsb)$/.test(nombre)) {
            if (!global.XLSX) throw new Error('No se pudo leer el archivo Excel (falta la librería). Guardalo como CSV e intentá de nuevo.');
            const wb = global.XLSX.read(buffer, { type: 'array', cellDates: true });
            const nombreHoja = wb.SheetNames.find(n => normHeader(n) === 'notas') || wb.SheetNames[0];
            const ws = wb.Sheets[nombreHoja];
            aoa = global.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'dd/mm/yyyy' });
        } else {
            aoa = parseCSV(decodificarBuffer(buffer));
        }
        const datos = desdeMatriz(aoa);
        datos.nombreArchivo = file.name;
        return datos;
    }

    // ---------- escritura de archivos ----------
    function nombreArchivoSeguro(partes, extension) {
        const base = partes.filter(Boolean)
            .map(p => String(p).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
            .filter(Boolean)
            .join('_')
            .slice(0, 90)
            .replace(/_+$/, '');
        return (base || 'notas') + '.' + extension;
    }

    function descargarBlob(blob, nombre) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
    }

    function aCSV(encabezados, filas) {
        const esc = v => {
            const s = String(v === null || v === undefined ? '' : v);
            return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lineas = [encabezados.map(esc).join(';')];
        filas.forEach(f => lineas.push(f.map(esc).join(';')));
        return '﻿' + lineas.join('\r\n');
    }

    /**
     * Descarga una planilla.
     * @param {Object} p - {encabezados, filas, info: [[clave, valor], ...], nombreBase: [...], formato: 'xlsx'|'csv', anchos: [..]}
     */
    function descargarPlanilla(p) {
        const formato = p.formato || (global.XLSX ? 'xlsx' : 'csv');
        if (formato === 'xlsx' && global.XLSX) {
            const XLSX = global.XLSX;
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([p.encabezados].concat(p.filas));
            ws['!cols'] = (p.anchos || p.encabezados.map(h => Math.max(12, String(h).length + 2))).map(w => ({ wch: w }));
            ws['!freeze'] = { xSplit: 0, ySplit: 1 };
            XLSX.utils.book_append_sheet(wb, ws, 'Notas');
            if (p.info && p.info.length) {
                const wsInfo = XLSX.utils.aoa_to_sheet(p.info);
                wsInfo['!cols'] = [{ wch: 22 }, { wch: 70 }];
                XLSX.utils.book_append_sheet(wb, wsInfo, 'Info');
            }
            const nombre = nombreArchivoSeguro(p.nombreBase, 'xlsx');
            const salida = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            descargarBlob(new Blob([salida], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombre);
            return nombre;
        }
        const nombre = nombreArchivoSeguro(p.nombreBase, 'csv');
        descargarBlob(new Blob([aCSV(p.encabezados, p.filas)], { type: 'text/csv;charset=utf-8' }), nombre);
        return nombre;
    }

    // ---------- utilidades de valores ----------
    function notaNumero(valor) {
        const s = String(valor === null || valor === undefined ? '' : valor).trim().replace(',', '.');
        if (!s) return null;
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
    }

    /** Normaliza una fecha a dd/mm/aaaa. Acepta dd/mm/aaaa, d/m/aa, aaaa-mm-dd, Date */
    function fechaDDMMAAAA(valor) {
        if (!valor) return '';
        if (valor instanceof Date && !isNaN(valor)) {
            return [valor.getDate(), valor.getMonth() + 1].map(x => String(x).padStart(2, '0')).join('/') + '/' + valor.getFullYear();
        }
        const s = String(valor).trim();
        let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (m) {
            let anio = m[3].length === 2 ? '20' + m[3] : m[3];
            return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${anio}`;
        }
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
        return '';
    }

    global.SigedFormatos = {
        normHeader,
        mapearColumnas,
        parseCSV,
        decodificarBuffer,
        desdeMatriz,
        leerArchivo,
        construirEntradas,
        nombreDeFila,
        descargarPlanilla,
        descargarBlob,
        aCSV,
        nombreArchivoSeguro,
        notaNumero,
        fechaDDMMAAAA,
        tieneXLSX: () => !!global.XLSX
    };
})(typeof window !== 'undefined' ? window : globalThis);
