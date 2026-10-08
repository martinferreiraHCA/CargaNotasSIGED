#!/usr/bin/env bash
# Genera el ZIP para subir a la Chrome Web Store (manifest.json en la raíz del ZIP,
# solo los archivos que usa la extensión). Resultado: dist/asistente-de-siged-<versión>.zip
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
ZIP="dist/asistente-de-siged-${VERSION}.zip"
rm -f "$ZIP"
zip -q -X -r "$ZIP" manifest.json content.js background.js popup.html popup.js grupos.html grupos.js icon16.png icon48.png icon128.png lib shared
echo "Creado $ZIP"
unzip -l "$ZIP"
