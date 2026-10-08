#!/usr/bin/env bash
# Publica la versión actual en https://jefeshub.com/ranchoseco/
# jefeshub.com está conectado al repo hub-jany (GitHub Pages), por eso el
# sitio compilado se copia a la carpeta ranchoseco/ de ese repo.
# Requiere: .env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY, y gh/git con acceso.
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
npm run build
# La copia temporal va en el disco del proyecto (el disco C: suele estar lleno)
mkdir -p ../.publicar-tmp
tmp="$(mktemp -d -p ../.publicar-tmp)"
# La copia temporal se borra siempre al terminar (antes se quedaban y llenaban el disco)
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 https://github.com/konverzebi-sudo/hub-jany.git "$tmp/hub"
# Se conservan los archivos de versiones anteriores (assets/) para que quien tenga la
# página abierta pueda seguir cambiando de sección sin que se quede en blanco.
mkdir -p "$tmp/hub/ranchoseco/assets"
find "$tmp/hub/ranchoseco" -maxdepth 1 -type f -delete
cp -r dist/. "$tmp/hub/ranchoseco/"
cd "$tmp/hub"
git add -A ranchoseco
if git diff --cached --quiet; then echo "Sin cambios que publicar."; exit 0; fi
git commit -qm "Actualiza RANCHO SECO | Control de Academia ($(date +%Y-%m-%d))"
git push -q origin main
echo "Publicado. En 1-2 minutos: https://jefeshub.com/ranchoseco/"
