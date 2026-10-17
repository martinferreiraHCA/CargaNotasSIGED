// ========== SERVICE WORKER ==========
// 1. Abre las páginas propias de la extensión a pedido del panel (por ejemplo, "Armar grupos").
// 2. Conecta con la cuenta de Google del docente y sincroniza con Google Drive
//    (carpeta "Asistente de SIGED / <año lectivo>") lo que la extensión guarda
//    en el navegador: libretas con fichas, grupos, anotaciones y promedios.

importScripts('shared/almacen.js', 'shared/drive.js');

const A = self.SigedAlmacen;
const Drive = self.SigedDrive;
const CLAVE_DRIVE = 'drive'; // {conectado, email, ultimaSync, ultimoResumen, error}

// ---------------------------------------------------------------- Google / Drive
function clienteConfigurado() {
    try {
        const m = chrome.runtime.getManifest();
        const id = m.oauth2 && m.oauth2.client_id;
        return !!id && !/PONER|TU_ID|xxxx/i.test(id);
    } catch (e) { return false; }
}

function obtenerToken(interactivo) {
    return new Promise((resolve, reject) => {
        if (!chrome.identity || !chrome.identity.getAuthToken) return reject(new Error('Este navegador no permite conectar una cuenta de Google desde la extensión.'));
        if (!clienteConfigurado()) return reject(new Error('Falta configurar el ID de cliente de Google en la extensión (ver INSTALACION.md, sección Google Drive).'));
        try {
            chrome.identity.getAuthToken({ interactive: !!interactivo }, (token) => {
                const err = chrome.runtime.lastError;
                if (err || !token) return reject(new Error(err ? err.message : 'No se obtuvo el permiso de Google.'));
                resolve(typeof token === 'string' ? token : token.token);
            });
        } catch (e) { reject(e); }
    });
}

function quitarTokenCacheado(token) {
    return new Promise(resolve => {
        try { chrome.identity.removeCachedAuthToken({ token }, () => resolve()); } catch (e) { resolve(); }
    });
}

async function estadoDrive() {
    const res = await A.get(CLAVE_DRIVE);
    return Object.assign({ conectado: false, email: '', ultimaSync: 0, ultimoResumen: null, error: '', configurado: clienteConfigurado(), anio: Drive.anioLectivo() }, res[CLAVE_DRIVE] || {});
}

async function guardarEstadoDrive(cambios) {
    const actual = await estadoDrive();
    delete actual.configurado; delete actual.anio;
    const nuevo = Object.assign(actual, cambios);
    await A.set({ [CLAVE_DRIVE]: nuevo });
    return nuevo;
}

function emailPerfil() {
    return new Promise(resolve => {
        try { chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => resolve((info && info.email) || '')); } catch (e) { resolve(''); }
    });
}

async function conectarDrive() {
    const token = await obtenerToken(true);
    const email = await emailPerfil();
    await guardarEstadoDrive({ conectado: true, email, error: '' });
    return sincronizarDrive({ token, interactivo: true });
}

async function desconectarDrive() {
    try {
        const token = await obtenerToken(false).catch(() => '');
        if (token) {
            await quitarTokenCacheado(token);
            try { await fetch('https://accounts.google.com/o/oauth2/revoke?token=' + encodeURIComponent(token)); } catch (e) { /* sin red */ }
        }
    } catch (e) { /* ignorar */ }
    await guardarEstadoDrive({ conectado: false, email: '', error: '' });
    return estadoDrive();
}

let sincronizando = null;
let pendiente = null;

/** Sincroniza (una sola a la vez; las pedidas mientras tanto se agrupan en una siguiente) */
function sincronizarDrive(o) {
    o = o || {};
    if (sincronizando) { pendiente = o; return sincronizando; }
    sincronizando = (async () => {
        try {
            const est = await estadoDrive();
            if (!est.conectado && !o.token) return est;
            let token = o.token || await obtenerToken(!!o.interactivo);
            const ejecutar = () => Drive.sincronizar({ token, fetch: fetch.bind(self), almacen: A, anio: o.anio || Drive.anioLectivo(), soloBajar: !!o.soloBajar });
            let resumen;
            try {
                resumen = await ejecutar();
            } catch (e) {
                if (e.codigo !== 401) throw e;
                await quitarTokenCacheado(token);
                token = await obtenerToken(!!o.interactivo);
                resumen = await ejecutar();
            }
            const nuevo = await guardarEstadoDrive({ ultimaSync: Date.now(), ultimoResumen: resumen, error: resumen.errores.length ? resumen.errores[0] : '' });
            if (resumen.bajados.length) notificarPaginas();
            return Object.assign(nuevo, { configurado: clienteConfigurado(), anio: resumen.anio });
        } catch (e) {
            const nuevo = await guardarEstadoDrive({ error: e.message });
            if (!o.silencioso) throw e;
            return Object.assign(nuevo, { configurado: clienteConfigurado() });
        } finally {
            sincronizando = null;
            if (pendiente) { const p = pendiente; pendiente = null; setTimeout(() => sincronizarDrive(p), 1500); }
        }
    })();
    return sincronizando;
}

async function aniosDrive() {
    const token = await obtenerToken(false);
    return Drive.listarAnios({ token, fetch: fetch.bind(self) });
}

async function restaurarDrive(anio) {
    const token = await obtenerToken(false);
    const resumen = await Drive.restaurar({ token, fetch: fetch.bind(self), almacen: A, anio });
    await guardarEstadoDrive({ ultimaSync: Date.now(), ultimoResumen: resumen, error: resumen.errores.length ? resumen.errores[0] : '' });
    if (resumen.bajados.length) notificarPaginas();
    return resumen;
}

/** Avisa a las páginas abiertas que llegaron datos nuevos desde Drive */
function notificarPaginas() {
    try { chrome.runtime.sendMessage({ action: 'driveActualizado' }, () => void chrome.runtime.lastError); } catch (e) { /* ignorar */ }
}

// Sincronización automática: un rato después de cada cambio local (si está conectado)
let temporizadorAuto = null;
function programarSync() {
    clearTimeout(temporizadorAuto);
    temporizadorAuto = setTimeout(() => sincronizarDrive({ silencioso: true }), 4000);
}

// ---------------------------------------------------------------- mensajes
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (!req) return false;
    if (req.action === 'abrirGrupos' || req.action === 'abrirPagina') {
        const pagina = req.action === 'abrirGrupos' ? 'grupos.html' : String(req.pagina || '').replace(/[^a-z0-9_.-]/gi, '');
        if (!/^[a-z0-9_-]+\.html$/i.test(pagina)) { sendResponse({ ok: false, error: 'página inválida' }); return false; }
        const query = req.action === 'abrirGrupos' ? (req.libretaId ? { libreta: req.libretaId } : {}) : (req.query || {});
        const qs = Object.keys(query).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
        const url = chrome.runtime.getURL(pagina) + (qs ? '?' + qs : '');
        chrome.tabs.create({ url, index: sender.tab ? sender.tab.index + 1 : undefined }, () => sendResponse({ ok: !chrome.runtime.lastError }));
        return true; // respuesta asíncrona
    }
    if (req.action === 'drive') {
        const responder = (p) => p.then(r => sendResponse({ ok: true, datos: r })).catch(e => sendResponse({ ok: false, error: e.message }));
        switch (req.op) {
            case 'estado': responder(estadoDrive()); break;
            case 'conectar': responder(conectarDrive()); break;
            case 'desconectar': responder(desconectarDrive()); break;
            case 'sincronizar':
                if (req.silencioso) { programarSync(); sendResponse({ ok: true, datos: null }); return false; }
                responder(sincronizarDrive({ interactivo: true, anio: req.anio }));
                break;
            case 'anios': responder(aniosDrive()); break;
            case 'restaurar': responder(restaurarDrive(req.anio)); break;
            default: sendResponse({ ok: false, error: 'Operación desconocida' });
        }
        return true;
    }
    return false;
});

// Al arrancar el navegador, si está conectado, trae lo que haya cambiado en otra computadora
try {
    chrome.runtime.onStartup.addListener(() => sincronizarDrive({ silencioso: true }));
} catch (e) { /* ignorar */ }
