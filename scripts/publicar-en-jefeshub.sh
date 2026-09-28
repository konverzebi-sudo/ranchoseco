#!/usr/bin/env bash
# Publica la versión actual en https://jefeshub.com/ranchoseco/
# jefeshub.com está conectado al repo hub-jany (GitHub Pages), por eso el
# sitio compilado se copia a la carpeta ranchoseco/ de ese repo.
# Requiere: .env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY, y gh/git con acceso.
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
npm run build
tmp="$(mktemp -d)"
git clone -q --depth 1 https://github.com/konverzebi-sudo/hub-jany.git "$tmp/hub"
rm -rf "$tmp/hub/ranchoseco"
mkdir -p "$tmp/hub/ranchoseco"
cp -r dist/. "$tmp/hub/ranchoseco/"
cd "$tmp/hub"
git add -A ranchoseco
if git diff --cached --quiet; then echo "Sin cambios que publicar."; exit 0; fi
git commit -qm "Actualiza RANCHO SECO | Control de Academia ($(date +%Y-%m-%d))"
git push -q origin main
echo "Publicado. En 1-2 minutos: https://jefeshub.com/ranchoseco/"
