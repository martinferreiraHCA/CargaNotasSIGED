// ========== LECTURA DE "CORRECTOR POR CURSO" (un alumno, todas sus materias) ==========
// Página de SIGED donde el corrector/visador ve a un alumno con el rendimiento de
// todas sus asignaturas en la reunión actual, las evaluaciones anteriores, el juicio
// de reunión, las inasistencias y la foto. El asistente arma con eso una mini ficha.
//
// La grilla de materias la dibuja GeneXus a partir de dos datos que quedan en la página:
//   • input[name=GrillaContainerDataV]  → filas de la grilla (array de arrays)
//   • input[name=GXState] → "GrillaContainerData" con el orden de columnas (Props de la fila 0)
//     y los títulos de las evaluaciones anteriores (vCALIFXREUCALIFCODn_Title).
// Así no dependemos de posiciones fijas ni de que la grilla ya esté renderizada.

(function (global) {
    'use strict';

    const $id = (id) => document.getElementById(id);
    const texto = (el) => (el ? String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');

    function detectar() {
        return !!($id('TXTAPELLIDOS') && $id('GrillaContainerDiv') && document.querySelector('input[name="GrillaContainerDataV"]'));
    }

    function leerJSON(valor) {
        try { return JSON.parse(valor); } catch (e) { return null; }
    }

    function estadoGX() {
        const inp = document.querySelector('input[name="GXState"]');
        if (!inp) return {};
        return leerJSON(inp.value) || {};
    }

    /** Orden de columnas de la grilla: nombre de control (sin sufijo de fila) → índice */
    function mapaColumnas(st) {
        let gd = st.GrillaContainerData;
        if (typeof gd === 'string') gd = leerJSON(gd);
        const fila0 = gd && gd['0'];
        if (!fila0 || !Array.isArray(fila0.Props)) return null;
        const mapa = {};
        fila0.Props.forEach((p, i) => {
            if (!Array.isArray(p)) return;
            const nombre = p.find(x => typeof x === 'string' && /^[A-Za-z]/.test(x));
            if (nombre) mapa[nombre.replace(/_\d{4}$/, '')] = i;
        });
        return mapa;
    }

    function numero(v) {
        const s = String(v === null || v === undefined ? '' : v).trim().replace(',', '.');
        if (!s) return null;
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
    }

    /** Nota mínima de aprobación según la escala (N10-EBI: 5; escalas de 12: 6) */
    function minimoAprobacion(escala) {
        const e = String(escala || '').toUpperCase();
        if (/12/.test(e)) return 6;
        if (/10/.test(e)) return 5;
        return 6;
    }

    function esRojo(el) {
        if (!el) return null;
        const c = getComputedStyle(el).color.match(/\d+/g);
        if (!c || c.length < 3) return null;
        const [r, g, b] = c.map(Number);
        return r > 150 && g < 90 && b < 90;
    }

    /** Lee el alumno que muestra la página */
    function leerAlumno() {
        const st = estadoGX();
        const mapa = mapaColumnas(st) || {};
        const inpDatos = document.querySelector('input[name="GrillaContainerDataV"]');
        const filas = (inpDatos && leerJSON(inpDatos.value)) || [];

        const idx = (nombre, porDefecto) => (mapa[nombre] !== undefined ? mapa[nombre] : porDefecto);
        const iMateria = idx('CTLSUBDSC', 4);
        const iNota = idx('CTLCALIFXREUCALIFCOD', 8);
        const iComp = idx('CTLCALIFXREUCONCALIFCOD', 7);
        const iJuicio = idx('vCALIFXREUJUICIO', 12);
        const iFictas = idx('vFICTO', 13);
        const iEscala = idx('CTLCALIFXREUESCCOD', 2);

        // Columnas de evaluaciones anteriores visibles, en orden cronológico (1 = la más antigua)
        const anteriores = [];
        for (let n = 1; n <= 20; n++) {
            const clave = 'vCALIFXREUCALIFCOD' + n;
            if (mapa[clave] === undefined) continue;
            const visible = st[clave + '_Visible'];
            const titulo = String(st[clave + '_Title'] || '').trim();
            if (String(visible) === '0' || !titulo) continue;
            anteriores.push({ clave, titulo, indice: mapa[clave], orden: n });
        }
        anteriores.sort((a, b) => a.orden - b.orden);

        const escala = filas.length ? String(filas[0][iEscala] || st.CALIFXREUESCCOD || '') : String(st.CALIFXREUESCCOD || '');
        const minimo = minimoAprobacion(escala);

        const materias = filas.map((f, r) => {
            const sufijo = String(r + 1).padStart(4, '0');
            const nota = String(f[iNota] || '').trim();
            const notaNum = numero(nota);
            const celda = $id('span_CTLCALIFXREUCALIFCOD_' + sufijo) || $id('CTLCALIFXREUCALIFCOD_' + sufijo);
            const rojo = esRojo(celda);
            const anterioresMateria = {};
            anteriores.forEach(a => { anterioresMateria[a.clave] = String(f[a.indice] || '').trim(); });
            return {
                nombre: String(f[iMateria] || '').trim(),
                nota,
                notaNum,
                comportamiento: String(f[iComp] || '').trim(),
                juicio: String(f[iJuicio] || '').trim(),
                fictas: String(f[iFictas] || '').trim(),
                anteriores: anterioresMateria,
                baja: rojo !== null ? rojo : (notaNum !== null && notaNum < minimo)
            };
        }).filter(m => m.nombre);

        const foto = $id('IMGALUMNO');
        const titulo = texto($id('TXTTITULO'));
        const mPeriodo = titulo.match(/-\s*([^-]+?)\s*\(\d{2}\/\d{2}\/\d{2,4}\)\s*$/);
        const apellidos = texto($id('TXTAPELLIDOS'));
        const nombres = texto($id('TXTNOMBRES'));
        const tardes = texto($id('TXTTARDES'));

        return {
            apellidos,
            nombres,
            nombre: `${apellidos} ${nombres}`.trim(),
            documento: texto($id('TXTDOCUMENTO')),
            foto: foto && foto.src ? foto.src : '',
            titulo,
            periodo: mPeriodo ? mPeriodo[1].trim() : '',
            visado: /visado/i.test(texto($id('TXTVISADO'))) && !/no visado/i.test(texto($id('TXTVISADO'))),
            faltas: {
                justificadas: texto($id('TXTJUST')),
                injustificadas: texto($id('TXTINJUS')),
                fictas: texto($id('TXTFICTO')),
                tardes: /^\d+$/.test(tardes) ? tardes : ''
            },
            juicioGeneral: ($id('vJFALXREUJUICIO') && $id('vJFALXREUJUICIO').value || '').trim(),
            escala,
            minimo,
            anteriores,
            materias
        };
    }

    /** Elige con qué evaluación anterior comparar: la última que no sea examen/semestral */
    function comparacionPorDefecto(alumno) {
        const normales = alumno.anteriores.filter(a => !/sem|ex|ape|prec/i.test(a.titulo));
        const lista = normales.length ? normales : alumno.anteriores;
        return lista.length ? lista[lista.length - 1].clave : '';
    }

    function promedio(valores) {
        const nums = valores.filter(v => v !== null);
        if (!nums.length) return null;
        return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 10) / 10;
    }

    /** Resumen para la mini ficha */
    function resumen(alumno, claveComparacion) {
        const clave = claveComparacion || comparacionPorDefecto(alumno);
        const col = alumno.anteriores.find(a => a.clave === clave) || null;
        const conNota = alumno.materias.filter(m => m.notaNum !== null);
        const res = {
            comparacion: col,
            cantidad: conNota.length,
            promedio: promedio(conNota.map(m => m.notaNum)),
            promedioAnterior: col ? promedio(alumno.materias.map(m => numero(m.anteriores[col.clave]))) : null,
            bajas: alumno.materias.filter(m => m.baja),
            subieron: [], bajaron: [], iguales: [], sinDato: []
        };
        if (col) {
            alumno.materias.forEach(m => {
                const ant = numero(m.anteriores[col.clave]);
                if (m.notaNum === null || ant === null) { res.sinDato.push(m); return; }
                const item = { nombre: m.nombre, antes: ant, ahora: m.notaNum, dif: m.notaNum - ant };
                if (item.dif > 0) res.subieron.push(item);
                else if (item.dif < 0) res.bajaron.push(item);
                else res.iguales.push(item);
            });
            res.subieron.sort((a, b) => b.dif - a.dif);
            res.bajaron.sort((a, b) => a.dif - b.dif);
        }
        return res;
    }

    /**
     * Arma, a partir de un alumno de "Cierre de promedios por alumno" (SigedDetalle.leerAlumnoCierre con
     * "Mostrar todas las asignaturas" activo), un objeto con la misma forma que leerAlumno() para
     * reutilizar resumen() y la mini ficha. El período actual es el último con notas por materia.
     */
    function fichaDesdeCierre(c) {
        const conNotas = (c.periodos || []).filter(p => (p.materias || []).some(m => m.nota));
        if (!conNotas.length) return null;
        const actual = conNotas[conNotas.length - 1];
        const previos = conNotas.slice(0, -1);
        const minimo = c.escalaMax >= 12 ? 6 : (c.escalaMax >= 10 ? 5 : 6);
        const anteriores = previos.map((p, i) => ({ clave: 'p' + i, titulo: p.nombre, orden: i }));
        const materias = actual.materias.map(m => {
            const ant = {};
            previos.forEach((p, i) => {
                const x = (p.materias || []).find(y => y.nombre === m.nombre);
                ant['p' + i] = x ? x.nota : '';
            });
            const n = numero(m.nota);
            return { nombre: m.nombre, nota: m.nota, notaNum: n, comportamiento: '', juicio: '', fictas: '', anteriores: ant, baja: n !== null && n < minimo };
        });
        const ina = actual.inasistencias || {};
        const semestral = (c.semestrales || []).map(s => `${s.evaluacion}: ${s.calificacion}`).join(' · ');
        return {
            apellidos: c.apellido, nombres: c.nombres, nombre: c.nombre, documento: c.documento,
            foto: c.foto || '', titulo: c.curso || '', periodo: actual.nombre, visado: null, extra: semestral,
            faltas: { justificadas: ina.J || '', injustificadas: ina.NJ || '', fictas: ina.Fic || '', tardes: '' },
            juicioGeneral: '', escala: c.escalaMax ? 'N' + c.escalaMax : '', minimo, anteriores, materias
        };
    }

    global.SigedCorrector = { detectar, leerAlumno, resumen, comparacionPorDefecto, minimoAprobacion, fichaDesdeCierre };
})(typeof window !== 'undefined' ? window : globalThis);
