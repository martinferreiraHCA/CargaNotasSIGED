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
        stats: {},           // alumnoId → estadísticas armadas desde los promedios capturados por el asistente
        anotaciones: {},     // alumnoId → texto de las anotaciones para el juicio
        claveDatos: '',      // clave "host|n:nombre" con la que el asistente guarda promedios y anotaciones
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
        await cargarDatosAlumnos();
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
                pedirSyncDrive();
            } catch (e) {
                $('estadoGuardado').textContent = '⚠ No se pudo guardar';
                mensaje('error', 'No se pudo guardar: ' + e.message);
            }
        }, 300);
    }

    // ---------------------------------------------------------------- datos de los alumnos (promedios, faltas, anotaciones)
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    /** Orden de un período por el primer mes que nombra (los que no nombran meses van al final, por fecha de captura) */
    function rangoPeriodo(nombre, fecha) {
        const n = M.normalizeText(nombre || '');
        let mejor = -1;
        MESES.forEach((m, i) => { if (n.includes(m) && mejor === -1) mejor = i >= 9 ? i - 1 : i; });
        return mejor === -1 ? 100 + (fecha || 0) / 1e13 : mejor;
    }
    const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
    const fmt = (n) => (n === null || n === undefined ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ','));
    function sumaFaltas(c) {
        if (c.faltas) return ['justificadas', 'injustificadas', 'fictas'].reduce((n, k) => n + (parseInt(c.faltas[k], 10) || 0), 0);
        if (c.inasistencias) return Object.values(c.inasistencias).reduce((n, v) => n + (parseInt(v, 10) || 0), 0);
        return null;
    }

    /** Resume las capturas de un alumno en lo que muestra la carta */
    function resumirAlumno(registro) {
        const periodos = Object.keys(registro.periodos || {}).map(k => Object.assign({ nombre: k }, registro.periodos[k]));
        periodos.sort((a, b) => rangoPeriodo(a.nombre, a.fecha) - rangoPeriodo(b.nombre, b.fecha));
        const generales = periodos.filter(p => p.materias);           // corrector / cierre: promedio general del alumno
        const materia = periodos.filter(p => p.columnas);             // orales/escritos: rendimiento en esta materia
        const g = generales.length ? generales[generales.length - 1] : null;
        const m = materia.filter(p => num(p.promedio) !== null);
        const mu = m.length ? m[m.length - 1] : null;
        const mp = m.length > 1 ? m[m.length - 2] : null;
        const faltasDe = (lista) => { for (let i = lista.length - 1; i >= 0; i--) { const f = sumaFaltas(lista[i]); if (f !== null) return f; } return null; };
        const r = {
            general: g ? num(g.promedio) : null,
            generalAnterior: g ? num(g.promedioAnterior) : null,
            periodoGeneral: g ? g.nombre : '',
            subieron: g && g.materias ? g.materias.subieron.length : null,
            bajaron: g && g.materias ? g.materias.bajaron.length : null,
            bajas: g ? (g.bajas === undefined ? null : g.bajas) : null,
            materia: mu ? num(mu.promedio) : null,
            materiaAnterior: mp ? num(mp.promedio) : null,
            periodoMateria: mu ? mu.nombre : '',
            faltas: faltasDe(generales.length ? generales : materia),
            periodos
        };
        r.valor = r.general !== null ? r.general : r.materia;
        return r;
    }

    async function cargarDatosAlumnos() {
        estado.stats = {}; estado.anotaciones = {}; estado.claveDatos = '';
        if (!estado.libreta || !estado.libreta.alumnos.length) return;
        const objetivo = M.normalizeText(estado.libreta.nombre || '');
        const host = estado.libreta.host || (estado.libretaId.split('|')[0]);
        estado.claveDatos = `${host}|n:${objetivo}`;
        const [promedios, anotaciones] = await Promise.all([A.listar('promedios:'), A.listar('anotaciones:')]);
        const elegir = (todo) => {
            const claves = Object.keys(todo).filter(k => M.normalizeText(k.replace(/^.*\|n:/, '')) === objetivo);
            const conHost = claves.find(k => k.startsWith(estado.claveDatos.split('|n:')[0] + '|'));
            return conHost || claves[0] || '';
        };
        const filas = estado.libreta.alumnos.map(a => ({ id: a.id, tok: M.tokens(a.nombre) }));
        const kp = elegir(promedios);
        if (kp) {
            const regs = Object.keys(promedios[kp].alumnos || {}).map(id => ({ id, tok: M.tokens(promedios[kp].alumnos[id].nombre || id) }));
            M.asignarUnico(filas, regs, 0.7).forEach((as, i) => { if (as) estado.stats[filas[i].id] = resumirAlumno(promedios[kp].alumnos[as.entrada.id]); });
        }
        const ka = elegir(anotaciones);
        if (ka) {
            const regs = Object.keys(anotaciones[ka].alumnos || {}).map(id => ({ id, tok: M.tokens(anotaciones[ka].alumnos[id].nombre || id) }));
            M.asignarUnico(filas, regs, 0.7).forEach((as, i) => {
                if (!as) return;
                const rec = anotaciones[ka].alumnos[as.entrada.id];
                const t = Array.isArray(rec.entradas) && rec.entradas.length ? rec.entradas.map(e => [(e.etiquetas || []).join(', '), String(e.texto || '').trim()].filter(Boolean).join(': ')).join('. ').replace(/\.\./g, '.') : (rec.texto || '');
                if (t) estado.anotaciones[filas[i].id] = t;
            });
        }
    }

    const claseRating = (v) => (v === null ? '' : v >= 8 ? 'alto' : v >= 6 ? 'medio' : 'bajo');
    const flecha = (ahora, antes) => (ahora === null || antes === null ? '' : ahora > antes ? '<span class="sube">▲</span>' : ahora < antes ? '<span class="baja">▼</span>' : '<span class="igual">=</span>');

    function promedioGrupo(g) {
        const vals = g.miembros.map(id => estado.stats[id] && estado.stats[id].valor).filter(v => v !== null && v !== undefined);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }

    function abrirDetalle(id) {
        const a = estado.libreta.alumnos.find(x => x.id === id); if (!a) return;
        const st = estado.stats[id];
        const anot = estado.anotaciones[id];
        let html = `<div class="fd-cab">${a.foto ? `<img src="${escapeHtml(a.foto)}" alt="">` : `<div class="inicial">${escapeHtml((a.apellido || a.nombre).charAt(0))}</div>`}
            <div><h3>${escapeHtml(a.nombre)}</h3>${st && st.valor !== null ? `<span class="rating ${claseRating(st.valor)}">${fmt(st.valor)}</span> <span class="fd-sin">${st.general !== null ? 'promedio general · ' + escapeHtml(st.periodoGeneral) : 'esta materia · ' + escapeHtml(st.periodoMateria)}</span>` : '<span class="fd-sin">Sin datos todavía</span>'}</div></div>`;
        if (!st) {
            html += `<p class="fd-sin">El asistente guarda solo los promedios cuando ves <b>Orales, Escritos y O. Act.</b> (con TODOS), la ficha del <b>Cierre de promedios</b> o el <b>Corrector por curso</b> en SIGED. Abrí alguna de esas páginas y volvé.</p>`;
        } else {
            html += `<div class="fd-kpis">
                <div class="fd-kpi ${st.subieron ? 'verde' : ''}"><div class="v">${st.subieron === null ? '—' : '▲ ' + st.subieron}</div><div class="e">materias subieron</div></div>
                <div class="fd-kpi ${st.bajaron ? 'rojo' : ''}"><div class="v">${st.bajaron === null ? '—' : '▼ ' + st.bajaron}</div><div class="e">bajaron</div></div>
                <div class="fd-kpi ${st.bajas ? 'rojo' : 'verde'}"><div class="v">${st.bajas === null ? '—' : st.bajas}</div><div class="e">bajas</div></div>
                <div class="fd-kpi ${st.faltas ? '' : 'verde'}"><div class="v">${st.faltas === null ? '—' : st.faltas}</div><div class="e">faltas</div></div>
                <div class="fd-kpi"><div class="v">${fmt(st.materia)} ${flecha(st.materia, st.materiaAnterior)}</div><div class="e">esta materia</div></div>
            </div>`;
            const g = st.periodos.filter(p => p.materias).slice(-1)[0];
            if (g && g.materias) {
                const chips = (lista, clase) => lista.map(n => `<span class="fd-chip ${clase}">${escapeHtml(n)}</span>`).join('');
                if (g.materias.bajas.length) html += `<div class="fd-sec">Bajas en</div><div class="fd-chips">${chips(g.materias.bajas, 'roja')}</div>`;
                if (g.materias.subieron.length) html += `<div class="fd-sec">Subió en${g.comparadoCon ? ' (vs. ' + escapeHtml(g.comparadoCon) + ')' : ''}</div><div class="fd-chips">${chips(g.materias.subieron, 'sube')}</div>`;
                if (g.materias.bajaron.length) html += `<div class="fd-sec">Bajó en</div><div class="fd-chips">${chips(g.materias.bajaron, 'baja')}</div>`;
                if (g.notas && g.notas.length) html += `<div class="fd-sec">Notas por materia · ${escapeHtml(g.nombre)}</div><div class="fd-chips">${g.notas.map(([n, v]) => `<span class="fd-chip">${escapeHtml(n)} <b>${escapeHtml(v)}</b></span>`).join('')}</div>`;
            }
            const filas = st.periodos.map(p => {
                const cols = p.columnas ? Object.entries(p.columnas).filter(([, v]) => v !== '').map(([k, v]) => `${k} ${v}`).join(' · ') : '';
                return `<tr><td>${escapeHtml(p.nombre)}</td><td><b>${escapeHtml(p.promedio || '—')}</b></td><td>${sumaFaltas(p) === null ? '—' : sumaFaltas(p)}</td><td>${escapeHtml(cols || (p.materias ? 'promedio general' : ''))}</td></tr>`;
            }).join('');
            html += `<div class="fd-sec">Períodos</div><table class="fd-tabla"><tr><th>Período</th><th>Prom.</th><th>Faltas</th><th>Detalle</th></tr>${filas}</table>`;
        }
        html += `<div class="fd-sec">Anotaciones para el juicio</div>` + (anot ? `<div class="fd-anot">${escapeHtml(anot)}</div>` : '<div class="fd-sin">Sin anotaciones. Podés agregarlas con el botón de abajo.</div>');
        $('fichaDetalle').innerHTML = html;
        $('dialogoFicha').showModal();
    }
    $('fichaCerrar').addEventListener('click', () => $('dialogoFicha').close());
    $('btnAnotaciones').addEventListener('click', () => {
        $('dialogoFicha').close();
        const url = 'anotaciones.html' + (estado.claveDatos ? '?libreta=' + encodeURIComponent(estado.claveDatos) : '');
        window.open(url, '_blank');
    });

    // ---------------------------------------------------------------- Google Drive
    const tieneRuntime = () => { try { return !!(window.chrome && chrome.runtime && chrome.runtime.sendMessage); } catch (e) { return false; } };
    function mensajeDrive(op, extra) {
        return new Promise((resolve, reject) => {
            if (!tieneRuntime()) return reject(new Error('Solo disponible dentro de la extensión.'));
            try {
                chrome.runtime.sendMessage(Object.assign({ action: 'drive', op }, extra || {}), (resp) => {
                    const err = chrome.runtime.lastError;
                    if (err) return reject(new Error(err.message));
                    if (!resp || !resp.ok) return reject(new Error(resp && resp.error ? resp.error : 'Sin respuesta'));
                    resolve(resp.datos);
                });
            } catch (e) { reject(e); }
        });
    }
    function pedirSyncDrive() { if (tieneRuntime()) mensajeDrive('sincronizar', { silencioso: true }).catch(() => {}); }

    function pintarDrive(est) {
        const cont = $('drive');
        if (!cont) return;
        if (!tieneRuntime()) { cont.style.display = 'none'; return; }
        const conectado = !!(est && est.conectado);
        cont.classList.toggle('ok', conectado && !(est && est.error));
        cont.classList.toggle('error', !!(est && est.error));
        const cuando = est && est.ultimaSync ? ' · ' + hace(est.ultimaSync) : '';
        $('driveTexto').textContent = conectado
            ? `☁ Drive: ${est.email || 'conectado'}${cuando}`
            : (est && est.configurado === false ? '☁ Drive (falta configurar)' : '☁ Google Drive');
        $('driveTexto').title = est && est.error ? est.error : (conectado ? 'Copia en Google Drive → Asistente de SIGED / ' + (est.anio || '') : 'Guardá una copia en tu Google Drive para retomar desde cualquier computadora');
        $('btnDriveConectar').style.display = conectado ? 'none' : '';
        $('btnDriveSync').style.display = conectado ? '' : 'none';
        $('btnDriveDesconectar').style.display = conectado ? '' : 'none';
        $('driveAnio').style.display = conectado ? '' : 'none';
    }
    function hace(ts) {
        const min = Math.round((Date.now() - ts) / 60000);
        if (min < 1) return 'recién'; if (min < 60) return `hace ${min} min`;
        const h = Math.round(min / 60); if (h < 24) return `hace ${h} h`;
        return `hace ${Math.round(h / 24)} día(s)`;
    }
    async function refrescarDrive() {
        try { pintarDrive(await mensajeDrive('estado')); } catch (e) { pintarDrive(null); }
    }
    async function conectarDrive() {
        $('btnDriveConectar').disabled = true; $('driveTexto').textContent = '☁ Conectando…';
        try {
            const est = await mensajeDrive('conectar');
            pintarDrive(est);
            const r = est.ultimoResumen || {};
            mensaje('ok', `☁ Conectado a Google Drive${est.email ? ' como ' + est.email : ''}. Carpeta "Asistente de SIGED / ${est.anio}": ${(r.subidos || []).length} subido(s), ${(r.bajados || []).length} traído(s).`);
            if ((r.bajados || []).length) cargar();
            cargarAniosDrive();
        } catch (e) {
            mensaje('error', 'No se pudo conectar con Google: ' + e.message);
            refrescarDrive();
        }
        $('btnDriveConectar').disabled = false;
    }
    async function sincronizarDriveAhora() {
        $('btnDriveSync').disabled = true; $('driveTexto').textContent = '☁ Sincronizando…';
        try {
            const est = await mensajeDrive('sincronizar');
            pintarDrive(est);
            const r = est.ultimoResumen || {};
            mensaje('ok', `☁ Sincronizado: ${(r.subidos || []).length} subido(s), ${(r.bajados || []).length} traído(s)${(r.errores || []).length ? ' · ' + r.errores.length + ' error(es)' : ''}.`);
            if ((r.bajados || []).length) cargar();
        } catch (e) { mensaje('error', 'No se pudo sincronizar: ' + e.message); refrescarDrive(); }
        $('btnDriveSync').disabled = false;
    }
    async function desconectarDrive() {
        if (!confirm('¿Dejar de usar Google Drive? Lo guardado en Drive no se borra; solo se corta la conexión en este navegador.')) return;
        try { pintarDrive(await mensajeDrive('desconectar')); mensaje('info', 'Google Drive desconectado.'); } catch (e) { mensaje('error', e.message); }
    }
    async function cargarAniosDrive() {
        try {
            const anios = await mensajeDrive('anios');
            const sel = $('driveAnio');
            sel.innerHTML = '<option value="">Retomar año…</option>' + anios.map(a => `<option value="${a}">${a}</option>`).join('');
        } catch (e) { /* sin conexión */ }
    }
    async function restaurarDrive(anio) {
        if (!anio) return;
        if (!confirm(`¿Traer a este navegador todo lo guardado en Drive del año ${anio}? Lo que ya tengas con el mismo nombre se reemplaza por la copia de Drive.`)) return;
        try {
            const r = await mensajeDrive('restaurar', { anio });
            mensaje('ok', `☁ Se trajeron ${r.bajados.length} elemento(s) del año ${anio}.`);
            cargar(); refrescarDrive();
        } catch (e) { mensaje('error', 'No se pudo restaurar: ' + e.message); }
    }
    if (tieneRuntime()) {
        $('btnDriveConectar').addEventListener('click', conectarDrive);
        $('btnDriveSync').addEventListener('click', sincronizarDriveAhora);
        $('btnDriveDesconectar').addEventListener('click', desconectarDrive);
        $('driveAnio').addEventListener('change', (ev) => { const v = ev.target.value; ev.target.value = ''; restaurarDrive(v); });
        try { chrome.runtime.onMessage.addListener((req) => { if (req && req.action === 'driveActualizado') { cargar(); refrescarDrive(); } }); } catch (e) { /* ignorar */ }
        refrescarDrive().then(() => mensajeDrive('estado').then(est => { if (est.conectado) cargarAniosDrive(); }).catch(() => {}));
    } else {
        pintarDrive(null);
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

    /** modo: 'azar' | 'lista' | 'equilibrado' (serpentina por promedio: el mejor con el peor, etc.) */
    function repartir(porCantidad, n, modo) {
        const act = actividad(); if (!act || !estado.libreta) return;
        if (modo === true) modo = 'azar'; else if (modo === false) modo = 'lista';
        const total = estado.libreta.alumnos.length;
        if (!n || n < 1) return;
        const cantidad = porCantidad ? Math.min(n, total) : Math.ceil(total / n);
        if (act.grupos.some(g => g.miembros.length || g.nota) && !confirm('Esto rearma todos los grupos de esta actividad. ¿Seguimos?')) return;
        let alumnos = estado.libreta.alumnos.slice();
        const mezclar = (lista) => { for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lista[i], lista[j]] = [lista[j], lista[i]]; } return lista; };
        let sinDatos = 0;
        if (modo === 'azar') mezclar(alumnos);
        if (modo === 'equilibrado') {
            const valor = (a) => (estado.stats[a.id] && estado.stats[a.id].valor !== null ? estado.stats[a.id].valor : null);
            const con = alumnos.filter(a => valor(a) !== null).sort((a, b) => valor(b) - valor(a));
            const sin = mezclar(alumnos.filter(a => valor(a) === null));
            sinDatos = sin.length;
            if (!con.length) { mensaje('aviso', 'No hay promedios guardados de esta libreta: abrí en SIGED "Orales, Escritos y O. Act." (TODOS), el Cierre o el Corrector para que el asistente los capture. Mientras tanto se reparte al azar.'); mezclar(alumnos); }
            else alumnos = con.concat(sin);
        }
        const grupos = [];
        for (let i = 0; i < cantidad; i++) grupos.push({ id: nuevoId(), nombre: 'Grupo ' + (i + 1), nota: '', comentario: '', miembros: [], notas: {} });
        alumnos.forEach((a, i) => {
            // serpentina: 0,1,2,…,n-1,n-1,…,1,0 para que cada grupo reciba alternadamente a los mejores y a los que van más flojos
            const vuelta = Math.floor(i / cantidad), pos = i % cantidad;
            const destino = modo === 'equilibrado' && vuelta % 2 === 1 ? cantidad - 1 - pos : pos;
            grupos[destino].miembros.push(a.id);
        });
        act.grupos = grupos;
        guardar(); render();
        const como = modo === 'azar' ? ' al azar' : modo === 'equilibrado' ? ' equilibrados por promedio' + (sinDatos ? ` (${sinDatos} sin datos, al final)` : '') : ' en orden de lista';
        mensaje('ok', `${total} alumnos repartidos en ${cantidad} grupos${como}.`);
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
        const st = estado.stats[a.id];
        const opciones = ['<option value="">→</option>', '<option value="_sin">Sin grupo</option>']
            .concat(act ? act.grupos.map(x => `<option value="${x.id}" ${g && x.id === g.id ? 'disabled' : ''}>${escapeHtml(x.nombre)}</option>`) : []).join('');
        const rating = st && st.valor !== null
            ? `<div class="rating ${claseRating(st.valor)}" title="${st.general !== null ? 'Promedio general · ' + escapeHtml(st.periodoGeneral) : 'Esta materia · ' + escapeHtml(st.periodoMateria)}">${fmt(st.valor)}<small>${st.general !== null ? 'PROM' : 'MAT'}</small></div>`
            : `<div class="rating" title="Sin datos: el asistente los guarda cuando ves promedios en SIGED">—<small>PROM</small></div>`;
        let stats;
        if (!st) stats = `<span class="sin">sin datos aún</span>`;
        else {
            const tend = st.subieron === null ? (st.materia !== null && st.materiaAnterior !== null ? `${flecha(st.materia, st.materiaAnterior)} mat.` : '<span class="igual">—</span>')
                : `<span class="sube">▲${st.subieron}</span> <span class="baja">▼${st.bajaron}</span>`;
            stats = `<span title="Materias que subieron / bajaron respecto del período anterior">${tend}</span>` +
                (st.general !== null && st.materia !== null ? `<span title="Esta materia (${escapeHtml(st.periodoMateria)})">📘<b>${fmt(st.materia)}</b>${flecha(st.materia, st.materiaAnterior)}</span>` : '') +
                `<span title="Faltas">🚫<b>${st.faltas === null ? '—' : st.faltas}</b></span>`;
        }
        return `<div class="ficha${estado.elegidos.has(a.id) ? ' elegida' : ''}" draggable="true" data-id="${escapeHtml(a.id)}" title="${escapeHtml(a.nombre)}${estado.anotaciones[a.id] ? ' · 📝 ' + escapeHtml(estado.anotaciones[a.id].slice(0, 120)) : ''}">
            <button class="info" data-info="${escapeHtml(a.id)}" title="Ver la ficha completa del alumno">i</button>
            <div class="carta-top">${rating}${foto}</div>
            <div class="nombre"><b>${escapeHtml(a.apellido || '')}</b><span>${escapeHtml(a.nombrePila || '')}${estado.anotaciones[a.id] ? ' 📝' : ''}</span></div>
            <div class="stats">${stats}</div>
            <div class="pie">${g ? `<input class="nota-ind" data-grupo="${g.id}" data-alumno="${escapeHtml(a.id)}" value="${escapeHtml(g.notas[a.id] || '')}" placeholder="${escapeHtml(g.nota || 'nota')}" title="Nota de este integrante (si es distinta a la del grupo)">` : ''}
            <select class="mover" data-alumno="${escapeHtml(a.id)}" title="Mover a…">${opciones}</select></div>
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
        ['btnRenombrar', 'btnDuplicar', 'btnBorrar', 'btnAzar', 'btnLista', 'btnEquilibrado', 'btnAgregarGrupo', 'btnVaciar', 'btnEnviar', 'btnExcel', 'btnImprimir'].forEach(id => { $(id).disabled = !act; });
        $('btnNuevaActividad').disabled = !estado.libreta;

        const cont = $('grupos');
        const sin = $('fichasSinGrupo');
        if (!act || !estado.libreta) {
            sin.innerHTML = estado.libreta ? estado.libreta.alumnos.map(a => fichaHtml(a, null)).join('') : '';
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
                    <span class="prom ${promedioGrupo(g) === null ? 'sin' : ''}" title="Promedio de los integrantes con datos">${promedioGrupo(g) === null ? '' : 'prom. ' + fmt(promedioGrupo(g))}</span>
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
        const inf = ev.target.closest && ev.target.closest('button.info');
        if (inf) { abrirDetalle(inf.dataset.info); return; }
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
    $('btnAzar').onclick = () => { const c = criterio(); repartir(c.porCantidad, c.n, 'azar'); };
    $('btnLista').onclick = () => { const c = criterio(); repartir(c.porCantidad, c.n, 'lista'); };
    $('btnEquilibrado').onclick = () => { const c = criterio(); repartir(c.porCantidad, c.n, 'equilibrado'); };
    $('btnAgregarGrupo').addEventListener('click', agregarGrupo);
    $('btnVaciar').addEventListener('click', vaciarGrupos);
    $('btnEnviar').addEventListener('click', enviarNotas);
    $('btnExcel').addEventListener('click', exportarExcel);
    $('btnImprimir').addEventListener('click', imprimir);

    window.GruposApp = { estado, cargar, repartir, mover, entradasDeNotas, actividad, resumirAlumno, cargarDatosAlumnos };
    cargar();
})();
