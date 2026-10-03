// ========== POPUP (lanzador) ==========
// El trabajo real lo hace el panel que se muestra dentro de la página de SIGED
// (content.js). Este popup solo detecta en qué página está el docente y le
// ofrece los botones correspondientes.

const SCRIPTS_CONTENIDO = ['lib/xlsx.full.min.js', 'shared/matching.js', 'shared/formatos.js', 'shared/detalle.js', 'content.js'];
let tabActual = null;
let estadoActual = null;

function mostrarAlerta(tipo, mensaje) {
    const box = document.getElementById('alertBox');
    box.innerHTML = `<div class="msg msg-${tipo}">${mensaje}</div>`;
}

function esSiged(url) {
    return /^https?:\/\/[^\/]*siged\.(com\.uy|com|edu\.uy)\//i.test(url || '');
}

function enviar(action, extra) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabActual.id, Object.assign({ action }, extra || {}), (resp) => {
            if (chrome.runtime.lastError) resolve({ _error: chrome.runtime.lastError.message });
            else resolve(resp);
        });
    });
}

async function inyectarScripts() {
    return new Promise((resolve) => {
        chrome.scripting.executeScript({ target: { tabId: tabActual.id }, files: SCRIPTS_CONTENIDO }, () => {
            resolve(!chrome.runtime.lastError);
        });
    });
}

async function consultarEstado() {
    let resp = await enviar('estadoPagina');
    if (resp && resp._error) {
        // El content script todavía no está en la página (por ejemplo, se instaló la extensión con la página abierta)
        const ok = await inyectarScripts();
        if (ok) {
            await new Promise(r => setTimeout(r, 600));
            resp = await enviar('estadoPagina');
        }
    }
    return resp;
}

function pintarEstado(estado) {
    estadoActual = estado;
    const pagina = document.getElementById('pagina');
    const contexto = document.getElementById('contexto');
    const acciones = document.getElementById('acciones');

    if (!estado || estado._error) {
        pagina.textContent = 'No se pudo conectar con la página';
        contexto.innerHTML = 'Recargá la página de SIGED (F5) y volvé a abrir la extensión.';
        acciones.classList.add('hidden');
        return;
    }

    pagina.textContent = `${estado.icono} ${estado.etiqueta}`;
    const partes = [];
    if (estado.contexto && estado.contexto.libreta) partes.push(`<b>Libreta:</b> ${escapeHtml(estado.contexto.libreta)}`);
    if (estado.contexto && estado.contexto.evaluacion) partes.push(`<b>Evaluación:</b> ${escapeHtml(estado.contexto.evaluacion)}`);
    if (estado.pagina) partes.push(`<b>Alumnos:</b> ${estado.alumnos}`);
    if (!estado.pagina) partes.push('Entrá a <b>Evaluaciones</b>, <b>Pasaje de calificaciones al boletín</b> o al <b>Libro del Profesor</b>.');
    contexto.innerHTML = partes.join('<br>');

    acciones.classList.toggle('hidden', !estado.pagina);
    const btnImportar = document.getElementById('btnImportar');
    const txtExportar = document.getElementById('txtExportar');
    if (estado.pagina === 'libro') {
        btnImportar.classList.add('hidden');
        txtExportar.innerHTML = 'Descargar plantilla del grupo (Excel)<small>Lista de alumnos para completar con las notas</small>';
    } else if (estado.pagina === 'detalle') {
        btnImportar.classList.add('hidden');
        txtExportar.innerHTML = 'Descargar Excel con notas y promedios<small>Evaluaciones, comentarios, promedios por período y resumen</small>';
    } else {
        btnImportar.classList.remove('hidden');
        txtExportar.innerHTML = 'Descargar notas de esta página (Excel)<small>Para guardarlas o pasarlas a otra evaluación</small>';
    }
    document.getElementById('btnExportar').disabled = !estado.alumnos;
}

function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function iniciar() {
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    tabActual = tabs && tabs[0];
    if (!tabActual || !esSiged(tabActual.url)) {
        document.getElementById('pagina').textContent = 'No estás en SIGED';
        document.getElementById('contexto').textContent = 'Abrí tu SIGED (por ejemplo colegio.siged.com.uy) y volvé a hacer clic en la extensión.';
        return;
    }
    pintarEstado(await consultarEstado());
}

document.getElementById('btnPanel').addEventListener('click', async () => {
    await enviar('mostrarPanel');
    window.close();
});

document.getElementById('btnExportar').addEventListener('click', async () => {
    const resp = await enviar('exportar', { formato: 'xlsx' });
    if (resp && resp.ok) {
        mostrarAlerta('ok', '📥 Se está descargando la planilla. Mirá la barra de descargas del navegador.');
    } else {
        mostrarAlerta('error', 'No se pudo exportar. Recargá la página de SIGED e intentá de nuevo.');
    }
});

document.getElementById('btnImportar').addEventListener('click', async () => {
    await enviar('importar');
    window.close();
});

iniciar();
