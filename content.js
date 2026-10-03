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
    const UMBRAL_MATCH = 0.70;
    const MAX_FILAS = 2000;

    console.log('✅ SIGED - Carga de Notas: content script cargado en', location.href);

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
        // ---------------- Evaluaciones (escritos, parciales, orales, etc.) ----------------
        evaluacion: {
            clave: 'evaluacion',
            etiqueta: 'Evaluaciones (ingreso de notas)',
            icono: '📝',
            detectar: () => !!$id('vCALIFCOD_0001'),
            contexto() {
                const titulo = tituloPagina();
                // Nombre de la evaluación: probamos ids conocidos y luego cualquier id que parezca una descripción de evaluación
                let evaluacion = primerTexto(['vEVADSC', 'span_vEVADSC', 'vEVALDSC', 'span_vEVALDSC', 'vLIBEVADSC', 'span_vLIBEVADSC',
                                              'vEVANOM', 'span_vEVANOM', 'vEVADESC', 'span_vEVADESC', 'vDESCRIPCION', 'span_vDESCRIPCION']);
                if (!evaluacion) {
                    const candidatos = document.querySelectorAll('[id*="EVA"][id*="DSC"], [id*="EVA"][id*="DESC"], [id*="EVA"][id*="NOM"]');
                    for (const el of candidatos) {
                        if (/_\d{4}$/.test(el.id)) continue;
                        const t = textoDe(el);
                        if (t) { evaluacion = t; break; }
                    }
                }
                const libreta = limpiarLibreta(primerTexto(['vDESCLARGA', 'span_vDESCLARGA', 'vLIBDSC', 'span_vLIBDSC']), evaluacion) || titulo;
                return { libreta, evaluacion: evaluacion || '', titulo };
            },
            leerFilas() {
                return leerGrilla((idx, span) => {
                    const select = $id('vCALIFCOD_' + idx);
                    const textarea = $id('vLIBDCOMENTARIO_' + idx);
                    return {
                        select, textarea,
                        tr: (select || span).closest('tr'),
                        nota: textoDe(select),
                        comentario: textarea ? textarea.value : ''
                    };
                });
            },
            columnasExport(filas) {
                return ['N°', 'Estudiante', 'Nota', 'Comentario'];
            },
            filaExport(f, i) {
                return [i + 1, f.nombre, f.nota, f.comentario];
            },
            campos: { comentario: 'Comentario' },
            aplicar(fila, entrada) {
                const cambios = [];
                const errores = [];
                if (entrada.nota) {
                    const r = escribirSelect(fila.select, entrada.nota);
                    if (r.ok) cambios.push('nota ' + r.texto); else errores.push(r.motivo);
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
        }
    };

    function detectarPagina() {
        if (PAGINAS.boletin.detectar()) return PAGINAS.boletin;
        if (PAGINAS.evaluacion.detectar()) return PAGINAS.evaluacion;
        if (PAGINAS.libro.detectar()) return PAGINAS.libro;
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
        colapsado: false
    };

    try { estado.colapsado = localStorage.getItem('sigedCargaNotas.colapsado') === '1'; } catch (e) { /* ignorar */ }

    function refrescarPagina() {
        const pagina = detectarPagina();
        const cambioPagina = (pagina && pagina.clave) !== (estado.pagina && estado.pagina.clave);
        estado.pagina = pagina;
        estado.contexto = pagina ? pagina.contexto() : { libreta: '', evaluacion: '', titulo: tituloPagina() };
        const firmaAntes = estado.firmaFilas || '';
        estado.filas = pagina ? pagina.leerFilas() : [];
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
        estado.resultado = null;
        estado.mensaje = { tipo: 'info', texto: 'Leyendo archivo…' };
        render();
        try {
            const datos = await F.leerArchivo(file);
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
            ['Planilla generada por', 'SIGED - Carga de Notas (extensión del navegador)'],
            ['Página de origen', pagina.etiqueta],
            ['Libreta', ctx.libreta || ''],
            ['Evaluación', ctx.evaluacion || ''],
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

    // =====================================================================
    //  Panel flotante (Shadow DOM para no mezclar estilos con SIGED)
    // =====================================================================
    const host = document.createElement('div');
    host.id = 'siged-carga-notas-host';
    // Abajo a la izquierda para no tapar otros paneles que SIGED o el docente tengan a la derecha.
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; left: 16px; bottom: 16px;';
    try {
        const pos = JSON.parse(localStorage.getItem('sigedCargaNotas.posicion') || 'null');
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
            host.style.left = Math.min(pos.left, Math.max(0, window.innerWidth - 80)) + 'px';
            host.style.top = Math.min(pos.top, Math.max(0, window.innerHeight - 40)) + 'px';
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
            cont.innerHTML = `<button class="pill" data-act="expandir" title="Abrir el panel de carga de notas">
                                <span class="punto ${activo ? 'on' : ''}"></span> 📚 Carga de Notas
                              </button>`;
            return;
        }
        cont.innerHTML = `
            <div class="panel">
                <div class="cabecera" id="cabecera">
                    <span class="titulo">📚 Carga de Notas SIGED</span>
                    <button data-act="colapsar" title="Minimizar">–</button>
                </div>
                <div class="cuerpo">${renderCuerpo()}</div>
            </div>`;
        activarArrastre();
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
        if (ctx.libreta) partes.push(`<b>Libreta:</b> ${escapeHtml(ctx.libreta)}`);
        if (ctx.evaluacion) partes.push(`<b>Evaluación:</b> ${escapeHtml(ctx.evaluacion)}`);
        partes.push(`<b>Alumnos:</b> ${estado.filas.length}`);
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
        html += `<button class="btn btn-verde" data-act="importar">
                    <span class="ic">📤</span><span>Importar notas desde archivo
                    <small>Excel o CSV: plantilla, exportación de SIGED o de CREA</small></span></button>`;
        html += renderMensaje();
        if (estado.archivo) html += renderArchivo();
        return html;
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
                    const r = resolverOpcion(fila.select, entrada.nota);
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
                    exportar(req.formato);
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
        console.warn('SIGED - Carga de Notas: no se pudo registrar el canal con el popup', e);
    }
})();
