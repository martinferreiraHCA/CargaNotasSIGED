// ========== LECTURA DE "ORALES, ESCRITOS Y O. ACTIVIDADES" (detalle por alumno) ==========
// Página de SIGED que muestra, por alumno: datos personales, evaluaciones semestrales,
// un resumen por período (notas por tipo, rendimiento e inasistencias) y la grilla de
// detalle con cada evaluación (fecha, tipo, nota, comentario, quién la registró).
//
// Este módulo solo LEE la página y arma las hojas del Excel. La interfaz está en content.js.

(function (global) {
    'use strict';

    const MAX_ALUMNOS = 500;
    const MAX_EVALUACIONES = 999;
    const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
                    setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

    const $id = (id) => document.getElementById(id);
    const idx4 = (i) => String(i).padStart(4, '0');
    const texto = (el) => (el ? String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

    function detectar() {
        return !!($id('TXTNROLISTA_0001') && $id('TXTAPELLIDO_0001'));
    }

    /** Color del "semáforo" (puntito de color) → texto */
    function colorATexto(style) {
        const m = String(style || '').match(/background-color:\s*#?([0-9a-f]{3,6})/i);
        if (!m) return '';
        let hex = m[1];
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
        if (g > 150 && r > 150 && b < 100) return 'Amarillo';
        if (g > r && g > b) return 'Verde';
        if (r > g && r > b) return 'Rojo';
        return 'Semáforo';
    }

    /** Valor de una celda del resumen por período: notas separadas por espacio o color del semáforo */
    function valorCelda(td) {
        const partes = [];
        td.querySelectorAll('span').forEach(sp => {
            const dot = sp.querySelector('div[style*="border-radius"]');
            if (dot) { partes.push(colorATexto(dot.getAttribute('style'))); return; }
            if (sp.querySelector('span')) return; // contenedor
            const t = texto(sp);
            if (t) partes.push(t);
        });
        if (partes.length === 0) {
            const dot = td.querySelector('div[style*="border-radius"]');
            if (dot) return colorATexto(dot.getAttribute('style'));
            return texto(td);
        }
        return partes.join(' ');
    }

    /** Resumen por período de un alumno (contenedor con las tablas beTableLibretaEval) */
    function leerPeriodos(cont) {
        if (!cont) return [];
        const periodos = [];
        cont.querySelectorAll('table.beTableLibretaEval').forEach(tabla => {
            const nombre = texto(tabla.querySelector('table.beTableLibretaCabezalEval'));
            const datos = tabla.querySelector('table.beTableLibretaDatosEval');
            if (!nombre || !datos) return;
            const filas = Array.from(datos.querySelectorAll(':scope > tbody > tr, :scope > tr'));
            const periodo = { nombre, columnas: {}, orden: [], inasistencias: {} };
            if (filas.length >= 2) {
                const cabeceras = Array.from(filas[0].children).map(td => texto(td));
                const valores = Array.from(filas[1].children).map(td => valorCelda(td));
                cabeceras.forEach((h, i) => {
                    if (!h) return;
                    periodo.columnas[h] = valores[i] || '';
                    periodo.orden.push(h);
                });
            }
            if (filas.length >= 3) {
                Array.from(filas[2].children).forEach(td => {
                    const t = texto(td);
                    const m = t.match(/^([A-Za-z.]+)\s*:?\s*(\d*)$/);
                    if (m) periodo.inasistencias[m[1].replace(/\.$/, '')] = m[2] || '';
                });
            }
            // "Mostrar todas las asignaturas" (cierre de promedios): una celda por materia con su nota en el período
            // Los tooltips de SIGED (tipsy) mueven el title a "original-title" al pasar el mouse, por eso se leen ambos.
            periodo.materias = [];
            tabla.querySelectorAll('table.table td').forEach(td => {
                const nombre = ['title', 'original-title', 'data-original-title', 'data-title', 'aria-label']
                    .map(a => String(td.getAttribute(a) || '').trim()).find(Boolean) || '';
                const sup = td.querySelector('.Superscript, sup');
                const indice = sup ? texto(sup) : '';
                // La nota es el texto suelto de la celda (fuera del superíndice)
                let nota = Array.from(td.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
                if (!nota) {
                    const clon = td.cloneNode(true);
                    clon.querySelectorAll('.Superscript, sup').forEach(e => e.remove());
                    nota = texto(clon);
                }
                if (!nombre && !indice && !nota) return;
                periodo.materias.push({ nombre, indice, nota });
            });
            periodos.push(periodo);
        });
        return periodos;
    }

    /** Evaluaciones semestrales ("Evaluación | Calif.") de la cabecera del alumno */
    function leerSemestrales(cont) {
        if (!cont) return [];
        const res = [];
        // La grilla interna es la que tiene las filas "E. Semestral | 5"; el encabezado va en <thead>
        const tablas = Array.from(cont.querySelectorAll('table')).filter(t => !t.querySelector('table'));
        tablas.forEach(tabla => {
            tabla.querySelectorAll(':scope > tbody > tr').forEach(tr => {
                const celdas = Array.from(tr.children).filter(c => c.tagName === 'TD').map(td => texto(td));
                if (celdas.length >= 2 && celdas[0]) res.push({ evaluacion: celdas[0], calificacion: celdas[1] });
            });
        });
        return res;
    }

    /** Grilla de detalle del alumno: una fila por evaluación. sufijoAlumno = idx del alumno ('' si la página muestra uno solo) */
    function leerEvaluaciones(sufijoAlumno) {
        const evaluaciones = [];
        for (let r = 1; r <= MAX_EVALUACIONES; r++) {
            const suf = idx4(r) + (sufijoAlumno || '');
            const fecha = $id('span_vLIBDFEC_' + suf);
            if (!fecha) break;
            const notaEl = $id('span_vCALIFICACION_' + suf) || $id('span_vCALIFCOD_' + suf);
            let nota = '';
            if (notaEl) {
                const dot = notaEl.querySelector('div[style*="border-radius"]');
                nota = dot ? colorATexto(dot.getAttribute('style')) : texto(notaEl);
            }
            evaluaciones.push({
                fecha: texto(fecha),
                tipo: texto($id('span_vTDLIBDSCPAN_' + suf)),
                nota,
                comentario: texto($id('span_vLIBDCOMENTARIOGRID_' + suf)),
                registradoPor: texto($id('span_vREGISTRADOPOR_' + suf)),
                modificado: texto($id('span_vLIBDUMFECHOR_' + suf)),
                periodo: ''
            });
        }
        return evaluaciones;
    }

    function mesesDe(nombrePeriodo) {
        const n = norm(nombrePeriodo).toLowerCase();
        return Object.keys(MESES).filter(m => n.includes(m)).map(m => MESES[m]);
    }

    function claveFecha(f) {
        const m = String(f || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!m) return null;
        const anio = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
        return { dia: +m[1], mes: +m[2], anio, orden: anio * 10000 + (+m[2]) * 100 + (+m[1]) };
    }

    /** A qué columna del resumen pertenece un tipo de evaluación (Orales, Escritas, O. Act) */
    function grupoDeTipo(tipo, columnas) {
        const t = norm(tipo);
        const cols = columnas.filter(c => norm(c) !== 'R');
        const exacta = cols.find(c => norm(c) === t);
        if (exacta) return exacta;
        if (t.startsWith('ORAL')) return cols.find(c => norm(c).startsWith('ORAL')) || '';
        if (t.startsWith('ESCRIT')) return cols.find(c => norm(c).startsWith('ESCRIT')) || '';
        return cols.find(c => norm(c).startsWith('O. ACT') || norm(c).startsWith('O ACT') || norm(c).includes('ACT')) || '';
    }

    /**
     * Asigna a cada evaluación el período en que SIGED la contabiliza.
     * 1) Sigue el orden en que las notas aparecen en el resumen por período (tipo + nota, en orden cronológico).
     * 2) Si no coincide, usa los meses del nombre del período (ej. "Agosto Setiembre").
     */
    function asignarPeriodos(alumno) {
        const periodos = alumno.periodos;
        const columnas = [];
        periodos.forEach(p => p.orden.forEach(c => { if (!columnas.includes(c)) columnas.push(c); }));

        const porGrupo = {};
        alumno.evaluaciones.forEach(ev => {
            ev._grupo = grupoDeTipo(ev.tipo, columnas);
            ev._fecha = claveFecha(ev.fecha);
            if (!porGrupo[ev._grupo]) porGrupo[ev._grupo] = [];
            porGrupo[ev._grupo].push(ev);
        });

        Object.keys(porGrupo).forEach(grupo => {
            const lista = porGrupo[grupo].filter(ev => ev.nota).sort((a, b) => ((a._fecha && a._fecha.orden) || 0) - ((b._fecha && b._fecha.orden) || 0));
            const slots = [];
            if (grupo) {
                periodos.forEach(p => {
                    String(p.columnas[grupo] || '').split(/\s+/).filter(Boolean).forEach(n => slots.push({ periodo: p.nombre, nota: n }));
                });
            }
            let k = 0;
            lista.forEach(ev => {
                if (k < slots.length && norm(slots[k].nota) === norm(ev.nota)) {
                    ev.periodo = slots[k].periodo; k++;
                    return;
                }
                const j = slots.findIndex((s, i) => i > k && norm(s.nota) === norm(ev.nota));
                if (j !== -1) { ev.periodo = slots[j].periodo; k = j + 1; }
            });
        });

        // Fallback por mes del nombre del período
        alumno.evaluaciones.forEach(ev => {
            if (ev.periodo || !ev._fecha) return;
            const p = periodos.find(p => mesesDe(p.nombre).includes(ev._fecha.mes));
            if (p) ev.periodo = p.nombre;
        });
        alumno.evaluaciones.forEach(ev => { delete ev._grupo; delete ev._fecha; });
    }

    function leerAlumnos() {
        const alumnos = [];
        for (let i = 1; i <= MAX_ALUMNOS; i++) {
            const idx = idx4(i);
            const nro = $id('TXTNROLISTA_' + idx);
            if (!nro) break;
            const apellido = texto($id('TXTAPELLIDO_' + idx));
            const nombres = texto($id('TXTNOMBRES_' + idx));
            const alumno = {
                idx,
                nro: texto(nro).replace(/^N[°º]\s*/i, ''),
                apellido,
                nombres,
                nombre: `${apellido} ${nombres}`.trim(),
                documento: texto($id('TXTDOCUMENTO_' + idx)),
                curso: texto($id('TXTCURSO_' + idx)),
                origen: texto($id('TXTORIGEN_' + idx)),
                antecedentes: texto($id('TXTANTECEDENTES_' + idx)),
                diagnostico: texto($id('TXTDIAGNOSTICO_' + idx)),
                semestrales: leerSemestrales($id('TXTCALIFICACION_' + idx)),
                periodos: leerPeriodos($id('gxHTMLWrpW0188' + idx) || $id('TABLEGRILLAEVAL_' + idx)),
                evaluaciones: leerEvaluaciones(idx),
                detalleCargado: !!$id('GrillaevaldetalleContainer_' + idx + 'Tbl')
            };
            asignarPeriodos(alumno);
            alumnos.push(alumno);
        }
        return alumnos;
    }

    // ------------------------------------------------------------------
    //  Página "Cierre de promedios por alumno": un alumno por vez, con la
    //  grilla "Calificaciones y juicios" (una fila por reunión) y navegación
    //  por número de lista (enlaces reales: la página se recarga).
    // ------------------------------------------------------------------
    function detectarCierre() {
        return !!($id('GridjuiciosContainerTbl') && $id('TXTAPELLIDO') && $id('TXTALUMNOS'));
    }

    function textoSelect(sel) {
        if (!sel) return '';
        const op = sel.options[sel.selectedIndex];
        return op ? texto(op) || op.value.trim() : '';
    }

    /** Filas de "Calificaciones y juicios" (una por reunión) */
    function leerReuniones() {
        const reuniones = [];
        for (let r = 1; r <= 100; r++) {
            const idx = idx4(r);
            const nombreEl = $id('span_CTLREUDSC1_' + idx) || $id('span_vREUDSC_' + idx);
            const codEl = $id('span_vREUCOD_' + idx);
            if (!nombreEl && !codEl) break;
            const fechaEl = $id('vCALIFXREUFEC_' + idx);
            const fecha = fechaEl ? String(fechaEl.value || '') : '';
            const juicioEl = $id('vCALIFXREUJUICIO_' + idx);
            const juicioReuEl = $id('span_CTLJFALXREUJUICIO_' + idx);
            const imgReu = $id('vIMGJUICIOREU_' + idx);
            let juicioReunion = texto(juicioReuEl);
            if (!juicioReunion && imgReu) juicioReunion = String(imgReu.getAttribute('alt') || '').replace(/^Juicio Reu\.?:\s*/i, '').trim();
            reuniones.push({
                codigo: texto(codEl),
                nombre: texto(nombreEl) || texto(codEl),
                rendimiento: textoSelect($id('vCALIFXREUCALIFCOD_' + idx)),
                conducta: textoSelect($id('vCALIFXREUCONCALIFCOD_' + idx)),
                calidad: textoSelect($id('vCALIDCOD_' + idx)),
                categoria: textoSelect($id('vCATCOD_' + idx)),
                fecha: /\d/.test(fecha) ? fecha.trim() : '',
                juicio: juicioEl ? String(juicioEl.value || '').trim() : '',
                juicioReunion
            });
        }
        return reuniones;
    }

    /** Enlaces de la botonera de alumnos (N° 1, 2, 3...). El actual no tiene enlace activo. */
    function enlacesAlumnos() {
        const cont = $id('TXTALUMNOS');
        if (!cont) return [];
        return Array.from(cont.querySelectorAll('a')).map(a => ({
            nro: texto(a),
            href: a.getAttribute('href') || '',
            actual: /desactivado/.test(a.className)
        })).filter(e => e.nro);
    }

    /** Lee el alumno que se muestra en la página de cierre */
    function leerAlumnoCierre() {
        const apellido = texto($id('TXTAPELLIDO'));
        const nombres = texto($id('TXTNOMBRES'));
        const alumno = {
            idx: '',
            nro: texto($id('TXTNROLISTA')).replace(/^N[°º]\s*/i, ''),
            apellido,
            nombres,
            nombre: `${apellido} ${nombres}`.trim(),
            documento: texto($id('TXTDOCUMENTO')),
            curso: texto($id('TXTCURSO')),
            origen: texto($id('TXTORIGEN')),
            antecedentes: texto($id('TXTANTECEDENTES')),
            diagnostico: texto($id('TXTDIAGNOSTICO')),
            semestrales: leerSemestrales($id('TXTCALIFICACION')),
            periodos: leerPeriodos(document.body), // la página muestra un solo alumno
            evaluaciones: leerEvaluaciones(''),
            reuniones: leerReuniones(),
            foto: fotoCierre(),
            escalaMax: escalaMaximaCierre(),
            detalleCargado: !!$id('GrillaevaldetalleContainerTbl')
        };
        alumno.asignaturasVisibles = alumno.periodos.some(p => p.materias && p.materias.length);
        asignarPeriodos(alumno);
        return alumno;
    }

    /** Foto del alumno en el cierre (fondo del contenedor TABLEFOTO) */
    function fotoCierre() {
        const cont = $id('TABLEFOTO');
        const el = cont && cont.querySelector('[style*="background-image"]');
        const m = el && String(el.getAttribute('style') || '').match(/url\((['"]?)([^'")]+)\1\)/);
        if (!m) return '';
        try { return new URL(m[2], location.href).href; } catch (e) { return m[2]; }
    }

    /** Nota máxima de la escala según las opciones del selector de rendimiento */
    function escalaMaximaCierre() {
        for (let r = 1; r <= 100; r++) {
            const sel = $id('vCALIFXREUCALIFCOD_' + idx4(r));
            if (!sel) break;
            const nums = Array.from(sel.options).map(o => parseInt(o.value, 10)).filter(n => !isNaN(n));
            if (nums.length) return Math.max.apply(null, nums);
        }
        return 0;
    }

    /** Enlace de SIGED "Mostrar/Ocultar todas las asignaturas" */
    function enlaceAsignaturasCierre() {
        const s = $id('TEXTDETALLE');
        return s ? (s.querySelector('a') || s) : null;
    }

    function libretaCierre() {
        return textoSelect($id('vLIBID')).replace(/^Seleccione.*$/i, '');
    }

    /** Hojas de juicios (formato ancho: un alumno por fila; y formato lista) */
    function hojasJuicios(alumnos) {
        const nombres = [];
        alumnos.forEach(a => (a.reuniones || []).forEach(r => { if (!nombres.includes(r.nombre)) nombres.push(r.nombre); }));
        const conDatos = nombres.filter(n => alumnos.some(a => (a.reuniones || []).some(r => r.nombre === n && (r.rendimiento || r.juicio || r.juicioReunion || r.calidad))));
        const tieneCalidad = alumnos.some(a => (a.reuniones || []).some(r => r.calidad));
        const tieneReu = alumnos.some(a => (a.reuniones || []).some(r => r.juicioReunion));
        const tieneConducta = alumnos.some(a => (a.reuniones || []).some(r => r.conducta));

        const encAncho = ['N°', 'Alumno', 'Documento'];
        const anchosAncho = [5, 34, 12];
        conDatos.forEach(n => {
            encAncho.push(n + ' - Rend.'); anchosAncho.push(10);
            if (tieneConducta) { encAncho.push(n + ' - Comp.'); anchosAncho.push(10); }
            if (tieneCalidad) { encAncho.push(n + ' - Calidad'); anchosAncho.push(14); }
            encAncho.push(n + ' - Juicio'); anchosAncho.push(60);
            if (tieneReu) { encAncho.push(n + ' - Juicio reunión'); anchosAncho.push(40); }
        });
        const filasAncho = alumnos.map(a => {
            const fila = [a.nro, a.nombre, a.documento];
            conDatos.forEach(n => {
                const r = (a.reuniones || []).find(x => x.nombre === n) || {};
                fila.push(r.rendimiento || '');
                if (tieneConducta) fila.push(r.conducta || '');
                if (tieneCalidad) fila.push(r.calidad || '');
                fila.push(r.juicio || '');
                if (tieneReu) fila.push(r.juicioReunion || '');
            });
            return fila;
        });

        const filasLista = [];
        alumnos.forEach(a => (a.reuniones || []).forEach(r => {
            if (!(r.rendimiento || r.juicio || r.juicioReunion || r.calidad || r.conducta)) return;
            filasLista.push([a.nro, a.nombre, r.nombre, r.rendimiento, r.conducta, r.calidad, r.fecha, r.juicio, r.juicioReunion]);
        }));

        return [
            { nombre: 'Juicios', encabezados: encAncho, filas: filasAncho, anchos: anchosAncho },
            { nombre: 'Juicios (lista)', encabezados: ['N°', 'Alumno', 'Reunión', 'Rend.', 'Comp.', 'Calidad', 'Fecha eval.', 'Juicio asignatura', 'Juicio reunión'],
              filas: filasLista, anchos: [5, 34, 24, 8, 8, 14, 12, 70, 40] }
        ];
    }

    /** Cantidad total de alumnos de la libreta (filtro "Filtrar por alumno") y nombre seleccionado */
    function totalAlumnosLibreta() {
        const sel = $id('vFALUAUTO');
        if (!sel) return 0;
        return Array.from(sel.options).filter(o => o.value.trim() !== '').length;
    }

    function botones() {
        return {
            todos: $id('BTNTODOS'),
            mostrarDetalleTodos: (() => { const s = $id('TXTMOSTRARTODOS'); return s ? (s.querySelector('a') || s) : null; })(),
            ocultarDetalleTodos: (() => { const s = $id('TXTOCULTARTODOS'); return s ? (s.querySelector('a') || s) : null; })()
        };
    }

    /**
     * Arma las hojas del Excel.
     * @param {Array} alumnos - lista de leerAlumnos() (ya filtrada si se exporta uno solo)
     * @returns {{hojas: Array<{nombre, encabezados, filas, anchos}>}}
     */
    function construirHojas(alumnos) {
        // --- Hoja Notas: una fila por evaluación ---
        const notas = [];
        alumnos.forEach(a => {
            if (a.evaluaciones.length === 0) {
                notas.push([a.nro, a.nombre, '', '', '', '', a.detalleCargado ? '(sin evaluaciones)' : '(detalle no cargado en SIGED)', '']);
                return;
            }
            a.evaluaciones.forEach(ev => notas.push([a.nro, a.nombre, ev.periodo, ev.fecha, ev.tipo, ev.nota, ev.comentario, ev.registradoPor]));
        });

        // --- Hoja Promedios: una fila por alumno y período ---
        const columnasPeriodo = [];
        const columnasInasist = [];
        alumnos.forEach(a => a.periodos.forEach(p => {
            p.orden.forEach(c => { if (!columnasPeriodo.includes(c)) columnasPeriodo.push(c); });
            Object.keys(p.inasistencias).forEach(c => { if (!columnasInasist.includes(c)) columnasInasist.push(c); });
        }));
        const etiquetaCol = c => (norm(c) === 'R' ? 'Rendimiento (R)' : c);
        const etiquetaIna = c => ({ J: 'Inasist. justificadas', NJ: 'Inasist. no justificadas', FIC: 'Inasist. fictas' }[norm(c)] || ('Inasist. ' + c));
        const promedios = [];
        alumnos.forEach(a => a.periodos.forEach(p => {
            promedios.push([a.nro, a.nombre, p.nombre]
                .concat(columnasPeriodo.map(c => p.columnas[c] === undefined ? '' : p.columnas[c]))
                .concat(columnasInasist.map(c => p.inasistencias[c] === undefined ? '' : p.inasistencias[c])));
        }));

        // --- Hoja Resumen: una fila por alumno ---
        const nombresSemestrales = [];
        const nombresPeriodos = [];
        alumnos.forEach(a => {
            a.semestrales.forEach(s => { if (!nombresSemestrales.includes(s.evaluacion)) nombresSemestrales.push(s.evaluacion); });
            a.periodos.forEach(p => { if (p.orden.some(c => norm(c) === 'R') && !nombresPeriodos.includes(p.nombre)) nombresPeriodos.push(p.nombre); });
        });
        const resumen = alumnos.map(a => {
            const fila = [a.nro, a.apellido, a.nombres, a.documento, a.curso, a.origen, a.antecedentes, a.diagnostico];
            nombresSemestrales.forEach(n => { const s = a.semestrales.find(x => x.evaluacion === n); fila.push(s ? s.calificacion : ''); });
            nombresPeriodos.forEach(n => {
                const p = a.periodos.find(x => x.nombre === n);
                const colR = p ? p.orden.find(c => norm(c) === 'R') : null;
                fila.push(p && colR ? p.columnas[colR] : '');
            });
            fila.push(a.evaluaciones.length);
            return fila;
        });

        const hojasPrevias = alumnos.some(a => a.reuniones && a.reuniones.length) ? hojasJuicios(alumnos) : [];
        return {
            hojas: hojasPrevias.concat([
                {
                    nombre: 'Notas',
                    encabezados: ['N°', 'Alumno', 'Período', 'Fecha', 'Tipo', 'Nota', 'Comentario', 'Registrado por'],
                    filas: notas,
                    anchos: [5, 34, 20, 12, 16, 9, 70, 22]
                },
                {
                    nombre: 'Promedios',
                    encabezados: ['N°', 'Alumno', 'Período'].concat(columnasPeriodo.map(etiquetaCol)).concat(columnasInasist.map(etiquetaIna)),
                    filas: promedios,
                    anchos: [5, 34, 26].concat(columnasPeriodo.map(() => 14)).concat(columnasInasist.map(() => 22))
                },
                {
                    nombre: 'Resumen',
                    encabezados: ['N°', 'Apellidos', 'Nombres', 'Documento', 'Curso/Gr/Asig', 'Origen', 'Antecedentes', 'Diagnóstico']
                        .concat(nombresSemestrales.map(n => 'Calif. ' + n))
                        .concat(nombresPeriodos.map(n => 'Rendimiento ' + n))
                        .concat(['Cant. evaluaciones']),
                    filas: resumen,
                    anchos: [5, 24, 20, 12, 24, 16, 40, 40].concat(nombresSemestrales.map(() => 16)).concat(nombresPeriodos.map(() => 22)).concat([12])
                }
            ])
        };
    }

    global.SigedDetalle = {
        detectar, leerAlumnos, totalAlumnosLibreta, botones, construirHojas, colorATexto,
        detectarCierre, leerAlumnoCierre, enlacesAlumnos, libretaCierre, enlaceAsignaturasCierre
    };
})(typeof window !== 'undefined' ? window : globalThis);
