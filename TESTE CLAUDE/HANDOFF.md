# HANDOFF — leia ISTO primeiro (continuação em outra sessão/conta do Claude Code)

Estado em **10/10/2026**, branch `claude/gracious-hopper-lifuhf`. Esta pasta (`TESTE CLAUDE/`) é autocontida: planilha, dashboard, dados, scripts e documentação. **Não faça merge em `main`** (push em `main` dispara deploy no Vercel; o dono não quer levar isso à plataforma por enquanto). PR, se existir, só como rascunho.

## 1. O que é
Coleta **independente** (não usa o pipeline do IRIS) dos **votos individuais dos diretores de 2026** em 13 agências reguladoras, com proveniência por voto:
- `nominal` = a fonte nomeia o diretor e o voto;
- `inferido` = ata diz "por unanimidade" ⇒ 1 voto ACOMPANHOU por presente (limite estrutural: só vídeo mostraria o voto real);
- `REVISAR` = indeterminado, sempre com motivo.
Tudo que a fonte não publica/bloqueia vai para a aba **Faltam na fonte** com URL (o dono investiga por conta própria).

**Entregáveis (continuam de onde pararam):** `votos_2026.xlsx` (10 abas: LEIA-ME, Painel, Votos, Deliberações, Matriz de votos, Diretores, Faltam na fonte, Controle, Reuniões, Apoio) e `votos_2026.html` (dashboard offline, igual à planilha; tem filtro de Agência em todas as tabelas). Ambos são gerados por scripts; **nunca edite à mão**.

## 2. O que NÃO vai junto (leia antes de rodar qualquer coisa)
- **Esta conversa:** a outra conta não vê nada do que foi dito. Ela só entende o que está escrito em arquivo (este HANDOFF, README, ANALISE_MELHORIAS, MAPEAMENTO_AGENCIAS, QA_COMPLETUDE, `revisao_cega/`, `planos/`).
- **Planos e relatórios dos agentes:** copiados para `planos/` (planos de trabalho) e `revisao_cega/` (revisões cegas e auditorias). O que não estiver lá foi perdido (rascunhos no scratchpad da sessão).
- **Hosts liberados:** as liberações de rede do ambiente de nuvem NÃO acompanham o repositório. Quem for rodar as coletas precisa liberar de novo os hosts (ver §6).
- **`fonte/`:** 1,4 GB de PDFs e HTML brutos, ignorados pelo Git. ZIP e clone não os trazem. Os textos extraídos (`texto_*/`) vão (exceto `texto_antt/`, ignorado), mas para refazer a coleta é preciso rodar os baixadores de novo (`scripts/<agencia>_rodar.sh`).
- **`votos_2026_artifact.html`:** ignorado (é a versão para o Artifact do claude.ai). O `votos_2026.html` completo está versionado.
- **Artifact publicado e permissões do ambiente:** não existem fora da conta original.

## 3. Mapa da pasta
- `scripts/agencias.py` — **registro único** das agências (JSON, URL da fonte, regra de ex-membros fora dos totais, `diverge_ok`). Nova agência = 1 linha aqui + `SETOR[...]` em `scripts/taxonomia.py` + `scripts/<sg>_rodar.sh` em `rodar_tudo.sh`.
- Por agência: `scripts/<sg>_{inventario,baixar,parse,auditoria,varredura}.py`, `<sg>.json` (reunioes, deliberacoes, votos, qualidade, cobertura, pendencias, nao_feito, diretores, colegiado), `manifesto_<sg>.json` (sha256), `<sg>_inventario.json`, `texto_<sg>/`.
- Build (nesta ordem): `python3 -I scripts/temas.py` → `build_xlsx.py` → `qa_completude.py [--online]` → `build_html.py` (falha se HTML ≠ xlsx).
- Legado (ANM, ANTT, ARTESP) tem tratamento próprio no `build_xlsx.py`; ANPD/ANVISA/ANP/ANTAQ/ANATEL/ANEEL/ANA/ANS/ANCINE/ANAC entram via `agencias.py`.
- `ambiente/` — hosts a liberar, `requirements.txt`, `env.example` (só nomes; **sem segredos**) e `setup.sh`.
- Docs: `README.md`, `ANALISE_MELHORIAS.md` (fases 1–14, decisões), `MAPEAMENTO_AGENCIAS.md` (status por agência), `QA_COMPLETUDE.md`, `MONITORAMENTO.md` (só desenho; **adiado por decisão do dono**).

## 4. Estado por agência (xlsx de 10/10/2026: 32.976 votos nos totais, QA 0 falhas)
| Agência | Votos | Nominal | Inferido | REVISAR | Linhas em Faltam na fonte |
|---|---|---|---|---|---|
| ANCINE | 7.000 | 2% | 97% | 83 | 52 |
| ANVISA | 5.798 | 92% | 8% | 0 | 155 |
| ANEEL | 5.245 | 32% | 68% | 12 | 115 |
| ANTAQ | 3.413 | 43% | 57% | 0 | 61 |
| ANATEL | 2.917 | 67% | 33% | 0 | 84 |
| ARTESP | 2.816 | 8% | 92% | 0 | 11 |
| ANTT | 1.536 | 30% | 62% | 2 | 30 |
| ANM | 1.508 | 28% | 67% | 5 | 13 |
| ANS | 1.260 | 10% | 90% | 5 | 10 |
| ANP | 695 | 47% | 53% | 0 | 21 |
| ANAC | 428 | 27% | 73% | 0 | 64 |
| ANA | 244 | 32% | 68% | 0 | 12 |
| ANPD | 116 | 100% | 0% | 0 | 1 |
(Total da aba Faltam na fonte: 629 linhas, todas com URL. Linhas de ex-membros ficam na aba Votos mas **fora dos totais**.)

## 5. O que ainda falta (por que não dizemos "completo")
- **Voto individual inferido de "por unanimidade"** em todas as agências (pesa em ANCINE 97%, ARTESP 92%, ANS 90%). Só vídeo da sessão mostraria cada voto. **Piloto de vídeo** (transcrição de áudio) só é possível se liberar `youtube.com`, `*.googlevideo.com` e um host de pacotes Python/Hugging Face; renderia mais na ANEEL (apuração nominal) e onde há "voto vencido"; voto de vídeo entraria como proveniência nova `vídeo`, nunca como `nominal` de documento. Não testado.
- **ANEEL:** atas em PDF atrás do Cloudflare do próprio site (`www2.aneel.gov.br/.../ata.cfm`): presença do colegiado inferida; 22 itens de vista sem pedinte; 9 textos truncados em 4.000 caracteres do CSV; 12 linhas SEM VOTO REGISTRADO. Saídas: o dono baixa as atas pelo navegador (links na aba Faltam na fonte) ou pede à Secretaria-Geral (reuniaodir@aneel.gov.br) o extrato nominal.
- **ANATEL:** voto individual nos processos do SEI está atrás de Cloudflare Turnstile (captcha); 22 pendências de documentos (Acórdãos 82 e 173, atas da 957ª e Ext. 32, 958ª, circuitos 63/170/171/244/245). Saídas: exportação pelo navegador do dono ou extrato da Secretaria do Conselho Diretor.
- **ANA:** ata da 960ª (sai depois da 961ª, 13/10 ⇒ rodar `scripts/ana_rodar.sh`); texto integral dos 46 "Voto nº X/2026/DIREC" só via SEI/LAI (`sei.ana.gov.br` não abre no egress).
- **ANS:** atas 641ª–644ª e extraordinárias 9–11 não publicadas (reexecutar `scripts/ans_rodar.sh`); relator inferido pela área em ~192 itens (a ata não usa "relator"); nenhuma ata traz voto vencido.
- **ANAC:** atas de RD5, RD6, REX2, RE30 ("em breve") e RD7, RE31, RE32 (sem desfecho); fim do mandato de Altoé (documentado até 27/04) e de Tiago Sousa Pereira (ex-diretor; ausente em RD1 e RE1–RE4) só via DOU/LAI; 29 ementas do pergamum (API autenticada) e 21 links de pesquisa pública do SEI com hash expirado.
- **ANTT:** 87 PDFs de voto em imagem lidos por OCR (só trazem a proposta do relator); 11 votos escritos citados em ata e não publicados; atas aguardando publicação (ROD1042, ROD1043, RDE299–RDE301).
- **ANVISA:** em ROP5 4.1.2.1 e ROP9 3.4.3.1, 4 DIVERGIU saíram **inferidos por exclusão** (a ata não nomeia quem seguiu o voto vencedor): confirmar no voto escrito; 3 vistas não localizadas na revisão cega.
- **ARTESP:** o campo `unidade` herda a anterior quando o cabeçalho foge do formato estrito. Protótipo existe (95,7% × 73,4% contra o campo Procedência dos PDFs) mas **não foi aplicado**; sem efeito em voto/relator (o `build_xlsx` usa `artesp_procedencia.json`), só em temas.
- **Revisão cega:** acertos medidos (esperado escrito do texto antes de abrir o JSON): ANTT 52/52, ARTESP 41/41 (voto), ANM 2026 20/20, ANTAQ 98,5%, ANATEL 98,7%, ANEEL 94,6% bruto, ANA 98,4%, ANCINE 100%, ANS 97,5% sem convenções, ANPD 94,8%, ANVISA 98,3%, ANP 100%. Isso mostra fidelidade ao texto da fonte, **não** o voto real nas unanimidades.
- **Monitoramento** (`MONITORAMENTO.md`): só desenho; o dono pediu para deixar para o final, depois de fechar os pontos acima.

## 6. Hosts a liberar na rede para rodar as coletas (lista completa e `setup.sh` em `ambiente/`)
gov.br das agências (anm, antt/portal.antt.gov.br, artesp, anpd, anvisa, anp, antaq/sophia.antaq.gov.br, anatel/sei.anatel.gov.br, aneel, ana, ans, ancine/sei.ancine.gov.br, anac), `arquivos.ana.gov.br`, `www.ans.gov.br`, `componentes-portal.ans.gov.br`, `sei.anac.gov.br`, `pergamum.anac.gov.br`, `departamental.anac.gov.br`, `santosdumont.anac.gov.br`, `www.anac.gov.br`, Dados Abertos da ANEEL (CKAN). Ferramentas: Python 3 + `pdftotext`, Node + Playwright/Chromium, RapidOCR (ANTT/ANAC; `tesseract` não existe no ambiente anterior).

## 7. Convenções de rótulo e regras de negócio
- Rótulos de voto começam por: ACOMPANHOU, DIVERGIU, RELATOR, AUSENTE, IMPEDIDO, SEM VOTO, PEDIU VISTA, VOTOU (antes da vista), NÃO PARTICIPOU, VISTA COLETIVA, REVISOR, REDATOR (ANTAQ), REVISAR. O build classifica por **prefixo**.
- Tipos de item: Deliberação, Vista, Retirada de pauta, Aprovação de ata, Cancelada, Informe (ANS), Só voto do relator (ANTT, reuniões sem ata).
- Vencido que acompanhou o relator derrotado ⇒ `ACOMPANHOU (voto vencido: …)` (ANEEL); quem votou contra o relator ⇒ DIVERGIU. Diligência ≠ vista (ANS). "Apreciado" sem votação ⇒ `SEM VOTO (apreciação, sem votação)`. Maioria sem nomear divergentes ⇒ REVISAR com motivo.
- Ex-diretores/ex-conselheiros com voto subsistente ficam na aba Votos como "Não" nos totais (coluna "Conta nos totais de 2026").
- Decisão por partes: campos `partes` e `voto_por_parte` nas deliberações.
- Presença inferida pelo colegiado em exercício quando a ata não está acessível (ANEEL, parte da ANAC): sempre sinalizado.

## 8. Armadilhas já descobertas
- ANVISA: as notas "declarou-se impedido na votação"/"esteve ausente da votação" vêm misturadas ao **histórico** de reuniões anteriores no mesmo parágrafo; a heurística atual (descartar bullet de histórico de 2025 cuja 1ª sentença é decisão; senão descontar só a 1ª sentença) é frágil (ex.: ROP1 3.4.1.1 já foi um falso positivo). Revalide itens novos.
- ANVISA CD: nome do diretor quebrado em duas linhas no PDF do extrato com o SIM no meio (CD323, CD573, CD1031); o QA agora conta linhas via `pdftotext`.
- ANEEL: espaço duplo ("consignaram  seus votos"); a exceção manual `VISTA_DIV_MANUAL` foi trocada por regra textual (marcada como inferência).
- ANS: relator inferido pela área proponente — registrar sempre `relator_proveniencia`.
- ANCINE: `data` dos circuitos é a **data da decisão**; `data_abertura` guarda a abertura.
- ANTT: o OCR dos votos só traz a proposta do relator; votos vista e declarações de voto são o que converte inferido em nominal.
- Proxy do ambiente reseta ~50% das conexões: sempre retry; gov.br PDF só com `/@@download/file`.
- Alguns agentes anteriores caíram por limite de sessão: sempre confira o estado em disco (`git status/diff`) antes de refazer.

## 9. O que NÃO fazer
- **Não contornar captcha/Cloudflare** nem inventar voto. Bloqueio vira linha em `pendencias` com URL.
- **Não fazer merge em `main`** nem push em `main` (deploy automático no Vercel); não jogar isso na plataforma sem o dono pedir.
- **E-mail de commit obrigatório:** `214216649+Joaodesouzanery@users.noreply.github.com` (nome "Joao Nery"); outro e-mail bloqueia o deploy no Vercel. Rodapé de coautoria conforme o CLAUDE.md do repo.
- Não escrever "FEITO" sem medição; distinguir sempre "feito" de "só explicado".
- Não editar `votos_2026.xlsx`/`.html` à mão.

## 10. Como retomar (checklist)
1. `git clone -b claude/gracious-hopper-lifuhf <repo>` (ou descompactar o ZIP do branch) e abrir `TESTE CLAUDE/`.
2. Ler este arquivo, `README.md`, `ANALISE_MELHORIAS.md` (fases 10–14) e `MAPEAMENTO_AGENCIAS.md`.
3. Conferir o estado: `python3 -I scripts/qa_completude.py` (FALHAS: 0) e abrir o xlsx/html.
4. Liberar os hosts (§6) e reexecutar `scripts/<sg>_rodar.sh` das agências com pendências; depois `temas.py → build_xlsx.py → qa_completude.py --online → build_html.py`.
5. A cada correção: revisão **cega** (esperado escrito do texto antes de abrir o JSON, semente registrada) e documentação em `ANALISE_MELHORIAS.md`.
