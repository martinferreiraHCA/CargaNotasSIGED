// ========== PÁGINA "ARMAR GRUPOS" ==========
// Fichas de los alumnos de una libreta (con sus fotos, guardadas desde el Libro del
// Profesor) para repartirlos en grupos por actividad, ponerles nota y mandarlas al
// asistente para cargarlas en SIGED. Todo queda guardado en el navegador.

(function () {
    'use strict';

    const A = window.SigedAlmacen;
    const F = window.SigedFormatos;
    const M = window.SigedMatching;
    const $ = (id) => document.getElementById(id);

    const estado = {
        libretaId: new URLSearchParams(location.search).get('libreta') || '',
        libreta: null,          // {id, nombre, alumnos: [{id, nombre, apellido, nombrePila, foto}]}
        libretas: {},           // todas las guardadas (para el selector)
        actividades: [],        // [{id, nombre, creada, modificada, grupos: [{id, nombre, nota, comentario, miembros: [], notas: {}}]}]
        actividadId: '',
        elegidos: new Set(), // fichas tocadas para mandarlas a un grupo de un solo clic
        guardado: null
    };

    const escapeHtml = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const actividad = () => estado.actividades.find(a => a.id === estado.actividadId) || null;

    function mensaje(tipo, texto) {
        const el = $('mensaje');
        el.className = 'mensaje ' + (tipo || '');
        el.textContent = texto || '';
        if (tipo === 'ok' || tipo === 'info') setTimeout(() => { if (el.textContent === texto) el.className = 'mensaje'; }, 6000);
    }

    // ---------------------------------------------------------------- carga
    async function cargar() {
        estado.libretas = await A.listar('libreta:');
        if (!estado.libretaId) {
            const claves = Object.keys(estado.libretas).sort((x, y) => (estado.libretas[y].actualizado || 0) - (estado.libretas[x].actualizado || 0));
            estado.libretaId = claves.length ? claves[0].slice('libreta:'.length) : '';
        }
        estado.libreta = estado.libretas['libreta:' + estado.libretaId] || null;
        const res = await A.get('actividades:' + estado.libretaId);
        estado.actividades = res['actividades:' + estado.libretaId] || [];
        estado.actividades.forEach(a => a.grupos.forEach(g => { g.notas = g.notas || {}; g.miembros = g.miembros || []; }));
        if (!estado.actividadId || !actividad()) {
            estado.actividades.sort((x, y) => (y.modificada || 0) - (x.modificada || 0));
            estado.actividadId = estado.actividades.length ? estado.actividades[0].id : '';
        }
        render();
    }

    let temporizador = null;
    function guardar() {
        const act = actividad();
        if (act) act.modificada = Date.now();
        $('estadoGuardado').textContent = 'Guardando…';
        clearTimeout(temporizador);
        temporizador = setTimeout(async () => {
            try {
                await A.set({ ['actividades:' + estado.libretaId]: estado.actividades });
                $('estadoGuardado').textContent = '✓ Guardado en este navegador';
            } catch (e) {
                $('estadoGuardado').textContent = '⚠ No se pudo guardar';
                mensaje('error', 'No se pudo guardar: ' + e.message);
            }
        }, 300);
    }

    // ---------------------------------------------------------------- actividades
    function pedirNombre(titulo, valor) {
        return new Promise(resolve => {
            const d = $('dialogoNombre');
            $('dialogoTitulo').textContent = titulo;
            const input = $('dialogoInput');
            input.value = valor || '';
            const cerrar = (v) => { d.close(); $('dialogoAceptar').onclick = null; $('dialogoCancelar').onclick = null; input.onkeydown = null; resolve(v); };
            $('dialogoAceptar').onclick = () => cerrar(input.value.trim());
            $('dialogoCancelar').onclick = () => cerrar(null);
            input.onkeydown = (ev) => { if (ev.key === 'Enter') cerrar(input.value.trim()); if (ev.key === 'Escape') cerrar(null); };
            d.showModal();
            input.focus(); input.select();
        });
    }

    async function nuevaActividad() {
        if (!estado.libreta) return;
        const nombre = await pedirNombre('Nombre de la nueva actividad', '');
        if (!nombre) return;
        const act = { id: nuevoId(), nombre, creada: Date.now(), modificada: Date.now(), grupos: [] };
        estado.actividades.unshift(act);
        estado.actividadId = act.id;
        guardar(); render();
        mensaje('info', 'Actividad creada. Repartí a los alumnos con "Al azar" o arrastrá las fichas a los grupos.');
    }

    async function renombrarActividad() {
        const act = actividad(); if (!act) return;
        const nombre = await pedirNombre('Nuevo nombre de la actividad', act.nombre);
        if (!nombre) return;
        act.nombre = nombre; guardar(); render();
    }

    async function duplicarActividad() {
        const act = actividad(); if (!act) return;
        const nombre = await pedirNombre('Nombre de la copia (mismos grupos, sin notas)', act.nombre + ' (copia)');
        if (!nombre) return;
        const copia = { id: nuevoId(), nombre, creada: Date.now(), modificada: Date.now(),
            grupos: act.grupos.map(g => ({ id: nuevoId(), nombre: g.nombre, nota: '', comentario: '', miembros: g.miembros.slice(), notas: {} })) };
        estado.actividades.unshift(copia);
        estado.actividadId = copia.id;
        guardar(); render();
        mensaje('ok', 'Grupos copiados a "' + nombre + '". Las notas arrancan vacías.');
    }

    function borrarActividad() {
        const act = actividad(); if (!act) return;
        if (!confirm(`¿Borrar la actividad "${act.nombre}" con sus grupos y notas?`)) return;
        estado.actividades = estado.actividades.filter(a => a.id !== act.id);
        estado.actividadId = estado.actividades.length ? estado.actividades[0].id : '';
        guardar(); render();
    }

    // ---------------------------------------------------------------- grupos
    function alumnosSinGrupo(act) {
        const enGrupo = new Set();
        act.grupos.forEach(g => g.miembros.forEach(id => enGrupo.add(id)));
        return estado.libreta.alumnos.filter(a => !enGrupo.has(a.id));
    }

    function repartir(porCantidad, n, azar) {
        const act = actividad(); if (!act || !estado.libreta) return;
        const total = estado.libreta.alumnos.length;
        if (!n || n < 1) return;
        const cantidad = porCantidad ? Math.min(n, total) : Math.ceil(total / n);
        if (act.grupos.some(g => g.miembros.length || g.nota) && !confirm('Esto rearma todos los grupos de esta actividad. ¿Seguimos?')) return;
        let alumnos = estado.libreta.alumnos.slice();
        if (azar) {
            for (let i = alumnos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [alumnos[i], alumnos[j]] = [alumnos[j], alumnos[i]]; }
        }
        const grupos = [];
        for (let i = 0; i < cantidad; i++) grupos.push({ id: nuevoId(), nombre: 'Grupo ' + (i + 1), nota: '', comentario: '', miembros: [], notas: {} });
        alumnos.forEach((a, i) => grupos[i % cantidad].miembros.push(a.id));
        act.grupos = grupos;
        guardar(); render();
        mensaje('ok', `${total} alumnos repartidos en ${cantidad} grupos${azar ? ' al azar' : ' en orden de lista'}.`);
    }

    function agregarGrupo() {
        const act = actividad(); if (!act) return;
        act.grupos.push({ id: nuevoId(), nombre: 'Grupo ' + (act.grupos.length + 1), nota: '', comentario: '', miembros: [], notas: {} });
        guardar(); render();
    }

    function quitarGrupo(gid) {
        const act = actividad(); if (!act) return;
        const g = act.grupos.find(x => x.id === gid); if (!g) return;
        if (g.miembros.length && !confirm(`¿Quitar "${g.nombre}"? Sus ${g.miembros.length} integrantes pasan a Sin grupo.`)) return;
        act.grupos = act.grupos.filter(x => x.id !== gid);
        guardar(); render();
    }

    function vaciarGrupos() {
        const act = actividad(); if (!act) return;
        if (!confirm('¿Pasar a todos los alumnos a "Sin grupo"? Los grupos quedan vacíos.')) return;
        act.grupos.forEach(g => { g.miembros = []; g.notas = {}; });
        guardar(); render();
    }

    function moverVarios(ids, gid) {
        const act = actividad(); if (!act) return;
        ids.forEach(id => mover(id, gid, true));
        estado.elegidos.clear();
        guardar(); render();
    }

    function mover(alumnoId, gid, sinRender) {
        const act = actividad(); if (!act) return;
        act.grupos.forEach(g => { g.miembros = g.miembros.filter(id => id !== alumnoId); delete g.notas[alumnoId]; });
        if (gid) { const g = act.grupos.find(x => x.id === gid); if (g) g.miembros.push(alumnoId); }
        estado.elegidos.delete(alumnoId);
        if (!sinRender) { guardar(); render(); }
    }

    // ---------------------------------------------------------------- notas → asistente / Excel
    function entradasDeNotas(act) {
        const entradas = [];
        act.grupos.forEach(g => g.miembros.forEach(id => {
            const a = estado.libreta.alumnos.find(x => x.id === id); if (!a) return;
            const nota = String(g.notas[id] || g.nota || '').trim();
            const comentario = String(g.comentario || '').trim();
            if (!nota && !comentario) return;
            entradas.push({ nombre: a.nombre, nota, comentario, grupo: g.nombre });
        }));
        return entradas;
    }

    async function enviarNotas() {
        const act = actividad(); if (!act) return;
        const entradas = entradasDeNotas(act);
        if (!entradas.length) { mensaje('aviso', 'Todavía no hay notas: escribí la nota de cada grupo (arriba a la derecha de cada uno).'); return; }
        const sinNota = act.grupos.filter(g => g.miembros.length && !g.nota && !g.miembros.some(id => g.notas[id]));
        try {
            await A.set({ notasGuardadas: { origen: `${act.nombre} · grupos`, libreta: estado.libreta.nombre, fecha: Date.now(),
                entradas: entradas.map(e => ({ nombre: e.nombre, nota: e.nota, comentario: e.comentario })) } });
            mensaje('ok', `📋 ${entradas.length} notas listas en el asistente${sinNota.length ? ` (${sinNota.length} grupo(s) sin nota quedaron afuera)` : ''}. Ahora entrá en SIGED a la evaluación donde van (por ejemplo Escritos o Parcial): el panel te ofrece "Cargar estas notas acá".`);
        } catch (e) {
            mensaje('error', 'No se pudieron guardar las notas: ' + e.message);
        }
    }

    function exportarExcel() {
        const act = actividad(); if (!act) return;
        const filasGrupos = [];
        act.grupos.forEach(g => g.miembros.forEach((id, i) => {
            const a = estado.libreta.alumnos.find(x => x.id === id); if (!a) return;
            filasGrupos.push([g.nombre, i + 1, a.nombre, g.notas[id] || g.nota || '', g.comentario || '']);
        }));
        alumnosSinGrupo(act).forEach(a => filasGrupos.push(['(sin grupo)', '', a.nombre, '', '']));
        const notas = entradasDeNotas(act).map((e, i) => [i + 1, e.nombre, e.nota, e.comentario, e.grupo]);
        try {
            const nombre = F.descargarLibro({
                hojas: [
                    { nombre: 'Grupos', encabezados: ['Grupo', 'N°', 'Integrante', 'Nota', 'Comentario'], filas: filasGrupos, anchos: [18, 5, 38, 8, 50] },
                    { nombre: 'Notas', encabezados: ['N°', 'Estudiante', 'Nota', 'Comentario', 'Grupo'], filas: notas, anchos: [5, 38, 8, 50, 18] }
                ],
                info: [['Actividad', act.nombre], ['Libreta', estado.libreta.nombre], ['Grupos', String(act.grupos.length)], ['Generado por', 'Asistente de SIGED · Armar grupos'],
                       ['Hoja Notas', 'Se puede importar en SIGED con "Importar notas desde archivo".']],
                nombreBase: ['Grupos', act.nombre, estado.libreta.nombre]
            });
            mensaje('ok', 'Archivo descargado: ' + nombre);
        } catch (e) { mensaje('error', 'No se pudo generar el Excel: ' + e.message); }
    }

    function imprimir() {
        const act = actividad(); if (!act) return;
        $('tituloImpresion').textContent = `${act.nombre} · ${estado.libreta.nombre}`;
        window.print();
    }

    // ---------------------------------------------------------------- respaldo
    function descargarRespaldo() {
        const datos = { tipo: 'asistente-siged-grupos', version: 1, fecha: new Date().toISOString(), libreta: estado.libreta, actividades: estado.actividades };
        F.descargarBlob(new Blob([JSON.stringify(datos)], { type: 'application/json' }), F.nombreArchivoSeguro(['Grupos', estado.libreta ? estado.libreta.nombre : '', new Date().toISOString().slice(0, 10)], 'json'));
        mensaje('ok', 'Respaldo descargado. Guardalo donde quieras; se restaura desde el mismo menú.');
    }

    async function restaurarRespaldo(file) {
        try {
            const datos = JSON.parse(await file.text());
            if (datos.tipo !== 'asistente-siged-grupos' || !datos.libreta) throw new Error('el archivo no es un respaldo de grupos');
            const id = datos.libreta.id || estado.libretaId;
            await A.set({ ['libreta:' + id]: datos.libreta, ['actividades:' + id]: datos.actividades || [] });
            estado.libretaId = id; estado.actividadId = '';
            await cargar();
            mensaje('ok', `Respaldo restaurado: ${datos.libreta.nombre}, ${(datos.actividades || []).length} actividad(es).`);
        } catch (e) { mensaje('error', 'No se pudo restaurar: ' + e.message); }
    }

    // ---------------------------------------------------------------- render
    function fichaHtml(a, g) {
        const foto = a.foto ? `<img src="${escapeHtml(a.foto)}" alt="" draggable="false">` : `<div class="inicial">${escapeHtml((a.apellido || a.nombre || '?').charAt(0))}</div>`;
        const act = actividad();
        const opciones = ['<option value="">→</option>', '<option value="_sin">Sin grupo</option>']
            .concat(act.grupos.map(x => `<option value="${x.id}" ${g && x.id === g.id ? 'disabled' : ''}>${escapeHtml(x.nombre)}</option>`)).join('');
        return `<div class="ficha${estado.elegidos.has(a.id) ? ' elegida' : ''}" draggable="true" data-id="${escapeHtml(a.id)}" title="${escapeHtml(a.nombre)}">
            ${foto}
            <div class="nombre"><b>${escapeHtml(a.apellido || '')}</b>${escapeHtml(a.nombrePila || '')}</div>
            ${g ? `<input class="nota-ind" data-grupo="${g.id}" data-alumno="${escapeHtml(a.id)}" value="${escapeHtml(g.notas[a.id] || '')}" placeholder="${escapeHtml(g.nota || '—')}" title="Nota de este integrante (si es distinta a la del grupo)">` : ''}
            <select class="mover" data-alumno="${escapeHtml(a.id)}" title="Mover a…">${opciones}</select>
        </div>`;
    }

    function render() {
        // Selectores de libreta y actividad
        const ls = $('libretaSelect');
        ls.innerHTML = Object.keys(estado.libretas).map(k => { const l = estado.libretas[k]; const id = k.slice('libreta:'.length);
            return `<option value="${escapeHtml(id)}" ${id === estado.libretaId ? 'selected' : ''}>${escapeHtml(l.nombre)} (${(l.alumnos || []).length})</option>`; }).join('');
        ls.style.display = Object.keys(estado.libretas).length > 1 ? '' : 'none';
        $('libretaNombre').textContent = estado.libreta ? `${estado.libreta.nombre} · ${estado.libreta.alumnos.length} alumnos` : 'Sin libreta: abrí el Libro del Profesor en SIGED y usá "Armar grupos".';

        const as = $('actividadSelect');
        as.innerHTML = estado.actividades.length
            ? estado.actividades.map(a => `<option value="${a.id}" ${a.id === estado.actividadId ? 'selected' : ''}>${escapeHtml(a.nombre)} (${a.grupos.length} grupos)</option>`).join('')
            : '<option value="">— creá una actividad —</option>';
        const act = actividad();
        ['btnRenombrar', 'btnDuplicar', 'btnBorrar', 'btnAzar', 'btnLista', 'btnAgregarGrupo', 'btnVaciar', 'btnEnviar', 'btnExcel', 'btnImprimir'].forEach(id => { $(id).disabled = !act; });
        $('btnNuevaActividad').disabled = !estado.libreta;

        const cont = $('grupos');
        const sin = $('fichasSinGrupo');
        if (!act || !estado.libreta) {
            sin.innerHTML = estado.libreta ? estado.libreta.alumnos.map(a => `<div class="ficha" title="${escapeHtml(a.nombre)}">${a.foto ? `<img src="${escapeHtml(a.foto)}" alt="">` : `<div class="inicial">${escapeHtml((a.apellido || '?').charAt(0))}</div>`}<div class="nombre"><b>${escapeHtml(a.apellido || '')}</b>${escapeHtml(a.nombrePila || '')}</div></div>`).join('') : '';
            $('cantSinGrupo').textContent = estado.libreta ? estado.libreta.alumnos.length : 0;
            cont.innerHTML = `<div class="vacio" style="grid-column:1/-1;padding:30px">${estado.libreta ? 'Creá una actividad con "＋ Nueva" para empezar a armar grupos.' : 'Todavía no hay alumnos guardados.'}</div>`;
            return;
        }
        const sinGrupo = alumnosSinGrupo(act);
        $('cantSinGrupo').textContent = sinGrupo.length;
        sin.innerHTML = sinGrupo.length ? sinGrupo.map(a => fichaHtml(a, null)).join('') : '<div class="vacio">Todos tienen grupo 🎉</div>';
        cont.innerHTML = act.grupos.map(g => {
            const miembros = g.miembros.map(id => estado.libreta.alumnos.find(a => a.id === id)).filter(Boolean);
            return `<section class="grupo" data-grupo="${g.id}">
                <div class="cab">
                    <input class="nombre-grupo" data-grupo="${g.id}" value="${escapeHtml(g.nombre)}" maxlength="40" title="Nombre del grupo">
                    <span class="cant">${miembros.length} integr.</span>
                    <input class="nota-grupo" data-grupo="${g.id}" value="${escapeHtml(g.nota || '')}" placeholder="Nota" title="Nota del grupo (se asigna a todos sus integrantes)">
                    <button class="quitar" data-grupo="${g.id}" title="Quitar grupo">✕</button>
                </div>
                <textarea data-grupo="${g.id}" placeholder="Comentario del grupo (opcional)">${escapeHtml(g.comentario || '')}</textarea>
                <div class="fichas">${miembros.length ? miembros.map(a => fichaHtml(a, g)).join('') : '<div class="vacio">Tocá o arrastrá fichas acá</div>'}</div>
            </section>`;
        }).join('') || `<div class="vacio" style="grid-column:1/-1;padding:30px">No hay grupos todavía. Usá "Al azar", "En orden de lista" o "Agregar grupo".</div>`;
        marcarDestinos();
    }

    // ---------------------------------------------------------------- eventos
    document.addEventListener('dragstart', (ev) => {
        const f = ev.target.closest && ev.target.closest('.ficha[draggable]');
        if (!f) return;
        ev.dataTransfer.setData('text/plain', f.dataset.id);
        ev.dataTransfer.effectAllowed = 'move';
        f.classList.add('arrastrando');
    });
    document.addEventListener('dragend', (ev) => { const f = ev.target.closest && ev.target.closest('.ficha'); if (f) f.classList.remove('arrastrando'); });
    document.addEventListener('dragover', (ev) => {
        const zona = ev.target.closest && ev.target.closest('.grupo, .columna.sin-grupo');
        if (!zona) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.sobre').forEach(e => { if (e !== zona) e.classList.remove('sobre'); });
        zona.classList.add('sobre');
    });
    document.addEventListener('dragleave', (ev) => { const zona = ev.target.closest && ev.target.closest('.grupo, .columna.sin-grupo'); if (zona && !zona.contains(ev.relatedTarget)) zona.classList.remove('sobre'); });
    document.addEventListener('drop', (ev) => {
        const zona = ev.target.closest && ev.target.closest('.grupo, .columna.sin-grupo');
        if (!zona) return;
        ev.preventDefault();
        zona.classList.remove('sobre');
        const id = ev.dataTransfer.getData('text/plain');
        if (!id) return;
        const destino = zona.dataset.grupo || null;
        if (estado.elegidos.has(id)) moverVarios(Array.from(estado.elegidos), destino); else mover(id, destino);
    });

    document.addEventListener('input', (ev) => {
        const el = ev.target; const act = actividad(); if (!act) return;
        const g = el.dataset.grupo ? act.grupos.find(x => x.id === el.dataset.grupo) : null;
        if (!g) return;
        if (el.classList.contains('nombre-grupo')) { g.nombre = el.value; guardar(); }
        else if (el.classList.contains('nota-grupo')) { g.nota = el.value.trim(); guardar(); el.closest('.grupo').querySelectorAll('.nota-ind').forEach(i => { i.placeholder = g.nota || '—'; }); }
        else if (el.tagName === 'TEXTAREA') { g.comentario = el.value; guardar(); }
        else if (el.classList.contains('nota-ind')) { const v = el.value.trim(); if (v) g.notas[el.dataset.alumno] = v; else delete g.notas[el.dataset.alumno]; guardar(); }
    });
    document.addEventListener('change', (ev) => {
        const el = ev.target;
        if (el.classList.contains('mover')) { const v = el.value; if (!v) return; mover(el.dataset.alumno, v === '_sin' ? null : v); return; }
        if (el.id === 'actividadSelect') { estado.actividadId = el.value; estado.elegidos.clear(); render(); return; }
        if (el.id === 'libretaSelect') { estado.libretaId = el.value; estado.actividadId = ''; history.replaceState(null, '', '?libreta=' + encodeURIComponent(el.value)); cargar(); return; }
        if (el.id === 'respaldoSelect') { const v = el.value; el.value = ''; if (v === 'descargar') descargarRespaldo(); if (v === 'restaurar') $('archivoRespaldo').click(); return; }
        if (el.id === 'archivoRespaldo' && el.files[0]) { restaurarRespaldo(el.files[0]); el.value = ''; }
    });
    function marcarDestinos() {
        const hay = estado.elegidos.size > 0;
        document.querySelectorAll('.grupo, .columna.sin-grupo').forEach(z => z.classList.toggle('destino', hay));
        const pista = $('pista');
        if (pista) pista.textContent = hay
            ? `${estado.elegidos.size} elegida${estado.elegidos.size === 1 ? '' : 's'}: tocá el grupo donde van (o "Sin grupo"). Tocá la ficha de nuevo para soltarla.`
            : 'Arrastrá una ficha al grupo, o tocala (podés tocar varias) y después tocá el grupo.';
    }
    document.addEventListener('click', (ev) => {
        const q = ev.target.closest && ev.target.closest('button.quitar');
        if (q) { quitarGrupo(q.dataset.grupo); return; }
        if (ev.target.closest('input, select, textarea, button, a')) return;
        const act = actividad(); if (!act) return;
        const f = ev.target.closest('.ficha[data-id]');
        if (f) {
            const id = f.dataset.id;
            if (estado.elegidos.has(id)) estado.elegidos.delete(id); else estado.elegidos.add(id);
            f.classList.toggle('elegida', estado.elegidos.has(id));
            marcarDestinos();
            return;
        }
        const zona = ev.target.closest('.grupo, .columna.sin-grupo');
        if (zona && estado.elegidos.size) moverVarios(Array.from(estado.elegidos), zona.dataset.grupo || null);
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && estado.elegidos.size) { estado.elegidos.clear(); render(); } });
    $('btnNuevaActividad').addEventListener('click', nuevaActividad);
    $('btnRenombrar').addEventListener('click', renombrarActividad);
    $('btnDuplicar').addEventListener('click', duplicarActividad);
    $('btnBorrar').addEventListener('click', borrarActividad);
    $('btnAzar').addEventListener('click', () => repartir(document.activeElement === $('tamGrupo') ? false : true, document.activeElement === $('tamGrupo') ? +$('tamGrupo').value : +$('cantGrupos').value, true));
    $('btnLista').addEventListener('click', () => repartir(document.activeElement === $('tamGrupo') ? false : true, document.activeElement === $('tamGrupo') ? +$('tamGrupo').value : +$('cantGrupos').value, false));
    $('cantGrupos').addEventListener('input', () => { $('cantGrupos').dataset.usado = '1'; $('tamGrupo').dataset.usado = ''; });
    $('tamGrupo').addEventListener('input', () => { $('tamGrupo').dataset.usado = '1'; $('cantGrupos').dataset.usado = ''; });
    // Qué criterio usar al repartir: el último campo que el docente tocó (por defecto, cantidad de grupos)
    const criterio = () => ($('tamGrupo').dataset.usado === '1' ? { porCantidad: false, n: +$('tamGrupo').value } : { porCantidad: true, n: +$('cantGrupos').value });
    $('btnAzar').onclick = () => { const c = criterio(); repartir(c.porCantidad, c.n, true); };
    $('btnLista').onclick = () => { const c = criterio(); repartir(c.porCantidad, c.n, false); };
    $('btnAgregarGrupo').addEventListener('click', agregarGrupo);
    $('btnVaciar').addEventListener('click', vaciarGrupos);
    $('btnEnviar').addEventListener('click', enviarNotas);
    $('btnExcel').addEventListener('click', exportarExcel);
    $('btnImprimir').addEventListener('click', imprimir);

    window.GruposApp = { estado, cargar, repartir, mover, entradasDeNotas, actividad };
    cargar();
})();
