# Plano — Preparar a passagem para outro Claude Code (HANDOFF) sem jogar nada na plataforma

## Context
O usuário quer baixar o repositório como ZIP do GitHub, ler o XLSX e o HTML no computador, e abrir outra conta/instância do Claude Code para analisar e continuar o trabalho, **sem** levar isso ao IRIS/plataforma por enquanto.

Medido agora (branch `claude/gracious-hopper-lifuhf`, árvore limpa, tudo no remoto, último commit `1089dc9`):
- `votos_2026.xlsx` e `votos_2026.html` **estão versionados** (pasta `TESTE CLAUDE/`), junto com scripts, JSON de cada agência, manifestos, `texto_*/` (texto extraído), README, ANALISE_MELHORIAS, MAPEAMENTO_AGENCIAS, `rodar_tudo.sh`. Pasta versionada: ~4.400 arquivos, ~109 MB.
- **Não versionados (gitignore):** `fonte/` (1,4 GB de PDFs/HTML brutos), `texto_antt/` e `votos_2026_artifact.html`. O ZIP do GitHub não os traz; quem continuar precisa rodar os baixadores (`rodar_tudo.sh`, por agência) com acesso de rede às fontes.
- O que **não** está no repositório: os planos em `/root/.claude/plans/*`, as permissões/hosts liberados no ambiente de nuvem e os relatórios dos agentes (revisões cegas em scratchpad). Isso precisa ir para um arquivo do repo.

## Respostas (para o usuário)
- **PR não é necessário.** Basta o commit + push que já foi feito: no GitHub, escolher o branch `claude/gracious-hopper-lifuhf` e "Code → Download ZIP" (ZIP é do branch selecionado). O ZIP traz o repositório inteiro (app IRIS + `TESTE CLAUDE/`); a pasta de interesse é `TESTE CLAUDE/`.
- **Não fazer merge em `main`**: o CLAUDE.md do repo diz que push em `main` dispara deploy automático no Vercel e a pasta tem ~109 MB; como o usuário não quer "jogar na plataforma", manter só o branch (PR, se quiser, como *draft* e nunca mergear).
- **Outro Claude Code** pode continuar de duas formas: (a) cloud/web com o repo conectado e o branch `claude/gracious-hopper-lifuhf`; (b) local: `git clone -b claude/gracious-hopper-lifuhf <repo>` (melhor que ZIP porque mantém histórico) ou descompactar o ZIP e abrir `TESTE CLAUDE/`. Ele precisará: Python 3 + `pdftotext`, Node + Playwright/Chromium (ANTAQ, ANATEL, ANEEL, ANAC, ARTESP), RapidOCR (ANTT, ANAC), e **liberar na rede os hosts** (gov.br das agências, `arquivos.ana.gov.br`, `www.ans.gov.br`, `componentes-portal.ans.gov.br`, `sei.anac.gov.br`, `pergamum.anac.gov.br`, `departamental/santosdumont.anac.gov.br`, SEI da ANATEL/ANCINE, Dados Abertos ANEEL etc.).
- **Para o XLSX/HTML no computador:** abrir `TESTE CLAUDE/votos_2026.xlsx` (Excel) e `TESTE CLAUDE/votos_2026.html` (navegador; arquivo único offline).

## Etapas (após aprovação)
1. Criar `TESTE CLAUDE/HANDOFF.md` com: objetivo e regras (só 2026, proveniência nominal/inferido/REVISAR, aba "Faltam na fonte" com URL, honestidade FEITO×só explicado); mapa da pasta (`scripts/agencias.py` como registro único, pipeline por agência `scripts/<sg>_rodar.sh`, build: `temas.py → build_xlsx.py → qa_completude.py → build_html.py`); estado por agência (tabela de votos/%nominal/%inferido/pendências); **lista do que falta** (a mesma que o usuário colou: inferência de unanimidade, ANEEL Cloudflare, ANATEL Turnstile, ANA 960ª e Votos, ANS 641–644/ext. 9–11, ANAC 7 atas + mandatos Altoé/Sousa Pereira, D4 por exclusão ANVISA, ARTESP `unidade`, piloto de vídeo condicionado a liberar hosts); decisões já tomadas e convenções de rótulos (ex.: "ACOMPANHOU (voto vencido…)", REDATOR, REVISAR); armadilhas (heurística de histórico da ANVISA, `VISTA_DIV_MANUAL` removida, proveniência do relator na ANS); como rodar revisão cega (método: esperado escrito antes do JSON, semente registrada); comandos de verificação e métricas atuais (32.976 votos; QA 0 falhas; paridade HTML=xlsx); o que **não** fazer (contornar captcha/Cloudflare; commit com e-mail errado; merge em `main`); `MONITORAMENTO.md` adiado por decisão do usuário.
2. Copiar para `TESTE CLAUDE/revisao_cega/` os relatórios das revisões cegas (scratchpad) e os planos relevantes de `/root/.claude/plans` (para o outro Claude entender decisões), e apontar no HANDOFF.
3. Acrescentar ao README uma linha "Para continuar em outra sessão/conta: leia HANDOFF.md primeiro".
4. Rodar `qa_completude.py` e `build_html.py` para garantir estado consistente; `git add`, commit (e-mail `214216649+Joaodesouzanery@users.noreply.github.com`, nome "Joao Nery", rodapé de coautoria) e push para `claude/gracious-hopper-lifuhf`. **Sem PR e sem merge.**
5. Opcional (se o usuário quiser): gerar um ZIP leve (`votos_2026.xlsx`, `votos_2026.html`, README, HANDOFF, ANALISE, MAPEAMENTO, QA_COMPLETUDE) e entregar via SendUserFile, para ler sem baixar o repositório inteiro.

## Verificação
`git status` limpo e `git log origin/claude/gracious-hopper-lifuhf` com o commit novo; HANDOFF.md abre e os caminhos citados existem (`ls`); contagens citadas batem com `votos_2026.xlsx`; `qa_completude.py` → FALHAS: 0.
