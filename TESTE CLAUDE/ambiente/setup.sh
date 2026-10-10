#!/bin/bash
# Prepara um ambiente novo para continuar o projeto (rodar de dentro de "TESTE CLAUDE/"). Não grava segredos.
set -e
cd "$(dirname "$0")/.."
echo "== Python"; python3 --version; pip install -r ambiente/requirements.txt
echo "== pdftotext"; command -v pdftotext >/dev/null || echo "FALTA: instale poppler-utils (pdftotext)"
echo "== Node / Playwright"; node --version
if [ ! -d "${NODE_PATH:-/opt/node-tools/node_modules}/playwright" ]; then
  echo "FALTA playwright: npm i playwright (em uma pasta de ferramentas) e npx playwright install chromium; depois exporte NODE_PATH"
fi
echo "== Checagem de rede (200/302 = ok; 403 do CONNECT = host não liberado; 403 'Just a moment' = Cloudflare do site)"
while read -r h; do
  case "$h" in ''|\#*|\**) continue;; esac
  printf '%-40s %s\n' "$h" "$(curl -s -o /dev/null -m 15 -w '%{http_code}' -A 'Mozilla/5.0' "https://$h/" || true)"
done < ambiente/hosts_liberar.txt
echo "== Estado do projeto"; python3 -I scripts/qa_completude.py | tail -1
