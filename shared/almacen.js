// ========== ALMACÉN LOCAL (compartido) ==========
// Guarda datos en el navegador del docente: libretas con sus alumnos y fotos,
// actividades con grupos y las "notas guardadas en el asistente".
// Usa chrome.storage.local (compartido entre las páginas de SIGED y las páginas
// de la extensión). Si no está disponible (pruebas, página suelta), cae a localStorage.

(function (global) {
    'use strict';

    const tieneChrome = () => {
        try { return !!(global.chrome && global.chrome.storage && global.chrome.storage.local); } catch (e) { return false; }
    };
    const PREFIJO = 'sigedAsistente.';

    function get(claves) {
        const lista = Array.isArray(claves) ? claves : [claves];
        if (tieneChrome()) {
            return new Promise(resolve => {
                try {
                    global.chrome.storage.local.get(lista, (res) => resolve(res || {}));
                } catch (e) { resolve({}); }
            });
        }
        const res = {};
        lista.forEach(k => {
            try {
                const v = global.localStorage.getItem(PREFIJO + k);
                if (v !== null) res[k] = JSON.parse(v);
            } catch (e) { /* ignorar */ }
        });
        return Promise.resolve(res);
    }

    function set(obj) {
        if (tieneChrome()) {
            return new Promise((resolve, reject) => {
                try {
                    global.chrome.storage.local.set(obj, () => {
                        const err = global.chrome.runtime && global.chrome.runtime.lastError;
                        if (err) reject(new Error(err.message)); else resolve();
                    });
                } catch (e) { reject(e); }
            });
        }
        try {
            Object.keys(obj).forEach(k => global.localStorage.setItem(PREFIJO + k, JSON.stringify(obj[k])));
            return Promise.resolve();
        } catch (e) { return Promise.reject(e); }
    }

    function remove(claves) {
        const lista = Array.isArray(claves) ? claves : [claves];
        if (tieneChrome()) {
            return new Promise(resolve => { try { global.chrome.storage.local.remove(lista, () => resolve()); } catch (e) { resolve(); } });
        }
        lista.forEach(k => { try { global.localStorage.removeItem(PREFIJO + k); } catch (e) { /* ignorar */ } });
        return Promise.resolve();
    }

    /** Todas las claves que empiezan con un prefijo (por ejemplo 'libreta:') */
    function listar(prefijo) {
        if (tieneChrome()) {
            return new Promise(resolve => {
                try {
                    global.chrome.storage.local.get(null, (todo) => {
                        const res = {};
                        Object.keys(todo || {}).forEach(k => { if (k.startsWith(prefijo)) res[k] = todo[k]; });
                        resolve(res);
                    });
                } catch (e) { resolve({}); }
            });
        }
        const res = {};
        try {
            for (let i = 0; i < global.localStorage.length; i++) {
                const k = global.localStorage.key(i);
                if (k.startsWith(PREFIJO + prefijo)) res[k.slice(PREFIJO.length)] = JSON.parse(global.localStorage.getItem(k));
            }
        } catch (e) { /* ignorar */ }
        return Promise.resolve(res);
    }

    /** Avisa cuando cambia una clave (solo con chrome.storage) */
    function onChange(callback) {
        if (!tieneChrome() || !global.chrome.storage.onChanged) return;
        try {
            global.chrome.storage.onChanged.addListener((cambios, area) => { if (area === 'local') callback(cambios); });
        } catch (e) { /* ignorar */ }
    }

    global.SigedAlmacen = { get, set, remove, listar, onChange, tieneChrome };
})(typeof window !== 'undefined' ? window : globalThis);
