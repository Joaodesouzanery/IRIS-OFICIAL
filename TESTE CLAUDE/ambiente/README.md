# ambiente/ — o que replicar para rodar o projeto em outra conta/máquina

Esta pasta guarda **só configuração não secreta**. O projeto não usa chaves de API nem credenciais: todas as fontes são públicas.

| Arquivo | Para quê |
|---|---|
| `hosts_liberar.txt` | hosts de rede que precisam estar liberados (lista extraída dos scripts) |
| `requirements.txt` | pacotes Python e versões usadas |
| `env.example` | nomes das variáveis de ambiente relevantes (sem valores secretos) |
| `setup.sh` | instala dependências Python, confere pdftotext/Node/Playwright, testa cada host e roda o QA |

## Ferramentas externas
Python 3.13, `pdftotext` (poppler 24.02), Node 22 + Playwright/Chromium (módulo em `/opt/node-tools/node_modules`, navegador em `/opt/pw-browsers`), RapidOCR (via pip; `tesseract` não existia no ambiente original).

## O que NÃO deve ir para o Git
Proxy (`HTTPS_PROXY` e afins), certificados do ambiente, tokens/cookies de sessão, qualquer `.env*`. Os cookies de sessão do F5 da ANAC são gerados em tempo de execução e ficam em `fonte/` (ignorado).

## Como usar
```bash
cd "TESTE CLAUDE" && bash ambiente/setup.sh      # confere o ambiente e a rede
bash scripts/<sigla>_rodar.sh                     # recoleta de uma agência (ex.: ans, ana, anac)
python3 -I scripts/temas.py && python3 -I scripts/build_xlsx.py && python3 -I scripts/qa_completude.py --online && python3 -I scripts/build_html.py
```
