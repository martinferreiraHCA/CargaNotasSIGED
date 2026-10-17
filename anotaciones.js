// ========== PÁGINA "ANOTACIONES PARA EL JUICIO" ==========
// Un registro por alumno y libreta con entradas fechadas (etiquetas rápidas + texto libre).
// Se guarda en el almacén de la extensión (chrome.storage.local) bajo "anotaciones:<clave de libreta>"
// y el panel de SIGED las recuerda en el boletín. Si Google Drive está conectado, se sincroniza.

(function () {
    'use strict';

    const A = window.SigedAlmacen;
    const M = window.SigedMatching;
    const F = window.SigedFormatos;
    const $ = (id) => document.getElementById(id);
    const escapeHtml = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const idAlumno = (nombre) => M.tokens(nombre).join(' ');

    const ETIQUETAS = [
        ['Participa', 'positivo'], ['Colabora', 'positivo'], ['Buen trabajo', 'positivo'], ['Mejoró', 'positivo'], ['Responsable', 'positivo'],
        ['No entrega tareas', 'negativo'], ['Distraído/a', 'negativo'], ['Llega tarde', 'negativo'], ['Falta material', 'negativo'], ['Conducta', 'negativo'],
        ['Necesita apoyo', ''], ['Hablar con la familia', ''], ['Pendiente', '']
    ];

    const estado = {
        clave: new URLSearchParams(location.search).get('libreta') || '',
        registros: {},      // clave → datos {libreta, modificado, lista, alumnos}
        libretas: {},       // 'libreta:...' → {nombre, alumnos: [{nombre, foto}]} (para las fotos)
        alumnos: [],        // [{id, nombre, apellido, nombrePila, foto, rec}]
        seleccionado: '',
        etiquetasElegidas: new Set(),
        filtro: ''
    };
    let temporizador = null;

    function mensaje(tipo, texto) { const m = $('mensaje'); m.className = 'mensaje ' + tipo; m.textContent = texto; }
    const datos = () => estado.registros[estado.clave] || null;
    const nombreLibreta = (clave) => { const d = estado.registros[clave]; return (d && d.libreta) || clave.replace(/^.*\|n:/, ''); };

    /** Nombre de libreta normalizado como en la clave (host|n:NOMBRE) */
    const parteNombre = (clave) => clave.replace(/^.*\|n:/, '');

    function fotosDeLibreta() {
        const objetivo = parteNombre(estado.clave);
        const host = estado.clave.split('|')[0];
        const candidatas = Object.values(estado.libretas).filter(l => l && M.normalizeText(l.nombre || '') === M.normalizeText(objetivo) && (!l.host || l.host === host));
        const fichas = candidatas.length ? candidatas[0].alumnos || [] : [];
        return fichas.map(a => ({ nombre: a.nombre, apellido: a.apellido, nombrePila: a.nombrePila, foto: a.foto, tok: M.tokens(a.nombre) }));
    }

    /** Arma la lista de alumnos: lista de la página de SIGED ∪ registros con anotaciones, con las fotos de la libreta si las hay */
    function armarAlumnos() {
        const d = datos();
        const lista = [];
        const vistos = new Set();
        const agregar = (nombre) => { const id = idAlumno(nombre); if (!id || vistos.has(id)) return; vistos.add(id); lista.push({ id, nombre, tok: M.tokens(nombre) }); };
        if (d) {
            (d.lista || []).forEach(agregar);
            Object.keys(d.alumnos || {}).forEach(id => {
                const rec = d.alumnos[id];
                // Un registro ya cubierto por un nombre de la lista (nombre abreviado vs completo) no se duplica
                const asig = M.findBestMatch(lista, M.tokens(rec.nombre || id), 0.7);
                if (!asig) agregar(rec.nombre || id);
            });
        }
        const fichas = fotosDeLibreta();
        if (!lista.length) fichas.forEach(f => agregar(f.nombre));
        // fotos y nombre partido
        if (fichas.length) {
            const asig = M.asignarUnico(lista, fichas, 0.7);
            asig.forEach((a, i) => { if (a) { lista[i].foto = a.entrada.foto; lista[i].apellido = a.entrada.apellido; lista[i].nombrePila = a.entrada.nombrePila; } });
        }
        // registro de anotaciones de cada alumno (matching tolerante)
        if (d) {
            const recs = Object.keys(d.alumnos || {}).map(id => ({ id, tok: M.tokens(d.alumnos[id].nombre || id) }));
            const asig = M.asignarUnico(lista, recs, 0.7);
            asig.forEach((a, i) => { lista[i].recId = a ? a.entrada.id : null; });
        }
        lista.forEach(a => {
            if (!a.apellido) { const partes = a.nombre.split(/\s+/); const may = partes.filter(p => p === p.toLocaleUpperCase('es') && /\p{L}/u.test(p)); a.apellido = may.length ? may.join(' ') : partes[0]; a.nombrePila = partes.filter(p => !may.includes(p)).join(' ') || (may.length ? '' : partes.slice(1).join(' ')); }
        });
        lista.sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
        estado.alumnos = lista;
    }

    function registroDe(alumno, crear) {
        const d = datos();
        if (!d) return null;
        d.alumnos = d.alumnos || {};
        if (alumno.recId && d.alumnos[alumno.recId]) return d.alumnos[alumno.recId];
        if (!crear) return null;
        d.alumnos[alumno.id] = { nombre: alumno.nombre, texto: '', fecha: 0, entradas: [] };
        alumno.recId = alumno.id;
        return d.alumnos[alumno.id];
    }

    const entradasDe = (rec) => {
        if (!rec) return [];
        if (!Array.isArray(rec.entradas)) {
            // registro viejo (texto suelto): se convierte en una entrada
            rec.entradas = rec.texto ? [{ id: nuevoId(), fecha: rec.fecha || Date.now(), texto: rec.texto, etiquetas: [] }] : [];
        }
        return rec.entradas;
    };

    /** Texto que el panel pega en el juicio: entradas en orden, con sus etiquetas */
    function compilarTexto(rec) {
        return entradasDe(rec).map(e => {
            const etq = (e.etiquetas || []).join(', ');
            const t = String(e.texto || '').trim();
            return etq && t ? `${etq}: ${t}` : (etq || t);
        }).filter(Boolean).join('. ').replace(/\.\./g, '.');
    }

    // ---------------------------------------------------------------- carga / guardado
    async function cargar() {
        const todo = await A.listar('anotaciones:');
        estado.registros = {};
        Object.keys(todo).forEach(k => { estado.registros[k.slice('anotaciones:'.length)] = todo[k]; });
        estado.libretas = await A.listar('libreta:');
        if (!estado.clave || !estado.registros[estado.clave]) {
            if (estado.clave && !estado.registros[estado.clave]) {
                estado.registros[estado.clave] = { libreta: parteNombre(estado.clave), modificado: 0, lista: [], alumnos: {} };
            } else {
                const claves = Object.keys(estado.registros);
                estado.clave = claves.length ? claves[0] : '';
            }
        }
        armarAlumnos();
        if (!estado.alumnos.find(a => a.id === estado.seleccionado)) estado.seleccionado = '';
        render();
    }

    function guardar() {
        const d = datos(); if (!d) return;
        d.modificado = Date.now();
        Object.keys(d.alumnos).forEach(id => {
            const rec = d.alumnos[id];
            rec.texto = compilarTexto(rec);
            rec.fecha = entradasDe(rec).reduce((m, e) => Math.max(m, e.fecha || 0), 0);
            if (!rec.entradas.length) delete d.alumnos[id];
        });
        $('estadoGuardado').textContent = 'Guardando…';
        clearTimeout(temporizador);
        temporizador = setTimeout(async () => {
            try {
                await A.set({ ['anotaciones:' + estado.clave]: d });
                $('estadoGuardado').textContent = '✓ Guardado en este navegador';
                try { chrome.runtime.sendMessage({ action: 'drive', op: 'sincronizar', silencioso: true }, () => void chrome.runtime.lastError); } catch (e) { /* sin extensión */ }
            } catch (e) { $('estadoGuardado').textContent = '⚠ No se pudo guardar'; mensaje('error', 'No se pudo guardar: ' + e.message); }
        }, 300);
    }

    // ---------------------------------------------------------------- acciones
    function agregarEntrada() {
        const al = estado.alumnos.find(a => a.id === estado.seleccionado); if (!al) return;
        const texto = $('textoNuevo').value.trim();
        const etiquetas = Array.from(estado.etiquetasElegidas);
        if (!texto && !etiquetas.length) { mensaje('aviso', 'Escribí algo o elegí una etiqueta.'); return; }
        const fechaStr = $('fechaNueva').value;
        const fecha = fechaStr ? new Date(fechaStr + 'T12:00:00').getTime() : Date.now();
        const rec = registroDe(al, true);
        entradasDe(rec).push({ id: nuevoId(), fecha, texto, etiquetas });
        estado.etiquetasElegidas.clear();
        guardar();
        render();
        mensaje('ok', `Anotación agregada para ${al.nombre}.`);
    }

    function borrarEntrada(id) {
        const al = estado.alumnos.find(a => a.id === estado.seleccionado); if (!al) return;
        const rec = registroDe(al, false); if (!rec) return;
        rec.entradas = entradasDe(rec).filter(e => e.id !== id);
        guardar();
        armarAlumnos();
        render();
    }

    function exportarExcel() {
        const d = datos(); if (!d) return;
        const filas = [];
        estado.alumnos.forEach(a => {
            const rec = registroDe(a, false);
            entradasDe(rec).slice().sort((x, y) => x.fecha - y.fecha).forEach(e => filas.push([a.nombre, e.fecha ? new Date(e.fecha).toLocaleDateString('es-UY') : '', (e.etiquetas || []).join(', '), e.texto || '']));
        });
        const resumen = estado.alumnos.map(a => [a.nombre, compilarTexto(registroDe(a, false))]).filter(r => r[1]);
        if (!filas.length) { mensaje('aviso', 'No hay anotaciones para exportar.'); return; }
        try {
            const nombre = F.descargarLibro({
                hojas: [
                    { nombre: 'Anotaciones', encabezados: ['Estudiante', 'Fecha', 'Etiquetas', 'Anotación'], filas, anchos: [38, 12, 30, 70] },
                    { nombre: 'Resumen', encabezados: ['Estudiante', 'Para el juicio'], filas: resumen, anchos: [38, 100] }
                ],
                info: [['Libreta', nombreLibreta(estado.clave)], ['Generado por', 'Asistente de SIGED'], ['Fecha', new Date().toLocaleDateString('es-UY')]],
                nombreBase: ['Anotaciones', nombreLibreta(estado.clave), new Date().toISOString().slice(0, 10)]
            });
            mensaje('ok', 'Archivo descargado: ' + nombre);
        } catch (e) { mensaje('error', 'No se pudo generar el archivo: ' + e.message); }
    }

    // ---------------------------------------------------------------- render
    function render() {
        const ls = $('libretaSelect');
        const claves = Object.keys(estado.registros);
        ls.innerHTML = claves.map(k => `<option value="${escapeHtml(k)}" ${k === estado.clave ? 'selected' : ''}>${escapeHtml(nombreLibreta(k))}</option>`).join('') || '<option value="">Sin libretas</option>';
        ls.style.display = claves.length > 1 ? '' : 'none';
        document.title = `Anotaciones · ${nombreLibreta(estado.clave) || 'Asistente de SIGED'}`;

        const filtro = M.normalizeText(estado.filtro);
        const visibles = estado.alumnos.filter(a => !filtro || M.normalizeText(a.nombre).includes(filtro));
        $('cantAlumnos').textContent = estado.alumnos.length;
        $('lista').innerHTML = visibles.map(a => {
            const n = entradasDe(registroDe(a, false)).length;
            return `<div class="alumno ${a.id === estado.seleccionado ? 'activo' : ''}" data-id="${escapeHtml(a.id)}">
                ${a.foto ? `<img src="${escapeHtml(a.foto)}" alt="">` : `<div class="inicial">${escapeHtml((a.apellido || a.nombre).charAt(0))}</div>`}
                <div class="nom"><b>${escapeHtml(a.apellido || '')}</b>${escapeHtml(a.nombrePila || '')}</div>
                <span class="cant ${n ? '' : 'cero'}">${n}</span>
            </div>`;
        }).join('') || `<div class="vacio">${estado.alumnos.length ? 'Ningún alumno coincide.' : 'Abrí una página de la libreta en SIGED y tocá "Abrir las anotaciones" en el asistente para traer la lista de alumnos.'}</div>`;

        const al = estado.alumnos.find(a => a.id === estado.seleccionado);
        const det = $('detalle');
        if (!al) { det.innerHTML = '<div class="vacio">Elegí un alumno de la lista.</div>'; return; }
        const rec = registroDe(al, false);
        const entradas = entradasDe(rec).slice().sort((x, y) => y.fecha - x.fecha);
        const hoy = new Date(); const fechaHoy = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
        det.innerHTML = `
            <div class="cab">
                ${al.foto ? `<img src="${escapeHtml(al.foto)}" alt="">` : `<div class="inicial">${escapeHtml((al.apellido || al.nombre).charAt(0))}</div>`}
                <div><h3>${escapeHtml(al.nombre)}</h3><div class="sub">${escapeHtml(nombreLibreta(estado.clave))} · ${entradas.length} anotación${entradas.length === 1 ? '' : 'es'}</div></div>
            </div>
            <div class="chips" id="chips">${ETIQUETAS.map(([e, tipo]) => `<span class="chip ${tipo} ${estado.etiquetasElegidas.has(e) ? 'on' : ''}" data-etq="${escapeHtml(e)}">${escapeHtml(e)}</span>`).join('')}</div>
            <textarea id="textoNuevo" placeholder="Qué pasó, qué querés recordar para el juicio… (opcional si elegiste etiquetas)"></textarea>
            <div class="fila">
                <input type="date" id="fechaNueva" value="${fechaHoy}" title="Fecha de la anotación">
                <button class="btn btn-morado" id="btnAgregar">＋ Agregar anotación</button>
            </div>
            <div class="entradas" id="entradas">${entradas.map(e => `<div class="entrada" data-id="${e.id}">
                <div class="fecha">${e.fecha ? new Date(e.fecha).toLocaleDateString('es-UY') : ''}</div>
                <div class="cuerpo">${(e.etiquetas || []).map(t => `<span class="etq">${escapeHtml(t)}</span>`).join('')}${e.texto ? `<div>${escapeHtml(e.texto)}</div>` : ''}</div>
                <button class="borrar" data-borrar="${e.id}" title="Borrar esta anotación">✕</button>
            </div>`).join('') || '<div class="vacio" style="padding:14px">Todavía no hay anotaciones para este alumno.</div>'}</div>
            ${entradas.length ? `<div class="resumen"><h4>Así lo va a pegar el asistente en el juicio (podés editarlo ahí)</h4><div class="texto" id="resumenTexto">${escapeHtml(compilarTexto(rec))}</div>
                <div class="fila"><button class="btn btn-gris btn-chico" id="btnCopiar">📋 Copiar texto</button></div></div>` : ''}`;
        $('btnAgregar').addEventListener('click', agregarEntrada);
        $('textoNuevo').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) agregarEntrada(); });
        const copiar = $('btnCopiar');
        if (copiar) copiar.addEventListener('click', () => { navigator.clipboard.writeText($('resumenTexto').textContent).then(() => mensaje('ok', 'Texto copiado.')).catch(() => mensaje('aviso', 'No se pudo copiar.')); });
    }

    // ---------------------------------------------------------------- eventos
    document.addEventListener('click', (ev) => {
        const al = ev.target.closest('.alumno');
        if (al) { estado.seleccionado = al.dataset.id; estado.etiquetasElegidas.clear(); render(); return; }
        const chip = ev.target.closest('.chip');
        if (chip) { const e = chip.dataset.etq; if (estado.etiquetasElegidas.has(e)) estado.etiquetasElegidas.delete(e); else estado.etiquetasElegidas.add(e); chip.classList.toggle('on', estado.etiquetasElegidas.has(e)); return; }
        const b = ev.target.closest('[data-borrar]');
        if (b) borrarEntrada(b.dataset.borrar);
    });
    $('buscar').addEventListener('input', (ev) => { estado.filtro = ev.target.value; render(); });
    $('libretaSelect').addEventListener('change', (ev) => { estado.clave = ev.target.value; estado.seleccionado = ''; history.replaceState(null, '', '?libreta=' + encodeURIComponent(estado.clave)); armarAlumnos(); render(); });
    $('btnExcel').addEventListener('click', exportarExcel);
    $('btnImprimir').addEventListener('click', () => window.print());
    try { chrome.runtime.onMessage.addListener((req) => { if (req && req.action === 'driveActualizado') cargar(); }); } catch (e) { /* sin extensión */ }

    window.AnotacionesApp = { estado, cargar, compilarTexto };
    cargar();
})();
