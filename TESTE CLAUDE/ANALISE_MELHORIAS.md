# Análise e melhorias — votos 2026 (ANM, ANTT, ARTESP)
Atualizada em 07/10/2026 · Coleta independente (não usa o pipeline do IRIS) · Excel: `votos_2026.xlsx`

## Correções em relação à versão anterior (eu errei em dois pontos)
1. **ANM:** eu disse que faltavam as atas 81–84 e 89. Errado: a página `atas-da-rop` mostra só as 8 mais recentes; o arquivo completo está em `atas-da-rop/atas-reunioes-ordinarias` (ROP 59 a 88 sem buraco). As atas 81–84 existem e foram lidas. Só a **89ª** (30/09) não tem ata: só a pauta está publicada.
2. **ARTESP:** eu disse "bloqueada mesmo com navegador". Errado: foi um teste com espera curta. Com um Chromium comum esperando o desafio normal do Imperva, a página carrega inteira (como o próprio repo prevê).

## O que foi entregue
| Agência | Cobertura | Deliberações | Votos (diretor × deliberação) |
|---|---|---|---|
| ANM | ROP 81–88 (jan–ago/2026), 8 de 9 realizadas; 89ª sem ata | 358 | 1.432 |
| ANTT | 57 de 61 reuniões realizadas (3 aguardam ata, 1 sem ata) | 305 | 1.484 |
| ARTESP | **56 reuniões inventariadas**; PDFs ainda não baixados | 0 | 0 |

Proveniência: `nominal` (a ata cita o diretor), `inferido` (ata diz "por unanimidade": presentes acompanharam o relator), `REVISAR` (maioria, vista ou texto ambíguo). ANM: 343 nominal / 943 inferido / 146 revisar. ANTT: 412 / 921 / 69 (+82 "n/a", retirados de pauta).
**Limite honesto:** o parser **não foi validado contra amostra manual** (continua pendente). Antes de usar as métricas, conferir ~10 deliberações por agência, todas as de maioria/vista.

## Estão aqui todos os documentos de 2026?
- **ANM:** calendário oficial = 12 ROPs em 2026; 9 já deveriam ter ocorrido; **8 têm ata (81–88)**; a 89ª só tem pauta. Sem reunião extraordinária em 2026 (a 34ª REP é de 19/11/2025). Numeração das atas 59–88 contínua.
- **ANTT:** listagem paginada até 2025; 101 reuniões em 2026 = 37 administrativas (só pauta, sem votos, fora do escopo) + 64 deliberativas. Dessas, **3 são futuras** (301ª 05/10, 1043ª 08/10, 302ª 13/10, só pauta), **61 realizadas**: 57 com ata lida, **3 com ata ainda não publicada** (1042ª, 299ª, 300ª, set/2026; votos individuais já publicados) e **1 lacuna antiga: RDE270 (02/03), sem ata** (4 PDFs de voto). Numeração sem buraco.
- **ARTESP:** 56 reuniões em 2026 em duas séries sem buraco: Ordinárias **1177ª–1214ª** (1177ª = 13/01/2026, igual à âncora do repo) e série **230–247**, todas com Pauta, Ata e Deliberações listadas.
- Limite geral: o site só garante o que publica. Divergência contra a fonte original só a própria agência resolve.

## ARTESP — onde está travado
Os PDFs ficam em `admin.cms.sp.gov.br/dx/api/dam/...`, protegido por **AWS WAF**, cujo desafio carrega script de `*.token.awswaf.com`. O proxy do ambiente **nega essa conexão (403)**, então o desafio não termina e o download volta 202 vazio (curl e navegador). **Para destravar:** em Network access do ambiente (menu no título da sessão → Edit → *Custom*, mantendo pacotes) acrescentar `admin.cms.sp.gov.br` e `*.token.awswaf.com` (e `*.awswaf.com`). Depois, baixar pelo navegador, extrair e gerar votos com a mesma proveniência. Não usei nada de contorno de anti-bot além de um navegador comum.

## Suas perguntas
1. **Estamos quase acabando?** Critério já definido em `docs/PENDENCIAS.md` (livro-razão ≥95% pronto; ANM ≥80%; gabarito ≥4/5). Hoje, pela fonte: ANM 8/9, ANTT 57/61, ARTESP 0/56 (por rede). As Fases 36–39 do repo gastaram esforço em datas/mandatos, não em fechar o voto.
2. **Caminho certo?** Direção certa; falta funil único por agência: listadas → baixadas → com texto → votos nominais/inferidos. Com esta coleta o degrau mais baixo é **ARTESP: baixar os PDFs** (uma liberação de rede). Boa parte dos votos é inferida de unanimidade (ANM 66%, ANTT 62%): responde "quantas vezes acompanhou", não prova divergência. Divergência real é rara (ANTT: 1 maioria, 13 vistas; ANM: poucas).
3. **Confiar nas ~1.000 deliberações da plataforma?** Não consegui auditar: o Supabase conectado aqui só tem "TE AMAR", "NERY AGRO" e "CIRCLE NEW", nenhum é o IRIS (não consultei no chute). Comparar a plataforma com este Excel por (agência, reunião, processo); amostra manual ~30/agência; estender o harness `vote-certification` à ANTT e ARTESP.
4. **"0 PDFs extraídos/materializados":** não diagnosticado em produção. Hipóteses a checar por SQL somente-leitura: migration não aplicada (degrade proposital esconde); contador lê outra tabela; orçamento de 70 s; PDF sem texto (aqui: 1 ata ANM e 99 votos ANTT eram imagem e exigem OCR); e, para a ARTESP, **o AWS WAF do host dos PDFs** (`admin.cms.sp.gov.br`), que derruba download de servidor sem navegador. O placar nunca deveria mostrar "0" sem o motivo.
5. **Objetivo final → número auditável:** coleta sem perda (`listadas = baixadas + faltantes nomeados`); extração (taxa de acerto da amostra); voto com proveniência (`nominal + inferido + REVISAR = total`); métricas só com cobertura ≥ limiar.

## Melhorias objetivas
- Seguir a subpágina `atas-reunioes-ordinarias` (paginada de 30 em 30) no coletor da ANM; a página-índice mostra só as últimas.
- ARTESP: coletor com navegador real e liberar `admin.cms.sp.gov.br` + `*.token.awswaf.com`; remover caracteres invisíveis (zero-width) do HTML antes de ler.
- OCR para PDF-imagem (RapidOCR funcionou na ROP87); ligaduras da ANTT perdem "ti" ("re rado").
- Canonizar nomes de diretores (Fernandez/Fernandes, "Substituto …").
- ANM: relator pelo cabeçalho erra em voto-vista; usar o texto da deliberação (corrigido).
- Pedir à ANTT a ata da RDE270; acompanhar as atas 299/300/1042 e a ata da ROP 89.
