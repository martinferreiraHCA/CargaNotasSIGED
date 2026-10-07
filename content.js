// ========== CONTENT SCRIPT DE SIGED ==========
// Se inyecta en todas las páginas de SIGED. Detecta automáticamente en qué
// página está el docente y muestra un panel flotante con las acciones que
// corresponden a esa página:
//
//   • Libro del Profesor .......... descargar plantilla del grupo (Excel/CSV)
//   • Evaluaciones (escritos, parciales, etc.) .. exportar / importar notas
//   • Pasaje de calificaciones boletín .......... exportar / importar notas y juicios
//
// Depende de shared/matching.js, shared/formatos.js y lib/xlsx.full.min.js
// (se cargan antes según manifest.json).

(function () {
    'use strict';

    if (window.__sigedCargaNotasInstalado) return;
    window.__sigedCargaNotasInstalado = true;

    const M = window.SigedMatching;
    const F = window.SigedFormatos;
    const D = window.SigedDetalle;
    const C = window.SigedCorrector;
    const UMBRAL_MATCH = 0.70;
    const MAX_FILAS = 2000;

    console.log('✅ Asistente de SIGED: content script cargado en', location.href);

    // =====================================================================
    //  Utilidades DOM
    // =====================================================================
    const $id = (id) => document.getElementById(id);
    const idx4 = (i) => String(i).padStart(4, '0');

    function textoDe(el) {
        if (!el) return '';
        if (el.tagName === 'SELECT') {
            const op = el.options[el.selectedIndex];
            return op ? (op.text || '').trim() : '';
        }
        if ('value' in el && el.tagName !== 'SPAN' && el.tagName !== 'DIV') return String(el.value || '').trim();
        return String(el.innerText || el.textContent || '').trim();
    }

    function esVisible(el) {
        return !!(el && el.offsetParent !== null);
    }

    function disparar(el, eventos) {
        eventos.forEach(e => {
            try { el.dispatchEvent(new Event(e, { bubbles: true })); } catch (err) { /* ignorar */ }
        });
    }

    function escapeHtml(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function debounce(fn, ms) {
        let t = null;
        return function () {
            clearTimeout(t);
            t = setTimeout(fn, ms);
        };
    }

    /** Busca el primer texto no vacío entre una lista de ids (inputs o spans) */
    function primerTexto(ids) {
        for (const id of ids) {
            const t = textoDe($id(id));
            if (t) return t;
        }
        return '';
    }

    /** Texto del título de la página de SIGED (sin el prefijo "LIBRETA:") */
    function tituloPagina() {
        const t = primerTexto(['TXTTITULO', 'span_TXTTITULO']);
        return t.replace(/^\s*LIBRETA\s*:\s*/i, '').trim();
    }

    /** Limpia la descripción larga de la libreta: quita la evaluación y los períodos entre paréntesis */
    function limpiarLibreta(s, evaluacion) {
        let t = String(s || '').replace(/\([^)]*\)/g, ' ');
        if (evaluacion) {
            const pos = t.indexOf(' - ' + evaluacion);
            if (pos > 0) t = t.slice(0, pos);
        }
        return t.replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
    }

    // =====================================================================
    //  Escritura de valores en controles de GeneXus (SIGED)
    // =====================================================================

    /** Devuelve la <option> del select que corresponde a la nota pedida (sin modificar nada) */
    function resolverOpcion(select, valor) {
        if (!select) return { ok: false, motivo: 'no hay campo de nota en esta fila' };
        const v = String(valor === null || valor === undefined ? '' : valor).trim();
        if (!v) return { ok: false, motivo: 'nota vacía' };
        const opciones = Array.from(select.options);
        const nv = M.normalizeText(v);

        let op = opciones.find(o => o.value.trim() === v)
              || opciones.find(o => nv && M.normalizeText(o.text) === nv);

        if (!op) {
            const n = F.notaNumero(v);
            if (n !== null) {
                const redondeada = String(Math.round(n));
                op = opciones.find(o => o.value.trim() === redondeada)
                  || opciones.find(o => o.text.trim() === redondeada);
                if (!op) {
                    // Opciones numéricas: ajustar al rango disponible
                    const numericas = opciones.filter(o => o.value.trim() !== '' && !isNaN(parseFloat(o.value)));
                    if (numericas.length) {
                        const valores = numericas.map(o => parseFloat(o.value));
                        const ajustada = Math.max(Math.min(...valores), Math.min(Math.max(...valores), Math.round(n)));
                        op = numericas.find(o => parseFloat(o.value) === ajustada);
                    }
                }
            }
        }

        if (!op) {
            const validas = opciones.map(o => o.text.trim()).filter(Boolean).join(', ');
            return { ok: false, motivo: `"${v}" no es una nota válida (opciones: ${validas || 'ninguna'})` };
        }
        return { ok: true, opcion: op, texto: (op.text || '').trim() || op.value };
    }

    /** Calificación tipo semáforo (Calificaciones Libreta con "Tipo de calificación: Semáforo") */
    const SEMAFORO = { V: 'Verde', A: 'Amarillo', R: 'Rojo', S: 'Sin calificar' };

    function resolverSemaforo(radios, valor) {
        const v = M.normalizeText(valor);
        if (!v) return { ok: false, motivo: 'nota vacía' };
        const letra = { V: 'V', VERDE: 'V', A: 'A', AMARILLO: 'A', R: 'R', ROJO: 'R', S: 'S', SIN: 'S', 'SIN CALIFICAR': 'S' }[v];
        const radio = letra ? radios.find(r => r.value === letra) : null;
        if (!radio) return { ok: false, motivo: `"${valor}" no es un valor de semáforo (usar Verde, Amarillo o Rojo)` };
        return { ok: true, radio, texto: SEMAFORO[letra] };
    }

    function escribirSelect(select, valor) {
        const r = resolverOpcion(select, valor);
        if (!r.ok) return r;
        if (select.value !== r.opcion.value) {
            select.value = r.opcion.value;
            disparar(select, ['change', 'blur']);
            r.cambiado = true;
        }
        return r;
    }

    function escribirTexto(el, valor) {
        if (!el) return { ok: false, motivo: 'campo no encontrado' };
        const max = parseInt(el.getAttribute('maxlength') || '0', 10);
        let v = String(valor === null || valor === undefined ? '' : valor);
        let truncado = false;
        if (max > 0 && v.length > max) { v = v.slice(0, max); truncado = true; }
        if (el.value === v) return { ok: true, cambiado: false };
        el.value = v;
        disparar(el, ['input', 'change', 'blur']);
        return { ok: true, cambiado: true, truncado };
    }

    function pintarFila(tr, color) {
        if (!tr) return;
        tr.style.transition = 'background-color 0.4s';
        tr.style.backgroundColor = color;
    }

    // =====================================================================
    //  Adaptadores de página
    // =====================================================================

    /** Recorre la grilla estándar de SIGED (span_vFALUNOMCOM_0001, 0002, ...) */
    function leerGrilla(construirFila) {
        const filas = [];
        for (let i = 1; i <= MAX_FILAS; i++) {
            const idx = idx4(i);
            const span = $id('span_vFALUNOMCOM_' + idx);
            if (!span) break;
            const nombre = textoDe(span);
            if (!nombre) continue;
            const fila = construirFila(idx, span, nombre);
            fila.idx = idx;
            fila.nombre = nombre;
            fila.tok = M.tokens(nombre);
            filas.push(fila);
        }
        return filas;
    }

    const PAGINAS = {
        // ---------------- Evaluaciones (Calificaciones Libreta: orales, escritos, parciales, etc.) ----------------
        evaluacion: {
            clave: 'evaluacion',
            etiqueta: 'Evaluaciones (ingreso de notas)',
            icono: '📝',
            detectar: () => !!$id('vCALIFCOD_0001'),
            contexto() {
                const titulo = tituloPagina();
                // Título real: "Calificaciones (Orales, Escritos, O. Actividades) - CS FÍSICO-QUÍMICA - Grupo 7-EBI 3 - CS FÍSICO-QUÍMICA Doc. FERREIRA Martín."
                let libreta = '';
                const mGrupo = titulo.match(/Grupo\s+(.+?)\s+Doc\.?/i) || titulo.match(/Grupo\s+(.+)$/i);
                if (mGrupo) libreta = mGrupo[1].trim();
                if (!libreta) libreta = limpiarLibreta(primerTexto(['vDESCLARGA', 'span_vDESCLARGA', 'vLIBDSC', 'span_vLIBDSC'])) || titulo;

                // Tipo de evaluación (Escritos, Parcial, Orales, ...), fecha y reunión a la que se asigna
                const tipo = primerTexto(['vTDLIBID', 'vTDLIBID2', 'span_vTDLIBID']);
                let fecha = textoDe($id('span_CTLLIBDFEC_0001'));
                if (!/\d/.test(fecha)) fecha = textoDe($id('vLIBDFEC'));
                if (!/\d/.test(fecha)) fecha = '';
                const reunion = textoDe($id('span_vREUCODIMPGRID_0001')) || primerTexto(['vREUCODIMP', 'vREUCODIMP2']);
                const evaluacion = [tipo, fecha].filter(Boolean).join(' ');
                return { libreta, evaluacion, tipo, fecha, reunion, titulo };
            },
            leerFilas() {
                return leerGrilla((idx, span) => {
                    const select = $id('vCALIFCOD_' + idx);
                    const textarea = $id('vLIBDCOMENTARIO_' + idx);
                    const radios = Array.from(document.querySelectorAll('input[type="radio"][name="vRBSEMAFORO_' + idx + '"]'));
                    const semaforoVisible = radios.length > 0 && radios.some(r => esVisible(r) || esVisible(r.closest('label')) || esVisible(r.closest('span')));
                    const selectVisible = esVisible(select);
                    const marcado = radios.find(r => r.checked);
                    const usaSemaforo = semaforoVisible && !selectVisible;
                    return {
                        select, textarea, radios, usaSemaforo,
                        nro: textoDe($id('span_CTLINSGACTNROLISTA_' + idx)),
                        reunion: textoDe($id('span_vREUCODIMPGRID_' + idx)),
                        tr: (select || span).closest('tr'),
                        nota: usaSemaforo ? (marcado ? SEMAFORO[marcado.value] || marcado.value : '') : textoDe(select),
                        comentario: textarea ? textarea.value : ''
                    };
                });
            },
            columnasExport(filas) {
                return ['N°', 'Estudiante', 'Nota', 'Comentario'];
            },
            filaExport(f, i) {
                return [f.nro || (i + 1), f.nombre, f.nota, f.comentario];
            },
            campos: { comentario: 'Comentario' },
            resolver(fila, nota) {
                if (fila.usaSemaforo) return resolverSemaforo(fila.radios, nota);
                return resolverOpcion(fila.select, nota);
            },
            aplicar(fila, entrada) {
                const cambios = [];
                const errores = [];
                if (entrada.nota) {
                    if (fila.usaSemaforo) {
                        const r = resolverSemaforo(fila.radios, entrada.nota);
                        if (r.ok) {
                            if (!r.radio.checked) r.radio.click();
                            cambios.push('semáforo ' + r.texto);
                        } else errores.push(r.motivo);
                    } else {
                        const r = escribirSelect(fila.select, entrada.nota);
                        if (r.ok) cambios.push('nota ' + r.texto); else errores.push(r.motivo);
                    }
                }
                if (entrada.comentario && fila.textarea) {
                    const r = escribirTexto(fila.textarea, entrada.comentario);
                    if (r.ok) cambios.push('comentario'); else errores.push(r.motivo);
                } else if (entrada.comentario && !fila.textarea) {
                    errores.push('esta fila no tiene campo de comentario');
                }
                return { cambios, errores };
            }
        },

        // ---------------- Pasaje de calificaciones boletín por libreta ----------------
        boletin: {
            clave: 'boletin',
            etiqueta: 'Pasaje de calificaciones al boletín',
            icono: '📋',
            detectar: () => !!$id('vCALIFXREUCALIFCOD_0001'),
            contexto() {
                const titulo = tituloPagina();
                const evaluacion = primerTexto(['vREUDSC', 'span_vREUDSC']) || textoDe($id('span_vREUCOD_0001'));
                const libreta = limpiarLibreta(primerTexto(['vDESCLARGA', 'span_vDESCLARGA']), evaluacion) || titulo;
                return { libreta, evaluacion, titulo };
            },
            leerFilas() {
                return leerGrilla((idx, span) => {
                    const select = $id('vCALIFXREUCALIFCOD_' + idx);
                    const textarea = $id('vCALIFXREUJUICIO_' + idx);
                    const fecha = $id('vCALIFXREUFEC_' + idx);
                    const conducta = $id('vCALIFXREUCONCALIFCOD_' + idx);
                    return {
                        select, textarea, fecha, conducta,
                        nro: textoDe($id('span_vINSGACTNROLISTA_' + idx)),
                        tr: (select || span).closest('tr'),
                        nota: textoDe(select),
                        comentario: textarea ? textarea.value : '',
                        fechaValor: fecha ? String(fecha.value || '').replace(/[\s\/]+$/, '').trim() : '',
                        conductaValor: textoDe(conducta),
                        juicioVisible: esVisible(textarea),
                        fechaVisible: esVisible(fecha),
                        conductaVisible: esVisible(conducta) && conducta.options.length > 1
                    };
                });
            },
            columnasExport(filas) {
                const cols = ['N°', 'Estudiante', 'Nota', 'Juicio'];
                if (filas.some(f => f.fechaVisible)) cols.push('Fecha');
                if (filas.some(f => f.conductaVisible)) cols.push('Conducta');
                return cols;
            },
            filaExport(f, i, cols) {
                const fila = [f.nro || (i + 1), f.nombre, f.nota, f.comentario];
                if (cols.includes('Fecha')) fila.push(/\d/.test(f.fechaValor) ? f.fechaValor : '');
                if (cols.includes('Conducta')) fila.push(f.conductaValor);
                return fila;
            },
            campos: { comentario: 'Juicio' },
            aplicar(fila, entrada) {
                const cambios = [];
                const errores = [];
                if (entrada.nota) {
                    const r = escribirSelect(fila.select, entrada.nota);
                    if (r.ok) cambios.push('nota ' + r.texto); else errores.push(r.motivo);
                }
                if (entrada.comentario) {
                    if (fila.textarea && fila.juicioVisible) {
                        const r = escribirTexto(fila.textarea, entrada.comentario);
                        if (r.ok) cambios.push('juicio' + (r.truncado ? ' (recortado al máximo permitido)' : ''));
                        else errores.push(r.motivo);
                    } else {
                        errores.push('esta reunión no permite juicio por asignatura');
                    }
                }
                if (entrada.fecha && fila.fecha && fila.fechaVisible) {
                    const f = F.fechaDDMMAAAA(entrada.fecha);
                    if (f) { escribirTexto(fila.fecha, f); cambios.push('fecha ' + f); }
                    else errores.push(`fecha "${entrada.fecha}" no reconocida (usar dd/mm/aaaa)`);
                }
                if (entrada.conducta && fila.conducta && fila.conductaVisible) {
                    const r = escribirSelect(fila.conducta, entrada.conducta);
                    if (r.ok) cambios.push('conducta ' + r.texto); else errores.push('conducta: ' + r.motivo);
                }
                return { cambios, errores };
            }
        },

        // ---------------- Libro del Profesor ----------------
        libro: {
            clave: 'libro',
            etiqueta: 'Libro del Profesor',
            icono: '📚',
            detectar: () => !!$id('vLIBIDSELEC') && (/Libro del Profesor/i.test(document.title) || !!document.querySelector('.ui.cards .card a.header')),
            contexto() {
                const titulo = tituloPagina();
                const sel = $id('vLIBIDSELEC');
                const seleccion = sel && sel.selectedIndex > 0 ? textoDe(sel) : '';
                return { libreta: titulo || seleccion, evaluacion: '', titulo };
            },
            leerFilas() {
                const filas = [];
                document.querySelectorAll('.ui.cards .card a.header').forEach((a, i) => {
                    const lineas = String(a.innerText || a.textContent || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
                    const apellido = lineas[0] || '';
                    const nombre = lineas.slice(1).join(' ');
                    const completo = `${apellido} ${nombre}`.trim();
                    if (!completo) return;
                    filas.push({ idx: idx4(i + 1), nombre: completo, apellido, nombrePila: nombre, tok: M.tokens(completo), nota: '', comentario: '' });
                });
                return filas;
            },
            columnasExport() {
                return ['N°', 'Estudiante', 'Nota', 'Comentario'];
            },
            filaExport(f, i) {
                return [i + 1, f.nombre, '', ''];
            },
            campos: { comentario: 'Comentario' },
            aplicar: null // en esta página no se cargan notas
        },

        // ---------------- Orales, Escritos y O. Actividades (detalle por alumno) ----------------
        detalle: {
            clave: 'detalle',
            etiqueta: 'Orales, Escritos y O. Actividades',
            icono: '📊',
            detectar: () => !!D && D.detectar(),
            contexto() {
                const titulo = tituloPagina();
                const alumnos = estado.filas || [];
                const curso = alumnos.length ? alumnos[0].curso : '';
                return { libreta: curso, evaluacion: '', titulo, totalLibreta: D.totalAlumnosLibreta() };
            },
            leerFilas() {
                return D.leerAlumnos().map(a => Object.assign(a, { tok: M.tokens(a.nombre) }));
            },
            columnasExport() { return []; },
            filaExport() { return []; },
            campos: { comentario: 'Comentario' },
            aplicar: null
        },

        // ---------------- Corrector por curso (un alumno con todas sus materias) ----------------
        corrector: {
            clave: 'corrector',
            etiqueta: 'Corrector por curso',
            icono: '🪪',
            detectar: () => !!C && C.detectar(),
            contexto() {
                const a = estado.filas[0];
                return { libreta: a ? a.periodo : '', evaluacion: '', titulo: tituloPagina() };
            },
            leerFilas() {
                const a = C.leerAlumno();
                return a.nombre ? [Object.assign(a, { tok: M.tokens(a.nombre) })] : [];
            },
            columnasExport() { return []; },
            filaExport() { return []; },
            campos: { comentario: 'Juicio' },
            aplicar: null
        },

        // ---------------- Cierre de promedios por alumno (un alumno por vez, juicios por reunión) ----------------
        cierre: {
            clave: 'cierre',
            etiqueta: 'Cierre de promedios por alumno',
            icono: '🗂️',
            detectar: () => !!D && D.detectarCierre(),
            contexto() {
                const enlaces = D.enlacesAlumnos();
                const alumno = estado.filas[0];
                return {
                    libreta: D.libretaCierre() || (alumno ? alumno.curso : ''),
                    evaluacion: '',
                    titulo: tituloPagina(),
                    totalLibreta: enlaces.length,
                    nroActual: alumno ? alumno.nro : ''
                };
            },
            leerFilas() {
                const a = D.leerAlumnoCierre();
                return a.nombre ? [Object.assign(a, { tok: M.tokens(a.nombre) })] : [];
            },
            columnasExport() { return []; },
            filaExport() { return []; },
            campos: { comentario: 'Juicio' },
            aplicar: null
        }
    };

    function detectarPagina() {
        if (PAGINAS.corrector.detectar()) return PAGINAS.corrector;
        // El cierre por alumno comparte campos con el boletín: se prueba primero
        if (PAGINAS.cierre.detectar()) return PAGINAS.cierre;
        if (PAGINAS.boletin.detectar()) return PAGINAS.boletin;
        if (PAGINAS.evaluacion.detectar()) return PAGINAS.evaluacion;
        if (PAGINAS.libro.detectar()) return PAGINAS.libro;
        if (PAGINAS.detalle.detectar()) return PAGINAS.detalle;
        return null;
    }

    // =====================================================================
    //  Estado del panel
    // =====================================================================
    const estado = {
        pagina: null,
        contexto: { libreta: '', evaluacion: '', titulo: '' },
        filas: [],
        archivo: null,        // datos del archivo leído (SigedFormatos.leerArchivo)
        actividad: '',
        tipo: 'individual',
        entradas: [],
        asignacion: [],       // por fila de SIGED: índice de entrada o -1
        mensaje: null,        // {tipo: 'ok'|'error'|'aviso'|'info', texto}
        resultado: null,      // resumen tras aplicar
        alumnoSel: '',        // página de detalle: idx del alumno a exportar ('' = todos los visibles)
        actividadSel: '',     // página de detalle: evaluación elegida para copiar (clave tipo|fecha)
        comparacionSel: '',   // corrector / cierre: evaluación anterior con la que se compara ('' = automática)
        modoCierre: 'ficha',  // cierre: 'ficha' (ver info del alumno) o 'exportar' (recorrer / Excel)
        colapsado: false
    };

    try { estado.colapsado = localStorage.getItem('sigedCargaNotas.colapsado') === '1'; } catch (e) { /* ignorar */ }
    try { estado.modoCierre = localStorage.getItem('sigedCargaNotas.modoCierre') || 'ficha'; } catch (e) { /* ignorar */ }

    function refrescarPagina() {
        const pagina = detectarPagina();
        const cambioPagina = (pagina && pagina.clave) !== (estado.pagina && estado.pagina.clave);
        estado.pagina = pagina;
        const firmaAntes = estado.firmaFilas || '';
        estado.filas = pagina ? pagina.leerFilas() : [];
        estado.contexto = pagina ? pagina.contexto() : { libreta: '', evaluacion: '', titulo: tituloPagina() };
        estado.firmaFilas = estado.filas.map(f => f.nombre).join('|');
        const cambiaronAlumnos = firmaAntes !== estado.firmaFilas;
        if (cambioPagina || cambiaronAlumnos) {
            estado.resultado = null;
            if (cambioPagina) estado.mensaje = null;
            if (estado.archivo) recalcularAsignacion();
        }
        return cambioPagina || cambiaronAlumnos;
    }

    // =====================================================================
    //  Importación
    // =====================================================================
    async function cargarArchivo(file) {
        refrescarPagina(); // releer la grilla por si SIGED cambió algo sin que lo notara el observador
        estado.resultado = null;
        estado.mensaje = { tipo: 'info', texto: 'Leyendo archivo…' };
        render();
        try {
            const datos = await F.leerArchivo(file);
            const input = raiz.getElementById('archivo');
            if (input) input.value = ''; // permite volver a elegir el mismo archivo
            estado.archivo = datos;
            estado.actividad = datos.actividades.length === 1 ? datos.actividades[0] : '';
            estado.tipo = 'individual';
            estado.mensaje = datos.advertencia ? { tipo: 'aviso', texto: datos.advertencia } : null;
            recalcularAsignacion();
        } catch (err) {
            console.error('❌ Error leyendo archivo:', err);
            estado.archivo = null;
            estado.entradas = [];
            estado.asignacion = [];
            estado.mensaje = { tipo: 'error', texto: 'No se pudo leer el archivo: ' + err.message };
        }
        render();
    }

    function recalcularAsignacion() {
        if (!estado.archivo) { estado.entradas = []; estado.asignacion = []; return; }
        const necesitaActividad = estado.archivo.actividades.length > 1 && !estado.actividad;
        if (necesitaActividad) {
            estado.entradas = [];
            estado.asignacion = estado.filas.map(() => -1);
            return;
        }
        estado.entradas = F.construirEntradas(estado.archivo, { actividad: estado.actividad, tipo: estado.tipo });
        const asignado = M.asignarUnico(estado.filas, estado.entradas, UMBRAL_MATCH);
        estado.asignacion = asignado.map(a => (a ? a.indice : -1));
        estado.scores = asignado.map(a => (a ? a.score : 0));
    }

    function quitarArchivo() {
        estado.archivo = null;
        estado.entradas = [];
        estado.asignacion = [];
        estado.scores = [];
        estado.resultado = null;
        estado.mensaje = null;
        const input = raiz.getElementById('archivo');
        if (input) input.value = '';
        render();
    }

    function aplicarNotas() {
        if (refrescarPagina()) { render(); return; } // la grilla cambió: mostrar la vista previa actualizada antes de cargar
        const pagina = estado.pagina;
        if (!pagina || !pagina.aplicar) return;
        const usados = new Map();
        estado.asignacion.forEach((ei, fi) => { if (ei >= 0) usados.set(ei, (usados.get(ei) || 0) + 1); });

        const resultado = { aplicados: 0, sinAsignar: 0, errores: [], detalles: [] };
        estado.filas.forEach((fila, fi) => {
            const ei = estado.asignacion[fi];
            if (ei < 0 || !estado.entradas[ei]) {
                resultado.sinAsignar++;
                return;
            }
            const entrada = estado.entradas[ei];
            const r = pagina.aplicar(fila, entrada);
            if (r.errores.length === 0 && r.cambios.length > 0) {
                resultado.aplicados++;
                pintarFila(fila.tr, '#e8f5e9');
            } else if (r.errores.length > 0) {
                resultado.errores.push(`${fila.nombre}: ${r.errores.join('; ')}`);
                pintarFila(fila.tr, r.cambios.length ? '#fff8e1' : '#ffebee');
                if (r.cambios.length) resultado.aplicados++;
            }
            resultado.detalles.push({ nombre: fila.nombre, cambios: r.cambios, errores: r.errores });
        });
        const duplicados = Array.from(usados.entries()).filter(([, n]) => n > 1).length;
        if (duplicados) resultado.errores.unshift(`${duplicados} entrada(s) del archivo fueron asignadas a más de un alumno. Revisá la lista.`);

        estado.resultado = resultado;
        estado.mensaje = null;
        // Las notas guardadas en el asistente se consumen al cargarlas: no vuelven a ofrecerse
        if (estado.archivo && estado.archivo.guardadas && resultado.aplicados > 0) {
            try { localStorage.removeItem(CLAVE_GUARDADAS); } catch (e) { /* ignorar */ }
            estado.mensaje = { tipo: 'info', texto: 'Las notas guardadas ya se cargaron acá y se quitaron del asistente.' };
        }
        console.log('📊 Resultado de la carga:', resultado);
        render();
    }

    function irAGuardar() {
        const btn = $id('BTNGUARDAR') || document.querySelector('input[type="button"][value="Guardar"], input[type="submit"][value="Guardar"], button.BtnGuardar');
        if (!btn) {
            estado.mensaje = { tipo: 'aviso', texto: 'No encontré el botón Guardar de SIGED. Buscalo en la página y hacé clic para confirmar.' };
            render();
            return;
        }
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const original = btn.style.boxShadow;
        btn.style.boxShadow = '0 0 0 4px #27ae60';
        setTimeout(() => { btn.style.boxShadow = original; }, 3000);
    }

    // =====================================================================
    //  Exportación
    // =====================================================================
    function exportar(formato) {
        const pagina = estado.pagina;
        if (!pagina) return;
        refrescarPagina();
        if (estado.filas.length === 0) {
            estado.mensaje = { tipo: 'aviso', texto: 'No hay alumnos en la página para exportar.' };
            render();
            return;
        }
        const cols = pagina.columnasExport(estado.filas);
        const filas = estado.filas.map((f, i) => pagina.filaExport(f, i, cols));
        const ctx = estado.contexto;
        const hoy = new Date();
        const fechaTxt = hoy.toLocaleDateString('es-UY');
        const info = [
            ['Planilla generada por', 'Asistente de SIGED (extensión del navegador)'],
            ['Página de origen', pagina.etiqueta],
            ['Libreta', ctx.libreta || ''],
            ['Evaluación', ctx.evaluacion || ''],
            ['Asignada a', ctx.reunion || ''],
            ['Alumnos', String(estado.filas.length)],
            ['Fecha de exportación', fechaTxt],
            ['', ''],
            ['Cómo usar esta planilla', 'Completá o modificá la columna "Nota" (y "' + pagina.campos.comentario + '" si querés). ' +
                'No cambies los nombres de los estudiantes. Luego entrá en SIGED a la página donde querés cargar las notas ' +
                '(Evaluaciones o Pasaje de calificaciones al boletín) y usá el botón "Importar notas desde archivo".'],
            ['Notas válidas', 'Números enteros según la escala de la evaluación (por ejemplo 1 a 10). Si ponés decimales se redondean.']
        ];
        const nombreBase = [
            pagina.clave === 'libro' ? 'Plantilla' : 'Notas',
            ctx.libreta,
            ctx.evaluacion,
            hoy.toISOString().slice(0, 10)
        ];
        try {
            const nombre = F.descargarPlanilla({
                encabezados: cols,
                filas,
                info,
                nombreBase,
                formato,
                anchos: cols.map(c => (c === 'Estudiante' ? 38 : (c === 'Comentario' || c === 'Juicio') ? 60 : 12))
            });
            estado.mensaje = { tipo: 'ok', texto: `Archivo descargado: ${nombre}` };
        } catch (err) {
            console.error('❌ Error exportando:', err);
            estado.mensaje = { tipo: 'error', texto: 'No se pudo generar el archivo: ' + err.message };
        }
        render();
    }

    /** Exporta el detalle por alumno (página "Orales, Escritos y O. Actividades") a un Excel con varias hojas */
    function exportarDetalle() {
        refrescarPagina();
        let alumnos = estado.filas;
        if (estado.alumnoSel) alumnos = alumnos.filter(a => a.idx === estado.alumnoSel);
        if (alumnos.length === 0) {
            estado.mensaje = { tipo: 'aviso', texto: 'No hay alumnos visibles para exportar.' };
            render();
            return;
        }
        const ctx = estado.contexto;
        const hoy = new Date();
        const sinDetalle = alumnos.filter(a => !a.detalleCargado).length;
        const { hojas } = D.construirHojas(alumnos);
        const info = [
            ['Planilla generada por', 'Asistente de SIGED (extensión del navegador)'],
            ['Página de origen', PAGINAS.detalle.etiqueta],
            ['Curso / Grupo / Asignatura', ctx.libreta || ''],
            ['Alumnos exportados', String(alumnos.length) + (ctx.totalLibreta ? ' de ' + ctx.totalLibreta + ' de la libreta' : '')],
            ['Fecha de exportación', hoy.toLocaleDateString('es-UY')],
            ['', ''],
            ['Hoja Notas', 'Una fila por evaluación: período en que SIGED la contabiliza, fecha, tipo, nota, comentario y quién la registró.'],
            ['Hoja Promedios', 'Una fila por alumno y período: notas por tipo (Orales, Escritas, O. Act), Rendimiento (R) e inasistencias (J, NJ, fictas).'],
            ['Hoja Resumen', 'Una fila por alumno: datos, calificaciones de evaluaciones semestrales y rendimiento de cada período.'],
            ['Juicios', 'Esta página de SIGED no muestra los juicios de las reuniones. Para exportarlos, entrá a "Pasaje de calificaciones boletín por libreta", elegí la reunión y usá "Descargar notas de esta página".']
        ];
        if (sinDetalle) info.push(['Atención', `${sinDetalle} alumno(s) no tenían el detalle cargado en SIGED (usá "Mostrar detalle (todos)" antes de exportar).`]);
        const nombreBase = ['Detalle', alumnos.length === 1 ? alumnos[0].nombre : ctx.libreta, hoy.toISOString().slice(0, 10)];
        try {
            const nombre = F.descargarLibro({ hojas, info, nombreBase });
            estado.mensaje = { tipo: 'ok', texto: `Archivo descargado: ${nombre}` + (sinDetalle ? ` (${sinDetalle} alumno(s) sin detalle cargado)` : '') };
        } catch (err) {
            console.error('❌ Error exportando detalle:', err);
            estado.mensaje = { tipo: 'error', texto: 'No se pudo generar el archivo: ' + err.message };
        }
        render();
    }

    // =====================================================================
    //  Recorrido automático de "Cierre de promedios por alumno"
    //  La página muestra un alumno por vez y cada cambio de alumno recarga la
    //  página, así que el avance se guarda en sessionStorage (vive en la pestaña).
    // =====================================================================
    const CLAVE_RECORRIDO = 'sigedCargaNotas.recorridoCierre';
    const RECORRIDO_MAX_MIN = 60;

    function leerRecorrido() {
        try {
            const r = JSON.parse(sessionStorage.getItem(CLAVE_RECORRIDO) || 'null');
            if (!r) return null;
            if (Date.now() - (r.inicio || 0) > RECORRIDO_MAX_MIN * 60 * 1000) { sessionStorage.removeItem(CLAVE_RECORRIDO); return null; }
            return r;
        } catch (e) { return null; }
    }

    function guardarRecorrido(r) {
        try {
            if (r) sessionStorage.setItem(CLAVE_RECORRIDO, JSON.stringify(r));
            else sessionStorage.removeItem(CLAVE_RECORRIDO);
        } catch (e) {
            console.error('No se pudo guardar el avance del recorrido', e);
        }
    }

    function iniciarRecorrido() {
        refrescarPagina();
        const enlaces = D.enlacesAlumnos();
        if (enlaces.length === 0) {
            estado.mensaje = { tipo: 'aviso', texto: 'No encontré la lista de alumnos (números 1, 2, 3…) en la página.' };
            render();
            return;
        }
        const recorrido = {
            inicio: Date.now(),
            libreta: estado.contexto.libreta || '',
            total: enlaces.length,
            pendientes: enlaces.filter(e => !e.actual && e.href).map(e => ({ nro: e.nro, href: e.href })),
            hechos: [],
            errores: [],
            estado: 'activo'
        };
        guardarRecorrido(recorrido);
        continuarRecorrido();
    }

    /** Se llama al cargar cada página: toma el alumno visible y pasa al siguiente */
    function continuarRecorrido() {
        const recorrido = leerRecorrido();
        if (!recorrido || recorrido.estado !== 'activo') return false;
        if (!estado.pagina || estado.pagina.clave !== 'cierre' || estado.filas.length === 0) {
            recorrido.estado = 'error';
            recorrido.errores.push('La página que se abrió no es "Cierre de promedios por alumno". Se detuvo el recorrido.');
            guardarRecorrido(recorrido);
            render();
            return true;
        }
        const alumno = estado.filas[0];
        if (!recorrido.hechos.some(h => h.nro === alumno.nro && h.nombre === alumno.nombre)) {
            recorrido.hechos.push(alumno);
        }
        recorrido.pendientes = recorrido.pendientes.filter(p => p.nro !== alumno.nro);
        if (recorrido.pendientes.length === 0) {
            recorrido.estado = 'listo';
            guardarRecorrido(recorrido);
            terminarRecorrido(recorrido);
            return true;
        }
        guardarRecorrido(recorrido);
        render();
        const siguiente = recorrido.pendientes[0];
        setTimeout(() => { window.location.href = siguiente.href; }, 400);
        return true;
    }

    function terminarRecorrido(recorrido) {
        const alumnos = recorrido.hechos.slice().sort((a, b) => (parseInt(a.nro, 10) || 0) - (parseInt(b.nro, 10) || 0));
        const nombre = descargarExcelCierre(alumnos, recorrido.libreta, recorrido.errores);
        guardarRecorrido(null);
        estado.mensaje = nombre
            ? { tipo: 'ok', texto: `✅ Recorrido terminado: ${alumnos.length} de ${recorrido.total} alumnos exportados. Archivo: ${nombre}` }
            : { tipo: 'error', texto: 'El recorrido terminó pero no se pudo generar el archivo.' };
        estado.ultimoRecorrido = { alumnos: alumnos.length, total: recorrido.total };
        setColapsado(false);
        render();
    }

    function detenerRecorrido(descargar) {
        const recorrido = leerRecorrido();
        guardarRecorrido(null);
        if (recorrido && descargar && recorrido.hechos.length) {
            const alumnos = recorrido.hechos.slice().sort((a, b) => (parseInt(a.nro, 10) || 0) - (parseInt(b.nro, 10) || 0));
            const nombre = descargarExcelCierre(alumnos, recorrido.libreta, ['Recorrido detenido antes de terminar: faltan ' + recorrido.pendientes.length + ' alumno(s).']);
            estado.mensaje = { tipo: 'aviso', texto: `Recorrido detenido. Se exportaron ${alumnos.length} alumno(s) en ${nombre}.` };
        } else {
            estado.mensaje = { tipo: 'info', texto: 'Recorrido cancelado.' };
        }
        render();
    }

    function descargarExcelCierre(alumnos, libreta, avisos) {
        const hoy = new Date();
        const { hojas } = D.construirHojas(alumnos);
        const info = [
            ['Planilla generada por', 'Asistente de SIGED (extensión del navegador)'],
            ['Página de origen', PAGINAS.cierre.etiqueta],
            ['Libreta', libreta || ''],
            ['Alumnos exportados', String(alumnos.length)],
            ['Fecha de exportación', hoy.toLocaleDateString('es-UY')],
            ['', ''],
            ['Hoja Juicios', 'Un alumno por fila: para cada reunión, el rendimiento y el juicio de asignatura (y el juicio de reunión si existe).'],
            ['Hoja Juicios (lista)', 'Una fila por alumno y reunión con rendimiento, calidad, fecha y juicios.'],
            ['Hoja Notas', 'Una fila por evaluación: período, fecha, tipo, nota, comentario y quién la registró.'],
            ['Hoja Promedios', 'Una fila por alumno y período: notas por tipo, Rendimiento (R) e inasistencias.'],
            ['Hoja Resumen', 'Una fila por alumno: datos, semestrales y rendimiento por período.']
        ];
        (avisos || []).forEach(a => info.push(['Atención', a]));
        try {
            return F.descargarLibro({
                hojas, info,
                nombreBase: ['Juicios', alumnos.length === 1 ? alumnos[0].nombre : libreta, hoy.toISOString().slice(0, 10)]
            });
        } catch (err) {
            console.error('❌ Error exportando cierre:', err);
            estado.mensaje = { tipo: 'error', texto: 'No se pudo generar el archivo: ' + err.message };
            return '';
        }
    }

    function exportarCierreActual() {
        refrescarPagina();
        if (estado.filas.length === 0) {
            estado.mensaje = { tipo: 'aviso', texto: 'No hay un alumno visible en la página.' };
            render();
            return;
        }
        const nombre = descargarExcelCierre(estado.filas, estado.contexto.libreta, []);
        if (nombre) estado.mensaje = { tipo: 'ok', texto: `Archivo descargado: ${nombre}` };
        render();
    }

    // =====================================================================
    //  "Notas guardadas en el asistente": copiar una evaluación de una página
    //  y cargarla en otra (por ejemplo, de Escritos a Parcial) sin archivos.
    //  Se guarda en localStorage del sitio de SIGED (una sola a la vez).
    // =====================================================================
    const CLAVE_GUARDADAS = 'sigedCargaNotas.notasGuardadas';
    const GUARDADAS_MAX_DIAS = 30;

    function leerGuardadas() {
        try {
            const g = JSON.parse(localStorage.getItem(CLAVE_GUARDADAS) || 'null');
            if (!g || !Array.isArray(g.entradas) || !g.entradas.length) return null;
            if (Date.now() - (g.fecha || 0) > GUARDADAS_MAX_DIAS * 86400000) { localStorage.removeItem(CLAVE_GUARDADAS); return null; }
            return g;
        } catch (e) { return null; }
    }

    function guardarNotas(origen, libreta, entradas) {
        const limpias = entradas
            .map(e => ({ nombre: String(e.nombre || '').trim(), nota: String(e.nota || '').trim(), comentario: String(e.comentario || '').trim() }))
            .filter(e => e.nombre && (e.nota || e.comentario));
        if (!limpias.length) {
            estado.mensaje = { tipo: 'aviso', texto: 'No hay notas ni comentarios para guardar.' };
            render();
            return;
        }
        try {
            localStorage.setItem(CLAVE_GUARDADAS, JSON.stringify({ origen, libreta, fecha: Date.now(), entradas: limpias }));
            estado.mensaje = { tipo: 'ok', texto: `📋 Guardado en el asistente: ${origen} (${limpias.length} alumno${limpias.length === 1 ? '' : 's'}). Ahora entrá a la evaluación de destino y el panel te ofrece cargarlas.` };
        } catch (e) {
            estado.mensaje = { tipo: 'error', texto: 'No se pudo guardar en el navegador: ' + e.message };
        }
        render();
    }

    function olvidarGuardadas() {
        try { localStorage.removeItem(CLAVE_GUARDADAS); } catch (e) { /* ignorar */ }
        estado.mensaje = null;
        render();
    }

    /** Usa las notas guardadas como si fueran un archivo importado (misma vista previa y carga) */
    function usarGuardadas() {
        const g = leerGuardadas();
        if (!g) { render(); return; }
        refrescarPagina();
        const filas = g.entradas.map(e => ({ Estudiante: e.nombre, Nota: e.nota, Comentario: e.comentario }));
        estado.archivo = {
            nombreArchivo: '📋 ' + g.origen,
            headers: ['Estudiante', 'Nota', 'Comentario'],
            filas,
            mapa: { estudiante: 'Estudiante', nota: 'Nota', comentario: 'Comentario' },
            formato: 'universal',
            actividades: [],
            requiereTipo: false,
            estudiantes: filas.length,
            guardadas: true
        };
        estado.actividad = '';
        estado.tipo = 'individual';
        estado.resultado = null;
        estado.mensaje = null;
        recalcularAsignacion();
        render();
    }

    function hace(ts) {
        const min = Math.round((Date.now() - ts) / 60000);
        if (min < 1) return 'recién';
        if (min < 60) return `hace ${min} min`;
        const h = Math.round(min / 60);
        if (h < 24) return `hace ${h} h`;
        return `hace ${Math.round(h / 24)} día(s)`;
    }

    /** Tarjeta "Notas guardadas en el asistente" para las páginas de carga */
    function renderGuardadas() {
        const g = leerGuardadas();
        if (!g) return '';
        if (estado.archivo && estado.archivo.guardadas) return '';
        return `<div class="caja" style="border-color:#f0c36d;background:#fffaf0">
                    <div class="tit">📋 Notas guardadas en el asistente</div>
                    <div><b>${escapeHtml(g.origen)}</b><br><span class="ayuda">${g.entradas.length} alumno${g.entradas.length === 1 ? '' : 's'}${g.libreta && !g.origen.includes(g.libreta) ? ' · ' + escapeHtml(g.libreta) : ''} · ${hace(g.fecha)}</span></div>
                    <button class="btn btn-verde" data-act="guardadas-usar"><span class="ic">✅</span><span>Cargar estas notas acá<small>Vas a ver la vista previa antes de confirmar</small></span></button>
                    <div style="text-align:center"><button class="link" data-act="guardadas-olvidar">Ya no las necesito</button></div>
                </div>`;
    }

    /** Evaluaciones de la página de detalle agrupadas por tipo y fecha (para copiar una puntual) */
    function actividadesDetalle() {
        const grupos = new Map();
        estado.filas.forEach(a => (a.evaluaciones || []).forEach(ev => {
            if (!ev.nota && !ev.comentario) return;
            const clave = `${ev.tipo}|${ev.fecha}`;
            if (!grupos.has(clave)) grupos.set(clave, { clave, tipo: ev.tipo, fecha: ev.fecha, periodo: ev.periodo, entradas: [] });
            grupos.get(clave).entradas.push({ nombre: a.nombre, nota: ev.nota, comentario: ev.comentario });
        }));
        const ordenFecha = f => { const m = String(f).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : 0; };
        return Array.from(grupos.values()).sort((a, b) => ordenFecha(b.fecha) - ordenFecha(a.fecha) || a.tipo.localeCompare(b.tipo));
    }

    function etiquetaActividad(a) {
        return `${a.tipo} · ${a.fecha}`;
    }

    function copiarActividad(modo) {
        refrescarPagina();
        const act = actividadesDetalle().find(a => a.clave === estado.actividadSel);
        if (!act) {
            estado.mensaje = { tipo: 'aviso', texto: 'Elegí primero la evaluación que querés copiar.' };
            render();
            return;
        }
        const origen = `${etiquetaActividad(act)} (${estado.contexto.libreta || 'libreta'})`;
        if (modo === 'excel') {
            try {
                const nombre = F.descargarPlanilla({
                    encabezados: ['N°', 'Estudiante', 'Nota', 'Comentario'],
                    filas: act.entradas.map((e, i) => [i + 1, e.nombre, e.nota, e.comentario]),
                    info: [['Evaluación', etiquetaActividad(act)], ['Libreta', estado.contexto.libreta || ''], ['Alumnos', String(act.entradas.length)],
                           ['Cómo usarla', 'Entrá en SIGED a la evaluación de destino y usá "Importar notas desde archivo".']],
                    nombreBase: ['Notas', act.tipo, act.fecha, estado.contexto.libreta],
                    anchos: [5, 38, 8, 60]
                });
                estado.mensaje = { tipo: 'ok', texto: `Archivo descargado: ${nombre}` };
            } catch (err) {
                estado.mensaje = { tipo: 'error', texto: 'No se pudo generar el archivo: ' + err.message };
            }
            render();
            return;
        }
        guardarNotas(origen, estado.contexto.libreta, act.entradas);
    }

    /** Desde Evaluaciones o Boletín: guardar lo que está cargado en la grilla para otra evaluación */
    function guardarPaginaActual() {
        refrescarPagina();
        const ctx = estado.contexto;
        const origen = [ctx.evaluacion, ctx.libreta].filter(Boolean).join(' · ') || estado.pagina.etiqueta;
        guardarNotas(origen, ctx.libreta, estado.filas.map(f => ({ nombre: f.nombre, nota: f.nota, comentario: f.comentario })));
    }

    /** Sección "Copiar una evaluación" de la página de detalle */
    function renderCopiarActividad() {
        const acts = actividadesDetalle();
        if (!acts.length) return '';
        if (estado.actividadSel && !acts.some(a => a.clave === estado.actividadSel)) estado.actividadSel = '';
        const sel = acts.find(a => a.clave === estado.actividadSel);
        return `<div class="caja">
            <div class="tit">Copiar una evaluación a otro apartado</div>
            <label>¿Qué evaluación?</label>
            <select data-act="actividad-detalle">
                <option value="">Elegí una…</option>
                ${acts.map(a => `<option value="${escapeHtml(a.clave)}" ${a.clave === estado.actividadSel ? 'selected' : ''}>${escapeHtml(etiquetaActividad(a))} (${a.entradas.length} alumno${a.entradas.length === 1 ? '' : 's'})</option>`).join('')}
            </select>
            <button class="btn btn-verde" data-act="copiar-guardar" ${sel ? '' : 'disabled'}><span class="ic">📋</span><span>Guardar en el asistente${sel ? ': ' + escapeHtml(etiquetaActividad(sel)) : ''}
                <small>Después entrá a la evaluación de destino (por ejemplo Parcial) y cargalas con un clic</small></span></button>
            <div style="text-align:center"><button class="link" data-act="copiar-excel" ${sel ? '' : 'disabled'}>Prefiero descargarla en Excel</button></div>
        </div>`;
    }

    /** Hace clic en un control de SIGED (botón TODOS, Mostrar detalle) en nombre del docente */
    function clicSiged(el, descripcion) {
        if (!el) {
            estado.mensaje = { tipo: 'aviso', texto: `No encontré el control "${descripcion}" en la página.` };
            render();
            return;
        }
        el.click();
        estado.mensaje = { tipo: 'info', texto: `Pedí a SIGED "${descripcion}". Esperá a que la página termine de cargar.` };
        render();
    }

    // =====================================================================
    //  Panel flotante (Shadow DOM para no mezclar estilos con SIGED)
    // =====================================================================
    const host = document.createElement('div');
    host.id = 'siged-carga-notas-host';
    // Abajo a la derecha. Si el docente lo arrastra, se recuerda la posición.
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; right: 16px; bottom: 16px;';
    try {
        const pos = JSON.parse(localStorage.getItem('sigedCargaNotas.posicion') || 'null');
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
            host.style.left = Math.min(pos.left, Math.max(0, window.innerWidth - 80)) + 'px';
            host.style.top = Math.min(pos.top, Math.max(0, window.innerHeight - 40)) + 'px';
            host.style.right = 'auto';
            host.style.bottom = 'auto';
        }
    } catch (e) { /* ignorar */ }
    const raiz = host.attachShadow({ mode: 'open' });

    const CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 13px; color: #2c3e50;
                 width: 380px; max-height: calc(100vh - 40px); display: flex; flex-direction: column;
                 background: #fafafa; border: 1px solid #d5dbe0; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.25); overflow: hidden; }
        .cabecera { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px;
                    background: #2c3e50; color: #fff; cursor: move; user-select: none; }
        .cabecera .titulo { font-weight: 600; font-size: 14px; }
        .cabecera button { background: rgba(255,255,255,0.15); color: #fff; border: 0; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; font-size: 16px; line-height: 1; }
        .cabecera button:hover { background: rgba(255,255,255,0.3); }
        .cuerpo { padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
        .donde { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 12px; }
        .donde .etq { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #7f8c8d; font-weight: 600; margin-bottom: 4px; }
        .donde .pag { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
        .donde .ctx { color: #5a6c7d; font-size: 12px; line-height: 1.5; }
        .btn { width: 100%; padding: 11px 12px; border: 0; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; text-align: left;
               display: flex; align-items: center; gap: 10px; transition: transform .1s, filter .1s; }
        .btn:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px); }
        .btn:disabled { opacity: .55; cursor: not-allowed; }
        .btn .ic { font-size: 18px; }
        .btn small { display: block; font-weight: 400; font-size: 11px; opacity: .9; }
        .btn-azul { background: #3498db; color: #fff; }
        .btn-verde { background: #27ae60; color: #fff; }
        .btn-gris { background: #ecf0f1; color: #2c3e50; }
        .btn-rojo { background: #e74c3c; color: #fff; }
        .fila-btns { display: flex; gap: 8px; }
        .fila-btns .btn { padding: 8px 10px; font-size: 12px; }
        .link { background: none; border: 0; color: #2980b9; cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; }
        .msg { padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; border-left: 4px solid; }
        .msg-ok { background: #d4edda; border-color: #28a745; color: #155724; }
        .msg-error { background: #f8d7da; border-color: #dc3545; color: #721c24; }
        .msg-aviso { background: #fff3cd; border-color: #ffc107; color: #856404; }
        .msg-info { background: #d1ecf1; border-color: #17a2b8; color: #0c5460; }
        .caja { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
        .caja .tit { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #7f8c8d; font-weight: 600; }
        label { font-size: 12px; color: #5a6c7d; font-weight: 500; display: block; margin-bottom: 4px; }
        select, input[type=text] { width: 100%; padding: 7px 8px; border: 1px solid #ccd3d9; border-radius: 6px; font-size: 12px; background: #fff; color: #2c3e50; }
        .radios { display: flex; gap: 12px; font-size: 12px; }
        .radios label { display: flex; align-items: center; gap: 4px; margin: 0; cursor: pointer; }
        table.prev { width: 100%; border-collapse: collapse; font-size: 12px; }
        table.prev th { text-align: left; font-size: 10px; text-transform: uppercase; color: #7f8c8d; padding: 4px 4px; border-bottom: 1px solid #e0e0e0; }
        table.prev td { padding: 4px 4px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
        table.prev tr.sin td { background: #fff8e1; }
        table.prev tr.inv td { background: #ffebee; }
        table.prev select { padding: 4px; font-size: 11px; }
        .nota { font-weight: 700; text-align: center; min-width: 34px; white-space: nowrap; }
        .accion { position: sticky; bottom: -12px; background: #fafafa; padding: 8px 0 12px; margin-bottom: -12px; border-top: 1px solid #e0e0e0; }
        .nota.mal { color: #c0392b; font-weight: 600; font-size: 10px; }
        .alumno { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .contador { text-align: center; padding: 8px; background: #e3f2fd; border-radius: 6px; color: #1565c0; font-weight: 600; font-size: 12px; }
        details summary { cursor: pointer; font-size: 12px; color: #5a6c7d; }
        ul.lista { margin: 4px 0 0 16px; padding: 0; font-size: 11px; color: #5a6c7d; line-height: 1.5; }
        .pill { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #2c3e50; color: #fff; border: 0; border-radius: 999px;
                padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.3); display: flex; align-items: center; gap: 8px; }
        .pill:hover { background: #34495e; }
        .punto { width: 9px; height: 9px; border-radius: 50%; background: #95a5a6; display: inline-block; }
        .punto.on { background: #2ecc71; }
        .ayuda { font-size: 11px; color: #7f8c8d; line-height: 1.5; }
        .ficha { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        .ficha .cab { display: flex; gap: 12px; align-items: center; }
        .ficha .foto { width: 64px; height: 80px; border-radius: 8px; object-fit: cover; background: #ecf0f1; border: 1px solid #d5dbe0; flex: none; }
        .ficha .sinfoto { width: 64px; height: 80px; border-radius: 8px; background: #ecf0f1; border: 1px solid #d5dbe0; flex: none; display: flex; align-items: center; justify-content: center; font-size: 28px; }
        .ficha .nom { font-size: 15px; font-weight: 700; line-height: 1.2; }
        .ficha .sub { font-size: 11px; color: #5a6c7d; margin-top: 3px; line-height: 1.5; }
        .ficha .visado { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: #d4edda; color: #155724; }
        .ficha .novisado { background: #fff3cd; color: #856404; }
        .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .kpi { background: #f8f9fa; border-radius: 8px; padding: 8px 6px; text-align: center; }
        .kpi .v { font-size: 20px; font-weight: 700; line-height: 1.1; }
        .kpi .e { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: #7f8c8d; margin-top: 2px; }
        .kpi.rojo .v { color: #c0392b; }
        .kpi.verde .v { color: #27ae60; }
        .faltas { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11px; }
        .faltas span { background: #f8f9fa; border-radius: 6px; padding: 3px 8px; color: #2c3e50; }
        .faltas b { color: #2c3e50; }
        .faltas b.alerta { color: #c0392b; }
        .tend { font-size: 12px; line-height: 1.5; }
        .tend .t { font-weight: 700; }
        .tend .sube { color: #1e8449; }
        .tend .baja { color: #c0392b; }
        .tend .igual { color: #7f8c8d; }
        .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 6px; }
        .chip { font-size: 11px; padding: 2px 7px; border-radius: 999px; background: #f1f3f5; color: #2c3e50; }
        .chip.sube { background: #e8f5e9; color: #1e8449; }
        .chip.baja { background: #fdecea; color: #c0392b; }
        .chip.rojo { background: #fdecea; color: #c0392b; font-weight: 700; }
        .comparar { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #5a6c7d; }
        .comparar select { width: auto; padding: 2px 4px; font-size: 11px; }
    `;

    raiz.innerHTML = `
        <style>${CSS}</style>
        <div id="contenedor"></div>
        <input type="file" id="archivo" accept=".xlsx,.xls,.xlsm,.ods,.csv,.txt" style="display:none">
    `;

    function render() {
        const cont = raiz.getElementById('contenedor');
        if (estado.colapsado) {
            const activo = !!estado.pagina;
            cont.innerHTML = `<button class="pill" data-act="expandir" title="Abrir el Asistente de SIGED">
                                <span class="punto ${activo ? 'on' : ''}"></span> 🎓 Asistente de SIGED
                              </button>`;
            return;
        }
        cont.innerHTML = `
            <div class="panel">
                <div class="cabecera" id="cabecera">
                    <span class="titulo">🎓 Asistente de SIGED</span>
                    <button data-act="colapsar" title="Minimizar">–</button>
                </div>
                <div class="cuerpo">${renderCuerpo()}</div>
            </div>`;
        activarArrastre();
        cont.querySelectorAll('.ficha img.foto').forEach(img => {
            img.addEventListener('error', () => { const d = document.createElement('div'); d.className = 'sinfoto'; d.textContent = '🧑‍🎓'; img.replaceWith(d); }, { once: true });
        });
    }

    function renderDonde() {
        const p = estado.pagina;
        const ctx = estado.contexto;
        if (!p) {
            return `<div class="donde">
                        <div class="etq">Dónde estás</div>
                        <div class="pag">Esta página no tiene notas para cargar</div>
                        <div class="ctx">Entrá en SIGED a <b>Libreta → Evaluaciones</b>, <b>Pasaje de calificaciones al boletín</b> o al <b>Libro del Profesor</b> y el panel se activará solo.</div>
                    </div>`;
        }
        const partes = [];
        if (ctx.libreta) partes.push(`<b>${p.clave === 'detalle' ? 'Curso/Gr/Asig' : p.clave === 'corrector' ? 'Reunión' : 'Libreta'}:</b> ${escapeHtml(ctx.libreta)}`);
        if (ctx.evaluacion) partes.push(`<b>Evaluación:</b> ${escapeHtml(ctx.evaluacion)}`);
        if (ctx.reunion) partes.push(`<b>Asignada a:</b> ${escapeHtml(ctx.reunion)}`);
        if (p.clave === 'cierre') {
            partes.push(`<b>Alumno:</b> ${estado.filas[0] ? escapeHtml('N° ' + estado.filas[0].nro + ' · ' + estado.filas[0].nombre) : '—'}${ctx.totalLibreta ? ' (de ' + ctx.totalLibreta + ')' : ''}`);
        } else if (p.clave === 'corrector') {
            // la mini ficha ya muestra al alumno
        } else {
            partes.push(`<b>Alumnos${p.clave === 'detalle' ? ' visibles' : ''}:</b> ${estado.filas.length}${p.clave === 'detalle' && ctx.totalLibreta ? ' de ' + ctx.totalLibreta : ''}`);
        }
        return `<div class="donde">
                    <div class="etq">Dónde estás</div>
                    <div class="pag">${p.icono} ${escapeHtml(p.etiqueta)}</div>
                    <div class="ctx">${partes.join('<br>')}</div>
                </div>`;
    }

    function renderMensaje() {
        if (!estado.mensaje) return '';
        return `<div class="msg msg-${estado.mensaje.tipo}">${escapeHtml(estado.mensaje.texto)}</div>`;
    }

    function renderCuerpo() {
        const p = estado.pagina;
        let html = renderDonde();
        if (!p) return html + renderMensaje();

        const xlsx = F.tieneXLSX();
        if (p.clave === 'corrector') return html + renderCorrector();
        if (p.clave === 'detalle') return html + renderDetalle();
        if (p.clave === 'cierre') return html + renderCierre();
        if (p.clave === 'libro') {
            if (estado.filas.length === 0) {
                html += `<div class="msg msg-aviso">Seleccioná una libreta para ver los alumnos del grupo.</div>`;
            } else {
                html += `<button class="btn btn-azul" data-act="exportar" data-formato="${xlsx ? 'xlsx' : 'csv'}">
                            <span class="ic">📥</span><span>Descargar plantilla del grupo${xlsx ? ' (Excel)' : ' (CSV)'}
                            <small>Lista de alumnos con columnas Nota y Comentario para completar</small></span></button>`;
                if (xlsx) html += `<div style="text-align:center"><button class="link" data-act="exportar" data-formato="csv">Prefiero descargarla en CSV</button></div>`;
                html += `<div class="ayuda">1. Completá la columna <b>Nota</b> en la plantilla.<br>
                         2. Entrá en SIGED a la evaluación (o al boletín) donde van esas notas.<br>
                         3. Usá <b>Importar notas desde archivo</b> y revisá antes de guardar.</div>`;
            }
            return html + renderMensaje();
        }

        // Páginas de carga: evaluación y boletín
        html += `<button class="btn btn-azul" data-act="exportar" data-formato="${xlsx ? 'xlsx' : 'csv'}">
                    <span class="ic">📥</span><span>Descargar notas de esta página${xlsx ? ' (Excel)' : ' (CSV)'}
                    <small>Para guardarlas o pasarlas a otra evaluación</small></span></button>`;
        if (xlsx) html += `<div style="text-align:center;margin-top:-4px"><button class="link" data-act="exportar" data-formato="csv">Descargar en CSV</button></div>`;
        html += renderGuardadas();
        html += `<button class="btn btn-verde" data-act="importar">
                    <span class="ic">📤</span><span>Importar notas desde archivo
                    <small>Excel o CSV: plantilla, exportación de SIGED o de CREA</small></span></button>`;
        if (p.clave === 'evaluacion' && estado.filas.some(f => f.nota || f.comentario)) {
            html += `<div style="text-align:center;margin-top:-4px"><button class="link" data-act="guardar-pagina">📋 Guardar estas notas en el asistente para cargarlas en otra evaluación</button></div>`;
        }
        html += renderMensaje();
        if (estado.archivo) html += renderArchivo();
        return html;
    }

    /** Mini ficha del alumno en "Corrector por curso" */
    function renderCorrector() {
        const a = estado.filas[0];
        if (!a) return `<div class="msg msg-aviso">No hay un alumno visible en la página.</div>`;
        return renderFichaAlumno(a);
    }

    /** Mini ficha (compartida por Corrector por curso y Cierre de promedios por alumno) */
    function renderFichaAlumno(a) {
        const r = C.resumen(a, estado.comparacionSel);
        const fmt = n => (n === null || n === undefined ? '—' : String(n).replace('.', ','));
        const chip = (m, clase, detalle) => `<span class="chip ${clase}" title="${escapeHtml(m.nombre)}">${escapeHtml(m.nombre)}${detalle ? ' ' + detalle : ''}</span>`;
        const f = a.faltas;
        const totalFaltas = ['justificadas', 'injustificadas', 'fictas'].reduce((n, k) => n + (parseInt(f[k], 10) || 0), 0);

        let html = `<div class="ficha">
            <div class="cab">
                ${a.foto ? `<img class="foto" src="${escapeHtml(a.foto)}" alt="">` : `<div class="sinfoto">🧑‍🎓</div>`}
                <div>
                    <div class="nom">${escapeHtml(a.apellidos)}<br><span style="font-weight:500">${escapeHtml(a.nombres)}</span></div>
                    <div class="sub">${a.documento ? 'Doc. ' + escapeHtml(a.documento) + ' · ' : ''}${escapeHtml(a.periodo || a.titulo)}<br>
                        ${a.visado !== null && a.visado !== undefined ? `<span class="visado ${a.visado ? '' : 'novisado'}">${a.visado ? 'VISADO' : 'SIN VISAR'}</span>` : ''}
                        ${a.extra ? `<span class="ayuda">${escapeHtml(a.extra)}</span>` : ''}
                        ${a.minimo ? `<span class="ayuda"> · baja = menos de ${a.minimo}</span>` : ''}</div>
                </div>
            </div>
            <div class="kpis">
                <div class="kpi"><div class="v">${fmt(r.promedio)}</div><div class="e">Promedio</div></div>
                <div class="kpi ${r.bajas.length ? 'rojo' : 'verde'}"><div class="v">${r.bajas.length}</div><div class="e">Bajas</div></div>
                <div class="kpi ${totalFaltas > 0 ? '' : 'verde'}"><div class="v">${totalFaltas}</div><div class="e">Faltas</div></div>
            </div>
            <div class="faltas">
                ${[['Justificadas', f.justificadas], ['Injustificadas', f.injustificadas], ['Fictas', f.fictas], ['Llegadas tarde', f.tardes]]
                    .filter(([e, v]) => v !== '' || e !== 'Llegadas tarde')
                    .map(([e, v]) => `<span>${e} <b class="${(parseInt(v, 10) || 0) > 0 ? 'alerta' : ''}">${escapeHtml(v || '0')}</b></span>`).join('')}
            </div>`;

        if (a.aviso) html += `<div class="msg msg-aviso">${escapeHtml(a.aviso)}</div>`;
        if (r.bajas.length) {
            html += `<div class="tend"><span class="t baja">Bajas en:</span></div><div class="chips">${r.bajas.map(m => chip(m, 'rojo', escapeHtml(m.nota))).join('')}</div>`;
        }

        if (a.anteriores.length) {
            html += `<div class="comparar">Comparado con
                <select data-act="comparar">${a.anteriores.map(c => `<option value="${escapeHtml(c.clave)}" ${r.comparacion && c.clave === r.comparacion.clave ? 'selected' : ''}>${escapeHtml(c.titulo)}</option>`).join('')}</select>
                ${r.promedioAnterior !== null ? `<span>(promedio ${fmt(r.promedioAnterior)} → ${fmt(r.promedio)})</span>` : ''}</div>`;
            const flecha = i => `${i.antes}→${i.ahora}`;
            html += `<div class="tend">`;
            html += `<span class="t sube">▲ Subió ${r.subieron.length}</span>${r.subieron.length ? ':' : ''}</div><div class="chips">${r.subieron.map(i => chip(i, 'sube', flecha(i))).join('')}</div>`;
            html += `<div class="tend"><span class="t baja">▼ Bajó ${r.bajaron.length}</span>${r.bajaron.length ? ':' : ''}</div><div class="chips">${r.bajaron.map(i => chip(i, 'baja', flecha(i))).join('')}</div>`;
            html += `<div class="tend"><span class="t igual">= Igual ${r.iguales.length}</span>${r.sinDato.length ? ` <span class="igual">· sin dato ${r.sinDato.length}</span>` : ''}</div>`;
        } else {
            html += `<div class="ayuda">No hay evaluaciones anteriores para comparar. Activá "Mostrar todas las evaluaciones anteriores" en SIGED.</div>`;
        }
        html += `<div class="ayuda">${a.materias.length} materias en ${escapeHtml(a.periodo || 'esta reunión')}. La ficha se actualiza sola al cambiar de alumno.</div></div>`;
        return html + renderMensaje();
    }

    function renderDetalle() {
        const alumnos = estado.filas;
        const ctx = estado.contexto;
        const total = ctx.totalLibreta || 0;
        const sinDetalle = alumnos.filter(a => !a.detalleCargado).length;
        const b = D.botones();
        let html = '';
        if (alumnos.length === 0) {
            return `<div class="msg msg-aviso">No hay alumnos en la página. Elegí un alumno o hacé clic en TODOS en SIGED.</div>`;
        }
        if (total && alumnos.length < total) {
            html += `<div class="msg msg-info">Se ven <b>${alumnos.length} de ${total}</b> alumnos de la libreta. Para exportar a todos, mostralos primero en SIGED.</div>`;
            if (b.todos) html += `<button class="btn btn-gris" data-act="siged-todos"><span class="ic">👥</span><span>Mostrar TODOS los alumnos en SIGED<small>Equivale al botón TODOS de la página</small></span></button>`;
        }
        if (sinDetalle) {
            html += `<div class="msg msg-aviso">${sinDetalle} alumno(s) no tienen el detalle de evaluaciones cargado.</div>`;
            if (b.mostrarDetalleTodos) html += `<button class="btn btn-gris" data-act="siged-detalle"><span class="ic">🔎</span><span>Mostrar detalle de todos en SIGED<small>Equivale a "Mostrar / Ocultar detalle (todos)"</small></span></button>`;
        }
        if (alumnos.length > 1) {
            html += `<div class="caja"><label>¿Qué exportar?</label>
                <select data-act="alumno">
                    <option value="">Todos los alumnos visibles (${alumnos.length})</option>
                    ${alumnos.map(a => `<option value="${a.idx}" ${a.idx === estado.alumnoSel ? 'selected' : ''}>${escapeHtml(a.nro ? a.nro + ' - ' : '')}${escapeHtml(a.nombre)}</option>`).join('')}
                </select></div>`;
        }
        html += renderCopiarActividad();
        const sel = estado.alumnoSel ? alumnos.find(a => a.idx === estado.alumnoSel) : null;
        const cantEval = (sel ? [sel] : alumnos).reduce((n, a) => n + a.evaluaciones.length, 0);
        html += `<button class="btn btn-azul" data-act="exportar-detalle"><span class="ic">📥</span><span>Descargar Excel ${sel ? 'de ' + escapeHtml(sel.apellido) : 'de ' + alumnos.length + ' alumno(s)'}
                 <small>${cantEval} evaluaciones con comentarios · promedios por período · resumen</small></span></button>`;
        html += `<div class="ayuda">El Excel completo tiene tres hojas: <b>Notas</b> (cada evaluación con fecha, tipo, nota, comentario y período), <b>Promedios</b> (notas por tipo, rendimiento e inasistencias de cada período) y <b>Resumen</b> (datos, semestrales y rendimiento por período).<br>
                 Los juicios de las reuniones no están en esta página: exportalos desde <b>Pasaje de calificaciones boletín</b>.</div>`;
        return html + renderMensaje();
    }

    function renderCierre() {
        const recorrido = leerRecorrido();
        const ctx = estado.contexto;
        const alumno = estado.filas[0];
        let html = '';
        if (recorrido && recorrido.estado === 'activo') {
            const hechos = recorrido.hechos.length;
            const pct = recorrido.total ? Math.round(hechos / recorrido.total * 100) : 0;
            html += `<div class="caja">
                <div class="tit">Recorriendo alumnos… no toques la página</div>
                <div class="contador">${hechos} de ${recorrido.total} alumnos leídos (${pct}%)</div>
                <div style="height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#27ae60"></div></div>
                <div class="ayuda">Ahora: ${escapeHtml(alumno ? 'N° ' + alumno.nro + ' ' + alumno.nombre : '')}. Al terminar, el Excel se descarga solo y te aviso acá.</div>
                <button class="btn btn-rojo" data-act="recorrido-detener"><span class="ic">⏹</span><span>Detener y descargar lo leído</span></button>
                <button class="link" data-act="recorrido-cancelar">Cancelar sin descargar</button>
            </div>`;
            return html + renderMensaje();
        }
        if (recorrido && recorrido.estado === 'error') {
            html += `<div class="msg msg-error">${escapeHtml(recorrido.errores.join(' '))} Se leyeron ${recorrido.hechos.length} alumno(s).</div>
                     <button class="btn btn-gris" data-act="recorrido-detener"><span class="ic">📥</span><span>Descargar lo que se leyó</span></button>
                     <button class="link" data-act="recorrido-cancelar">Descartar</button>`;
        }
        if (!alumno) return html + `<div class="msg msg-aviso">No hay un alumno visible. Elegí una libreta y un alumno en SIGED.</div>` + renderMensaje();

        html += `<div class="caja" style="padding:8px 12px"><label style="margin:0 0 4px">¿Qué querés hacer?</label>
            <select data-act="modo-cierre">
                <option value="ficha" ${estado.modoCierre !== 'exportar' ? 'selected' : ''}>🪪 Ver la ficha del alumno (notas por materia)</option>
                <option value="exportar" ${estado.modoCierre === 'exportar' ? 'selected' : ''}>📥 Exportar juicios y notas (recorrido / Excel)</option>
            </select></div>`;

        if (estado.modoCierre !== 'exportar') {
            const ficha = C.fichaDesdeCierre(alumno);
            if (!ficha) {
                const enlace = D.enlaceAsignaturasCierre();
                html += `<div class="msg msg-info">Para ver las notas por materia, SIGED tiene que mostrar todas las asignaturas del alumno.</div>`;
                if (enlace) html += `<button class="btn btn-gris" data-act="siged-asignaturas"><span class="ic">📚</span><span>Mostrar todas las asignaturas en SIGED<small>Equivale al enlace "Mostrar todas las asignaturas"</small></span></button>`;
                return html + renderMensaje();
            }
            return html + renderFichaAlumno(ficha);
        }

        const reunionesConJuicio = (alumno.reuniones || []).filter(r => r.juicio || r.rendimiento).length;
        html += `<button class="btn btn-verde" data-act="recorrido-iniciar"><span class="ic">🔄</span><span>Recorrer los ${ctx.totalLibreta || ''} alumnos y exportar todo (Excel)
                 <small>Pasa alumno por alumno solo. Al terminar avisa y descarga el archivo.</small></span></button>`;
        html += `<button class="btn btn-azul" data-act="exportar-cierre"><span class="ic">📥</span><span>Descargar Excel de ${escapeHtml(alumno.apellido || 'este alumno')}
                 <small>${reunionesConJuicio} reunión(es) con nota o juicio · ${alumno.evaluaciones.length} evaluaciones</small></span></button>`;
        html += `<div class="ayuda">El Excel trae todos los alumnos en una misma hoja <b>Juicios</b> (una fila por alumno, con el rendimiento y el juicio de cada reunión), más <b>Juicios (lista)</b>, <b>Notas</b>, <b>Promedios</b> y <b>Resumen</b>.<br>
                 Durante el recorrido la página cambia de alumno sola: no la cierres ni la uses hasta que avise que terminó.</div>`;
        return html + renderMensaje();
    }

    function renderArchivo() {
        const d = estado.archivo;
        const p = estado.pagina;
        let html = `<div class="caja">
            <div class="tit">Archivo cargado</div>
            <div><b>${escapeHtml(d.nombreArchivo)}</b><br>
                 <span class="ayuda">${d.filas.length} filas · ${d.estudiantes} estudiantes${d.formato !== 'universal' ? ' · formato ' + escapeHtml(d.formato) : ''}
                 · <button class="link" data-act="quitar">quitar</button></span></div>`;

        if (d.actividades.length > 1) {
            html += `<div><label>¿Qué evaluación del archivo querés cargar?</label>
                     <select data-act="actividad">
                        <option value="">Elegí una…</option>
                        ${d.actividades.map(a => `<option value="${escapeHtml(a)}" ${a === estado.actividad ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
                     </select></div>`;
        }
        if (d.requiereTipo) {
            html += `<div><label>Tipo de nota</label>
                     <div class="radios">
                        <label><input type="radio" name="tipo" value="individual" data-act="tipo" ${estado.tipo === 'individual' ? 'checked' : ''}> 👤 Individual</label>
                        <label><input type="radio" name="tipo" value="equipo" data-act="tipo" ${estado.tipo === 'equipo' ? 'checked' : ''}> 👥 Por equipo</label>
                     </div></div>`;
        }
        html += `</div>`;

        if (d.actividades.length > 1 && !estado.actividad) return html;
        if (estado.entradas.length === 0) {
            return html + `<div class="msg msg-aviso">El archivo no tiene notas para cargar${estado.actividad ? ' en "' + escapeHtml(estado.actividad) + '"' : ''}.</div>`;
        }
        return html + renderPrevisualizacion();
    }

    function renderPrevisualizacion() {
        const p = estado.pagina;
        const entradas = estado.entradas;
        const usados = new Map();
        estado.asignacion.forEach(ei => { if (ei >= 0) usados.set(ei, (usados.get(ei) || 0) + 1); });

        let listos = 0;
        let invalidas = 0;
        const filasHtml = estado.filas.map((fila, fi) => {
            const ei = estado.asignacion[fi];
            const entrada = ei >= 0 ? entradas[ei] : null;
            let notaHtml = '<td class="nota">—</td>';
            let clase = entrada ? '' : 'sin';
            if (entrada) {
                if (entrada.nota) {
                    const r = p.resolver ? p.resolver(fila, entrada.nota) : resolverOpcion(fila.select, entrada.nota);
                    if (r.ok) { notaHtml = `<td class="nota" title="${escapeHtml(entrada.nota)}">${escapeHtml(r.texto)}</td>`; listos++; }
                    else { notaHtml = `<td class="nota mal" title="${escapeHtml(r.motivo)}">⚠ ${escapeHtml(entrada.nota)}</td>`; clase = 'inv'; invalidas++; }
                } else {
                    notaHtml = `<td class="nota" title="Solo ${p.campos.comentario.toLowerCase()}">💬</td>`; listos++;
                }
                if (usados.get(ei) > 1) clase = 'inv';
            }
            const opciones = entradas.map((e, i) =>
                `<option value="${i}" ${i === ei ? 'selected' : ''}>${escapeHtml(e.nombre)}${e.nota ? ' → ' + escapeHtml(e.nota) : ''}</option>`).join('');
            const score = estado.scores && estado.scores[fi] ? ` (${Math.round(estado.scores[fi] * 100)}%)` : '';
            const comentario = entrada && entrada.comentario ? ' 💬' : '';
            return `<tr class="${clase}">
                        <td class="alumno" title="${escapeHtml(fila.nombre)}${score}">${escapeHtml(fila.nombre)}</td>
                        <td><select data-act="asignar" data-fila="${fi}" title="Entrada del archivo para este alumno${score}">
                                <option value="-1">— sin nota —</option>${opciones}</select></td>
                        ${notaHtml.replace('</td>', comentario + '</td>')}
                    </tr>`;
        }).join('');

        const noUsadas = entradas.map((e, i) => ({ e, i })).filter(x => !usados.has(x.i));
        const sinAsignar = estado.asignacion.filter(ei => ei < 0).length;

        let html = `<div class="caja">
            <div class="tit">Revisá antes de cargar</div>
            <div class="contador">${listos} de ${estado.filas.length} alumnos recibirán nota</div>`;
        if (sinAsignar) html += `<div class="msg msg-aviso">${sinAsignar} alumno(s) de SIGED sin nota en el archivo (filas amarillas). Podés elegir la entrada correcta a mano en cada fila.</div>`;
        if (invalidas) html += `<div class="msg msg-error">${invalidas} nota(s) no válidas para esta página (filas rojas). Corregilas en el archivo o dejalas sin asignar.</div>`;
        html += `<div style="max-height:220px;overflow:auto"><table class="prev">
                    <thead><tr><th>Alumno en SIGED</th><th>Del archivo</th><th>Nota</th></tr></thead>
                    <tbody>${filasHtml}</tbody></table></div>`;
        if (noUsadas.length) {
            html += `<details><summary>${noUsadas.length} entrada(s) del archivo sin alumno en SIGED</summary>
                     <ul class="lista">${noUsadas.map(x => `<li>${escapeHtml(x.e.nombre)}${x.e.nota ? ' → ' + escapeHtml(x.e.nota) : ''}</li>`).join('')}</ul></details>`;
        }
        html += `</div>`;

        if (estado.resultado) {
            const r = estado.resultado;
            html += `<div class="msg msg-ok"><b>✅ ${r.aplicados} nota(s) cargadas en la página.</b><br>
                     ⚠️ Todavía no están guardadas: revisá la grilla y hacé clic en <b>Guardar</b> en SIGED.</div>`;
            if (r.errores.length) {
                html += `<details open><summary>${r.errores.length} problema(s)</summary><ul class="lista">${r.errores.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></details>`;
            }
            html += `<div class="accion"><button class="btn btn-verde" data-act="guardar"><span class="ic">💾</span><span>Ir al botón Guardar de SIGED<small>Te lleva al botón y lo resalta. El guardado lo hacés vos.</small></span></button></div>`;
        } else {
            html += `<div class="accion"><button class="btn btn-verde" data-act="aplicar" ${listos === 0 ? 'disabled' : ''}>
                        <span class="ic">✅</span><span>Cargar ${listos} nota(s) en la página<small>Después vas a tener que hacer clic en Guardar en SIGED</small></span></button></div>`;
        }
        return html;
    }

    // ---------- eventos del panel ----------
    raiz.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-act]');
        if (!btn || btn.tagName === 'SELECT' || btn.tagName === 'INPUT') return;
        const act = btn.dataset.act;
        switch (act) {
            case 'colapsar': setColapsado(true); break;
            case 'expandir': setColapsado(false); break;
            case 'exportar': exportar(btn.dataset.formato); break;
            case 'importar': raiz.getElementById('archivo').click(); break;
            case 'quitar': quitarArchivo(); break;
            case 'aplicar': aplicarNotas(); break;
            case 'guardar': irAGuardar(); break;
            case 'exportar-detalle': exportarDetalle(); break;
            case 'copiar-guardar': copiarActividad('guardar'); break;
            case 'copiar-excel': copiarActividad('excel'); break;
            case 'guardar-pagina': guardarPaginaActual(); break;
            case 'guardadas-usar': usarGuardadas(); break;
            case 'guardadas-olvidar': olvidarGuardadas(); break;
            case 'exportar-cierre': exportarCierreActual(); break;
            case 'recorrido-iniciar': iniciarRecorrido(); break;
            case 'recorrido-detener': detenerRecorrido(true); break;
            case 'recorrido-cancelar': detenerRecorrido(false); break;
            case 'siged-todos': clicSiged(D.botones().todos, 'mostrar TODOS los alumnos'); break;
            case 'siged-detalle': clicSiged(D.botones().mostrarDetalleTodos, 'mostrar el detalle de todos'); break;
            case 'siged-asignaturas': clicSiged(D.enlaceAsignaturasCierre(), 'mostrar todas las asignaturas'); break;
        }
    });

    raiz.addEventListener('change', (ev) => {
        const el = ev.target;
        if (el.id === 'archivo') {
            const file = el.files && el.files[0];
            if (file) cargarArchivo(file);
            return;
        }
        const act = el.dataset.act;
        if (act === 'actividad') {
            estado.actividad = el.value;
            estado.resultado = null;
            recalcularAsignacion();
            render();
        } else if (act === 'tipo') {
            estado.tipo = el.value;
            estado.resultado = null;
            recalcularAsignacion();
            render();
        } else if (act === 'modo-cierre') {
            estado.modoCierre = el.value;
            estado.comparacionSel = '';
            estado.mensaje = null;
            try { localStorage.setItem('sigedCargaNotas.modoCierre', el.value); } catch (e) { /* ignorar */ }
            render();
        } else if (act === 'comparar') {
            estado.comparacionSel = el.value;
            render();
        } else if (act === 'actividad-detalle') {
            estado.actividadSel = el.value;
            estado.mensaje = null;
            render();
        } else if (act === 'alumno') {
            estado.alumnoSel = el.value;
            estado.mensaje = null;
            render();
        } else if (act === 'asignar') {
            const fi = parseInt(el.dataset.fila, 10);
            estado.asignacion[fi] = parseInt(el.value, 10);
            if (estado.scores) estado.scores[fi] = 0;
            estado.resultado = null;
            render();
        }
    });

    function setColapsado(valor) {
        estado.colapsado = valor;
        try { localStorage.setItem('sigedCargaNotas.colapsado', valor ? '1' : '0'); } catch (e) { /* ignorar */ }
        render();
    }

    function activarArrastre() {
        const cab = raiz.getElementById('cabecera');
        if (!cab) return;
        let inicio = null;
        cab.addEventListener('mousedown', (ev) => {
            if (ev.target.tagName === 'BUTTON') return;
            const rect = host.getBoundingClientRect();
            inicio = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
            ev.preventDefault();
        });
        const mover = (ev) => {
            if (!inicio) return;
            const left = Math.max(0, Math.min(window.innerWidth - 60, inicio.left + ev.clientX - inicio.x));
            const top = Math.max(0, Math.min(window.innerHeight - 40, inicio.top + ev.clientY - inicio.y));
            host.style.left = left + 'px';
            host.style.top = top + 'px';
            host.style.right = 'auto';
            host.style.bottom = 'auto';
        };
        const soltar = () => {
            if (!inicio) return;
            inicio = null;
            try {
                localStorage.setItem('sigedCargaNotas.posicion', JSON.stringify({ left: parseFloat(host.style.left), top: parseFloat(host.style.top) }));
            } catch (e) { /* ignorar */ }
        };
        document.addEventListener('mousemove', mover);
        document.addEventListener('mouseup', soltar);
    }

    // =====================================================================
    //  Arranque, observador de cambios y mensajes del popup
    // =====================================================================
    function montar() {
        if (!document.body) return;
        // Si la página trae un panel viejo guardado en el HTML (por ejemplo, una página guardada con "Guardar como"), se quita
        document.querySelectorAll('#siged-carga-notas-host').forEach(h => { if (h !== host) h.remove(); });
        if (!document.body.contains(host)) document.body.appendChild(host);
        refrescarPagina();
        render();
    }

    const observador = new MutationObserver(debounce(() => {
        if (refrescarPagina()) render();
    }, 400));

    function iniciar() {
        montar();
        observador.observe(document.body, { childList: true, subtree: true });
        if (leerRecorrido()) {
            setColapsado(false);
            continuarRecorrido();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }

    function resumenEstado() {
        return {
            pagina: estado.pagina ? estado.pagina.clave : null,
            etiqueta: estado.pagina ? estado.pagina.etiqueta : 'Página sin notas para cargar',
            icono: estado.pagina ? estado.pagina.icono : '🔎',
            contexto: estado.contexto,
            alumnos: estado.filas.length,
            colapsado: estado.colapsado
        };
    }

    try {
        chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
            switch (req && req.action) {
                case 'estadoPagina':
                    refrescarPagina();
                    sendResponse(resumenEstado());
                    break;
                case 'mostrarPanel':
                    montar();
                    setColapsado(false);
                    sendResponse({ ok: true });
                    break;
                case 'ocultarPanel':
                    setColapsado(true);
                    sendResponse({ ok: true });
                    break;
                case 'exportar':
                    montar();
                    setColapsado(false);
                    if (estado.pagina && estado.pagina.clave === 'corrector') { estado.mensaje = { tipo: 'info', texto: 'En esta página el asistente muestra la ficha del alumno; no hay nada para exportar.' }; render(); }
                    else if (estado.pagina && estado.pagina.clave === 'detalle') exportarDetalle();
                    else if (estado.pagina && estado.pagina.clave === 'cierre') exportarCierreActual();
                    else exportar(req.formato);
                    sendResponse({ ok: true });
                    break;
                case 'importar':
                    // El selector de archivos solo puede abrirse con un clic del usuario en la página,
                    // así que mostramos el panel y le indicamos qué botón usar.
                    montar();
                    setColapsado(false);
                    estado.mensaje = { tipo: 'info', texto: 'Hacé clic en "Importar notas desde archivo" y elegí tu planilla.' };
                    render();
                    sendResponse({ ok: true });
                    break;
                default:
                    return false;
            }
            return false;
        });
    } catch (e) {
        console.warn('Asistente de SIGED: no se pudo registrar el canal con el popup', e);
    }
})();
