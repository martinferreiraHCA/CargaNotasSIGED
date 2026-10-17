// ========== SINCRONIZACIÓN CON GOOGLE DRIVE (compartido) ==========
// Guarda en el Drive del docente una copia de lo que la extensión tiene en el
// navegador (libretas con fichas, actividades con grupos, anotaciones para el
// juicio y promedios), en la carpeta "Asistente de SIGED / <año lectivo>", un
// archivo JSON por libreta y tipo de dato. Sirve para retomar el trabajo en
// otra computadora o en el año siguiente.
//
// No depende de chrome.*: recibe el token, la función fetch y el almacén, así
// se puede usar desde el service worker y probar sin navegador.

(function (global) {
    'use strict';

    const API = 'https://www.googleapis.com/drive/v3/files';
    const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
    const CARPETA_RAIZ = 'Asistente de SIGED';
    const MIME_CARPETA = 'application/vnd.google-apps.folder';
    const PREFIJOS = ['libreta:', 'actividades:', 'anotaciones:', 'promedios:'];

    /** Año lectivo (en Uruguay coincide con el año calendario) */
    function anioLectivo(fecha) {
        return String((fecha || new Date()).getFullYear());
    }

    /** Marca de tiempo de un valor local, cualquiera sea su forma */
    function marca(valor) {
        if (!valor) return 0;
        if (Array.isArray(valor)) return valor.reduce((m, a) => Math.max(m, marca(a)), 0);
        if (typeof valor !== 'object') return 0;
        return Number(valor.modificado || valor.modificada || valor.actualizado || 0) || 0;
    }

    /** Nombre de archivo en Drive para una clave del almacén ("libreta:host|937" → "libreta__host_937.json") */
    function nombreArchivo(clave) {
        const i = clave.indexOf(':');
        const tipo = clave.slice(0, i);
        const id = clave.slice(i + 1).replace(/[^A-Za-z0-9._-]+/g, '_');
        return `${tipo}__${id}.json`;
    }

    function crearCliente(opciones) {
        const fetchFn = opciones.fetch;
        const token = opciones.token;

        async function pedir(url, init) {
            init = init || {};
            init.headers = Object.assign({ Authorization: 'Bearer ' + token }, init.headers || {});
            const r = await fetchFn(url, init);
            if (r.status === 401) throw Object.assign(new Error('La sesión de Google venció. Volvé a conectar la cuenta.'), { codigo: 401 });
            if (!r.ok) {
                let detalle = '';
                try { detalle = (await r.text()).slice(0, 200); } catch (e) { /* ignorar */ }
                throw new Error(`Google Drive respondió ${r.status}${detalle ? ': ' + detalle : ''}`);
            }
            return r;
        }

        const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        async function listar(query, campos) {
            const archivos = [];
            let pageToken = '';
            do {
                const params = new URLSearchParams({ q: query, fields: `nextPageToken, files(${campos || 'id, name, modifiedTime'})`, pageSize: '200', spaces: 'drive' });
                if (pageToken) params.set('pageToken', pageToken);
                const r = await pedir(`${API}?${params}`);
                const j = await r.json();
                (j.files || []).forEach(f => archivos.push(f));
                pageToken = j.nextPageToken || '';
            } while (pageToken);
            return archivos;
        }

        async function asegurarCarpeta(nombre, padreId) {
            const query = `name = '${q(nombre)}' and mimeType = '${MIME_CARPETA}' and trashed = false and '${padreId || 'root'}' in parents`;
            const existentes = await listar(query, 'id, name');
            if (existentes.length) return existentes[0].id;
            const r = await pedir(API, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nombre, mimeType: MIME_CARPETA, parents: padreId ? [padreId] : undefined })
            });
            return (await r.json()).id;
        }

        async function listarCarpetas(padreId) {
            return listar(`mimeType = '${MIME_CARPETA}' and trashed = false and '${padreId}' in parents`, 'id, name');
        }

        async function listarArchivos(carpetaId) {
            return listar(`mimeType != '${MIME_CARPETA}' and trashed = false and '${carpetaId}' in parents`, 'id, name, modifiedTime, appProperties');
        }

        async function subirJson(nombre, carpetaId, contenido, archivoId, propiedades) {
            const meta = { name: nombre, mimeType: 'application/json' };
            if (propiedades) meta.appProperties = propiedades;
            if (!archivoId) meta.parents = [carpetaId];
            const limite = 'asistente_siged_' + Date.now();
            const cuerpo = `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
                `--${limite}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(contenido)}\r\n--${limite}--`;
            const r = await pedir(`${UPLOAD}${archivoId ? '/' + archivoId : ''}?uploadType=multipart&fields=id,name,modifiedTime`, {
                method: archivoId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': `multipart/related; boundary=${limite}` },
                body: cuerpo
            });
            return r.json();
        }

        async function bajarJson(archivoId) {
            const r = await pedir(`${API}/${archivoId}?alt=media`);
            return r.json();
        }

        return { listar, asegurarCarpeta, listarCarpetas, listarArchivos, subirJson, bajarJson };
    }

    /**
     * Sincroniza el almacén local con la carpeta del año: sube lo que es más nuevo acá,
     * baja lo que es más nuevo allá. Devuelve un resumen.
     * @param {Object} o - {token, fetch, almacen: {listar, set}, anio, soloBajar}
     */
    async function sincronizar(o) {
        const cliente = crearCliente(o);
        const anio = o.anio || anioLectivo();
        const raiz = await cliente.asegurarCarpeta(CARPETA_RAIZ);
        const carpeta = await cliente.asegurarCarpeta(anio, raiz);
        const remotos = await cliente.listarArchivos(carpeta);
        const porNombre = new Map(remotos.map(f => [f.name, f]));

        const locales = {};
        for (const pref of PREFIJOS) Object.assign(locales, await o.almacen.listar(pref));

        const resumen = { anio, subidos: [], bajados: [], iguales: 0, errores: [] };
        const nombresLocales = new Set();

        // 1. Subir lo local que no está o es más nuevo
        for (const clave of Object.keys(locales)) {
            const nombre = nombreArchivo(clave);
            nombresLocales.add(nombre);
            const remoto = porNombre.get(nombre);
            const tsLocal = marca(locales[clave]);
            const tsRemoto = remoto && remoto.appProperties ? Number(remoto.appProperties.modificado || 0) : 0;
            try {
                if (!remoto || (tsLocal > tsRemoto && !o.soloBajar)) {
                    if (remoto && o.soloBajar) continue;
                    // La marca de tiempo va en appProperties para comparar sin bajar el archivo
                    await cliente.subirJson(nombre, carpeta, { clave, modificado: tsLocal, datos: locales[clave] }, remoto ? remoto.id : null, { modificado: String(tsLocal) });
                    resumen.subidos.push(clave);
                } else if (tsRemoto > tsLocal) {
                    const contenido = await cliente.bajarJson(remoto.id);
                    if (contenido && contenido.datos !== undefined) {
                        await o.almacen.set({ [clave]: contenido.datos });
                        resumen.bajados.push(clave);
                    }
                } else {
                    resumen.iguales++;
                }
            } catch (e) {
                if (e.codigo === 401) throw e;
                resumen.errores.push(`${clave}: ${e.message}`);
            }
        }

        // 2. Bajar lo remoto que no existe acá
        for (const f of remotos) {
            if (nombresLocales.has(f.name) || !/\.json$/.test(f.name)) continue;
            try {
                const contenido = await cliente.bajarJson(f.id);
                if (contenido && contenido.clave && contenido.datos !== undefined && PREFIJOS.some(p => contenido.clave.startsWith(p))) {
                    await o.almacen.set({ [contenido.clave]: contenido.datos });
                    resumen.bajados.push(contenido.clave);
                }
            } catch (e) {
                if (e.codigo === 401) throw e;
                resumen.errores.push(`${f.name}: ${e.message}`);
            }
        }
        return resumen;
    }

    /** Años disponibles en Drive (nombres de las subcarpetas de "Asistente de SIGED") */
    async function listarAnios(o) {
        const cliente = crearCliente(o);
        const raiz = await cliente.asegurarCarpeta(CARPETA_RAIZ);
        const carpetas = await cliente.listarCarpetas(raiz);
        return carpetas.map(c => c.name).filter(n => /^\d{4}$/.test(n)).sort().reverse();
    }

    /** Trae al navegador todo lo guardado en Drive para un año (lo remoto manda) */
    async function restaurar(o) {
        const cliente = crearCliente(o);
        const raiz = await cliente.asegurarCarpeta(CARPETA_RAIZ);
        const carpeta = await cliente.asegurarCarpeta(o.anio, raiz);
        const remotos = await cliente.listarArchivos(carpeta);
        const resumen = { anio: o.anio, bajados: [], errores: [] };
        for (const f of remotos) {
            if (!/\.json$/.test(f.name)) continue;
            try {
                const contenido = await cliente.bajarJson(f.id);
                if (contenido && contenido.clave && contenido.datos !== undefined && PREFIJOS.some(p => contenido.clave.startsWith(p))) {
                    await o.almacen.set({ [contenido.clave]: contenido.datos });
                    resumen.bajados.push(contenido.clave);
                }
            } catch (e) {
                if (e.codigo === 401) throw e;
                resumen.errores.push(`${f.name}: ${e.message}`);
            }
        }
        return resumen;
    }

    global.SigedDrive = { anioLectivo, marca, nombreArchivo, crearCliente, sincronizar, listarAnios, restaurar, CARPETA_RAIZ, PREFIJOS };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
