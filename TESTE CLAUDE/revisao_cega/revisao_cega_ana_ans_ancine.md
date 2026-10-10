# Revisão cega e independente — ANA, ANS, ANCINE (votos 2026)

Data: 2026-10-09. Nenhum arquivo do projeto foi editado; nenhum commit. Scripts de apoio ficam neste diretório (scratchpad).

## 0. Método e limites de independência
- Parsers (`scripts/`) NÃO foram abertos. Para cada item li o texto-fonte (texto_ana/ata_*, texto_ans/ata_*/extrato_*, páginas HTML de fonte/ans/html para 641–643, texto_ancine/<id>.txt: ata + DDC + Decisão-Proclamação) e escrevi o esperado em arquivos separados (`exp_ana.py`, `exp_ans.py`, `exp_anc.py`) ANTES de ler os valores do item no JSON.
- Divulgação do que vi antes: (a) vocabulário/contagens agregadas de `voto`/`proveniencia`/`resultado` e totais (244/1260/7000); (b) a lista de reuniões do ancine.json com nº de presentes (a presença foi, mesmo assim, reconstruída a partir dos cabeçalhos das atas e das assinaturas dos DDC); (c) para o ANS, o rótulo de voto (`ACOMPANHOU (com …)`, `SEM VOTO REGISTRADO`) foi usado só para SELECIONAR estratos, não para o valor esperado; (d) o mapeamento área→diretor do ANS veio da notícia oficial em fonte/ans/html (diretoria-colegiada-da-ans-tem-nova-composicao.html), não do JSON.
- Semente 9004 (`random.Random(9004)`): ANS e ANCINE amostrados por estrato; ANA = censo (os 61 itens); amostra de URLs também com 9004.
- Limite estrutural: ~93-97% dos votos são `inferido` (ata diz 'por unanimidade'). Meu esperado confirma que o JSON reflete fielmente o que a fonte diz; NÃO prova o voto individual real.

## 1. ANA — 61/61 itens (50 deliberações + 11 aprovações de ata), 244 votos
Resultado: 437/444 verificações exatas (98,4%). As 7 discordâncias NÃO são erros: 4 = `partes` (JSON modela vista/retirada como 1 parte; eu esperava 0) e 3 = relator ausente da reunião, que o JSON registra como `RELATOR (ausente da reunião…)` e eu esperava `AUSENTE` (RD950-DLB5, RD951-DLB2, RD954-DLB1). Ajustado: 100%.
| Campo | Acerto |
|---|---|
| data | 50/50 (RD956 = 2026-07-28 correto; cabeçalho da ata diz 28/jun — erro da fonte já listado em 'Faltam na fonte') |
| relator | 50/50 |
| resultado/modo | 50/50 |
| partes | 46/50 (4 falsos positivos) |
| voto (todas as linhas) | 241/244 (3 = convenção do relator ausente) |
| Diretor | Argolo 44/44 · Fioreze 17/17 · Battiston 61/61 · Rêgo 61/61 · Góes 58/61 (3 convenção) |

Notas ANA: presença/ausência dos 11 encontros conferida (Argolo só 949–955; Fioreze só 956–959; Góes ausente em 950,951,954(não declarado),955,956,958,959). Sem votos vencidos/divergências em nenhuma ata.

## 2. ANS — 55 itens, 260 células de voto
Amostra (49 por estrato + 6 itens da 643ª para dar ≥5 votos a Francisco D'Ângelo). Estratos: 3 por reunião ordinária 632–640; vistas/suspensões; retiradas; blocões (impedimento e agregados 641 e 637); 'com ressalvas/ajuste/observações'; informes; atas; extraordinárias; fonte própria 641–643. Lista (reunião | item):

- DICOL632 | Item C9: VOTO Nº 865/2025/ASSNT-DIGES/DIRAD-DIGES/DIGES em face de RMBG PLANO ODONTOLÓGICO LTDA
- DICOL632 | Item C10: VOTO Nº 830/2025/ASSNT-DIGES/DIRAD-DIGES/DIGES em face de UNIMED SÃO LOURENÇO COOPERA
- DICOL632 | Blocão F.3) Processos de Doença e Lesão Preexistente nº 4: Aprovado por unanimidade, impedida d
- DICOL633 | Item C1: VOTO Nº 122/2026/DIPRO, em face de MAIS SAÚDE S/A, ANS nº 41.951-6.
- DICOL633 | Item A2: Aprovação da proposta de atualização das Regiões de Saúde utilizadas na regulamentação
- DICOL633 | Item B7: VOTO Nº 2/2026/COCAR/GERER/GGAER/DIRAD-DIOPE/DIOPE em face de G L PARTICIPAÇÕES E ADMI
- DICOL634 | Item E11: VOTO Nº 2/2026/RST-DIDES/DIDES em face de UNIMED OESTE DO PARÁ - COOPERATIVA DE TRABA
- DICOL634 | Item B4: Aprovação do Acordo de Cooperação Técnica entre a ANS e o Ministério Público do Estado
- DICOL634 | Item B2: Aprovação (i) do Relatório de Avaliação de Resultado Regulatório, (ii) da Nota Técnica
- DICOL635 | Item C2: Deliberação sobre a proposta de atualização do Rol de Procedimentos e Eventos em Saúde
- DICOL635 | Item B2: Aprovação da proposta de celebração de Acordo de Cooperação Técnica entre a ANS e o TR
- DICOL635 | Item C4: Deliberação sobre a proposta de atualização do Rol de Procedimentos e Eventos em Saúde
- DICOL636 | Item D8: VOTO Nº 2/2026/CODIF/GEAES/GGAER/DIRAD-DIOPE/DIOPE em face de UNIMED PETRÓPOLIS - RJ C
- DICOL636 | Item D9: VOTO Nº 3/2026/CODIF/GEAES/GGAER/DIRAD-DIOPE/DIOPE em face de UNIMED MONTES CLAROS - C
- DICOL636 | Item E1: Aprovação do índice máximo de reajuste para as contraprestações pecuniárias dos planos
- DICOL637 | Item C5: Aprovação da proposta da proposta de Resolução Regimental que altera a RR nº 21/2022 e
- DICOL637 | Item D4: Aprovação da prorrogação do prazo da Consulta Pública nº 170, que trata da proposta de
- DICOL637 | Item C3: Aprovação do Voto nº 381/2026/DIPRO (i) pela apreciação do Relatório de Análise de Res
- DICOL638 | Item B1: Apreciação da proposta de Resolução Normativa que altera a RN nº 585/2023 e da propost
- DICOL638 | Item F10: VOTO Nº 142/2026/ASSNT-DIDES/DIRAD-DIDES/DIDES em face de UNIMED PETROPOLIS-RJ COOPER
- DICOL638 | Item D3: Deliberação sobre a proposta de atualização do Rol de Procedimentos e Eventos em Saúde
- DICOL639 | Item G5: VOTO Nº 45/2026/COCAR/GERER/GGAER/DIRAD-DIOPE/DIOPE em face de VIDAPLAN SAÚDE LTDA – E
- DICOL639 | Item C2: Deliberação sobre o recurso administrativo interposto por AMGEN BIOTECNOLOGIA DO BRASI
- DICOL639 | Item G11: VOTO Nº 22/2026/COIND/GEAES/GGAER/DIRAD-DIOPE/DIOPE em face de UNIMED CUIABÁ COOPERAT
- DICOL640 | Item E12: VOTO Nº 613/2026/DIPRO em face de UNIMED NORTE/NORDESTE- FEDERAÇÃO INTERFEDERATIVA DA
- DICOL640 | Item F1: Informe sobre o PROADI-SUS.
- DICOL640 | Item C2: Deliberação sobre tecnologias em saúde recomendadas positivamente pela Comissão Nacion
- DICOL635 | Item E17: VOTO Nº 0145/2026/ASSNT-DIFIS/DIRAD-DIFIS/DIFIS em face de UNIMED DO ESTADO DO RIO DE
- DICOL635 | Item C1: Aprovação da proposta de convocação de Audiência Pública sobre o tema Aprimoramento da
- DICOL639 | Item G13: VOTO Nº 1/2026/COAOP/GEAOP/GGAME/DIRAD-DIOPE/DIOPE em face de OPERADORA ON MED ASSIST
- DICOL637 | Item G2: Aprovação do Voto nº 8/2026/PRESI/ANS – Unimed do Estado do Rio de Janeiro – Federação
- DICOL633 | Blocão E.3) Processos de Doença e Lesão Preexistente nº 1: Aprovado por unanimidade, impedida d
- DICOL637 | Blocão H.3) Processo de Doença e lesão Preexistente nº 1: Aprovado por unanimidade, impedidas d
- DICOL641 | Blocão (COREC/SECEX): 167 processos
- DICOL637 | Blocão (Circuito Deliberativo/AEP): 204 decisões, 203 processos
- DICOL635 | Item G2: Deliberação sobre o Termo de Compromisso a ser celebrado entre o Ministério Público do
- DICOL634 | Item B1: Aprovação das minutas das atas da 3ª Reunião Extraordinária de Diretoria Colegiada, de
- DICOLE04 | Item B1: Informe sobre o cenário dos novos servidores (especialistas, técnicos e temporários) e
- DICOL636 | Item C1: Informe sobre a direção técnica na Unimed FERJ.
- DICOL640 | Item F2: Informe sobre as medidas adotadas diante das denúncias apresentadas na atuação das jun
- DICOL637 | Item C1: Aprovação das minutas das atas da 6ª Reunião Extraordinária de Diretoria Colegiada, de
- DICOL642 | Item 1: APROVAÇÃO da minuta da ata da 641ª Reunião Ordinária de Diretoria Colegiada, de 07/08/2
- DICOLE07 | Item A1: Deliberação sobre a atualização do Rol de Procedimentos e Eventos em Saúde. Abertura d
- DICOLE06 | Item A1: Deliberação acerca dos cartões de desconto, cartões pré-pagos ou serviços correlatos.
- DICOLE08 | Item A1: Deliberação sobre o reajuste para as contraprestações pecuniárias dos planos privados 
- DICOLE12 | Item 2: Deliberação sobre a proposta de atualização do Rol de Procedimentos e Eventos em Saúde.
- DICOL641 | Item 2: APRECIAÇÃO da proposta de alteração regimental no âmbito da Diretoria de Desenvolviment
- DICOL642 | Item 7: INFORME sobre a divulgação das metas de Excelência e Redução de IGR trimestral referent
- DICOL643 | Item 2: APROVAÇÃO da minuta da ata da 642ª Reunião Ordinária de Diretoria Colegiada, de 26/08/2

Resultado: 231/260 células exatas (88,8%); 23 diferenças de convenção (informes sem linhas de voto = 15; relator em branco para aprovação de ata/retirada/diligência = 8); 6 reais (ver §5). Excluídas as convenções: 231/237 = 97,5%.
| Campo | Acerto |
|---|---|
| resultado/modo | 55/55 |
| impedidos (quem) | 5/5 itens (632 C9, 632 F.3 nº4, 633 E.3 nº1, 637 H.3 nº1 [Lenise e Carla], 638 F10) |
| vencidos | n/a: confirmado por grep que NENHUMA ata ANS traz voto vencido/divergência (só 'boletos vencidos') |
| relator (inferido pela área) | 40/52 estrito; 40/43 nos itens deliberativos (3 restantes = diligência/retirada sem relator, por desenho) |
| ressalvas/observações nominais | 5/6 (falta DICOLE06-A1, ver §5) |
| Diretor (exato/convenção/real/total) | Wadih 43/8/1/52 · Eliane 46/4/1/51 · Jorge 39/5/1/45 · Lenise 47/3/2/52 · Carla 48/3/1/52 · Francisco 7/0/0/7 · Celina 1/0/0/1 |
Celina Maria Ferro de Oliveira só tem 1 voto em todo o JSON (DICOLE12) — impossível chegar a 5.
Mapeamento área→relator conferido: DIDES/PRESI=Wadih; DIPRO=Lenise; DIOPE=Jorge (Carla desde 03/09); DIFIS=Eliane; DIGES=Carla (Francisco desde 03/09). Blocão AEP da 637 = 204 decisões (conferi contagem na ata: bate); blocões 641 (167), 642 (240), 643 (81) conferem com a página oficial.

## 3. ANCINE — 59 itens (53 DDC de RD + CD1..CD6), 230 células de voto
Estratos: 1 por RD (23) + voto contrário/vencido nomeado (3) + 'por maioria' (3) + impedido (2) + 'conhecida' (3) + 'deliberada' (2) + não aprovada (2) + retirada (2) + mantida (1) + ressalva/glosa/condicionante (3) + ad referendum (2) + diligência/consulta jurídica (2) + sessão reservada (2) + administrativa (2) + extrapauta (2) + 6 circuitos. Chaves (reunião, seção, nº, DDC, estrato):

- RD955 item 113 DDC 117 (estrato reunião)
- RD956 item 56 DDC 204 (estrato reunião)
- RD957 item 26 DDC 247 (estrato reunião)
- RD958 item 3 DDC 273 (estrato reunião)
- RD959 item 16 DDC 456 (estrato reunião)
- RD960 item 25 DDC 526 (estrato reunião)
- RD961 item 3 DDC 540 (estrato reunião)
- RD962 item 1 DDC 580 (estrato reunião)
- RD963 item 5 DDC 627 (estrato reunião)
- RD964 item 1 DDC 698 (estrato reunião)
- RD965 item 3 DDC 751 (estrato reunião)
- RD966 item 7 DDC 795 (estrato reunião)
- RD967 item 42 DDC 847 (estrato reunião)
- RD968 item 37 DDC 922 (estrato reunião)
- RD969 item 7 DDC 990 (estrato reunião)
- RD970 item 43 DDC 1076 (estrato reunião)
- RD971 item 7 DDC 1159 (estrato reunião)
- RD972 item 1 DDC 1220 (estrato reunião)
- RD973 item 115 DDC 1431 (estrato reunião)
- RD974 item 2 DDC 1455 (estrato reunião)
- RD975 item 96 DDC 1609 (estrato reunião)
- RD976 item 83 DDC 1711 (estrato reunião)
- RD977 item 4 DDC 1769 (estrato reunião)
- RD972 item 61 DDC 1281 (voto contrário/vencido nomeado)
- RD975 item 103 DDC 1618 (voto contrário/vencido nomeado)
- RD956 item 37 DDC 184 (voto contrário/vencido nomeado)
- RD970 item 65 DDC 1098 (maioria sem nome na ata)
- RD972 item 57 DDC 1277 (maioria sem nome na ata)
- RD973 item 128 DDC 1445 (maioria sem nome na ata)
- RD969 item 24 DDC 1007 (impedido)
- RD965 item 36 DDC 786 (conhecida)
- RD963 item 1 DDC 667 (conhecida)
- RD956 item 68 DDC 217 (conhecida)
- RD966 item 3 DDC 797 (deliberada)
- RD959 item 1 DDC 440 (deliberada)
- RD975 item 35 DDC 1548 (não aprovada/indeferida)
- RD972 item 62 DDC 1282 (não aprovada/indeferida)
- RD976 item 2 DDC 1623 (retirada)
- RD975 item 100 DDC 1613 (retirada)
- RD973 item 9 DDC 1396 (mantida)
- RD960 item 23 DDC 524 (ressalva/glosa/condicionante)
- RD976 item 129 DDC 1761 (ressalva/glosa/condicionante)
- RD976 item 105 DDC 1733 (ressalva/glosa/condicionante)
- RD976 item 120 DDC 1748 (ad referendum)
- RD955 item 71 DDC 75 (ad referendum)
- RD971 item 54 DDC 1206 (diligência/consulta)
- RD957 item 23 DDC 244 (diligência/consulta)
- RD965 item 1 DDC 773 (sessão reservada)
- RD966 item 5 DDC 793 (sessão reservada)
- RD974 item 28 DDC 1481 (sessão administrativa)
- RD976 item 125 DDC 1757 (sessão administrativa)
- RD971 item 57 DDC 1212 (extrapauta)
- RD958 item 139 DDC 415 (extrapauta)
- CD1-E, CD2-E, CD3-E, CD4-E, CD5-E, CD6-E (circuitos; CD7/CD8 sem ata — só pauta)

Resultado: relator 59/59 (RD: vazio como esperado, 'relator não publicado'; CD: relator nomeado correto); voto 230/230 (100%); resultado/modo 59/59 (vencidos 3/3 → DIVERGIU Paulo; impedidos 2/2; abstenção 2/2; 'manifestação própria' 1/1; 'tomou conhecimento'/'deliberada'/'mantida sem modo' → SEM VOTO REVISAR 7/7; 53/53 presenças por RD iguais às minhas). Por diretor: Alex 59/59 · Paulo 59/59 · Patrícia 59/59 · Vinicius 29/29 · Leandro 24/24. Ausência de Patrícia na RD963 (justificada) correta.

## 4. Invariantes globais (JSON e aba Votos de votos_2026.xlsx)
| Invariante | ANA | ANS | ANCINE |
|---|---|---|---|
| xlsx = JSON (votos, linha a linha) | 244=244, 0 dif | 1260=1260, 0 dif | 7000=7000, 0 dif |
| xlsx Deliberações / Reuniões = JSON | 61/12 | 281/25 | 1838/32 |
| 1 voto por presente por item, sem duplicados | OK | OK nos itens com votos; 29 itens sem linhas (24 informes + 5 de DICOL644, reunião futura de 09/10) — por desenho | OK; só CD7/CD8 (votação sem resultado publicado) sem votos |
| relator ⊆ presentes | 3 exceções (relator ausente: desenho) | 0 | 2 (CD7/CD8, pauta, relator Alex sem presentes) |
| vencido nomeado ⇒ DIVERGIU / impedido ⇒ IMPEDIDO | 0 viol. | 0 viol. | 0 viol. (7 DIVERGIU, 2 IMPEDIDO, 16 abstenções) |
| unânime ⇒ nenhum DIVERGIU | OK | OK | OK |
| datas em 2026 | OK | OK | OK |
| proveniência ∈ {nominal, inferido, REVISAR}; REVISAR com motivo | OK | OK (5/5 com motivo) | OK (79/79 com motivo) |
| totais 'Conta nos totais' | 244 Sim | 1260 Sim | 7000 Sim |
| relator ≠ voto RELATOR | 0 | 0 | 1 (RD969 DDC 1016-E) + CD7/CD8 |
| data item ≠ data reunião | 0 | 0 | 14 (RD964: reunião interrompida em 27/04 e retomada em 04/05; DDC são de 04/05 — legítimo) |

## 5. Divergências REAIS (ordenadas por relevância)
1. ANS · DICOL635 Item E17 (voto 0145/2026 DIFIS/Unimed-RJ): fonte diz 'Deliberação suspensa pelo pedido de DILIGÊNCIA à DIOPE feito pela Diretora Eliane'. JSON classifica tipo_item='Vista', Eliane='PEDIU VISTA' e os outros 4 'SEM VOTO AINDA (vista pendente)', relator vazio. Diligência ≠ vista (ciclo de vista/`Status do processo` contaminados). Causa provável: regex 'suspensa pelo pedido de …' trata diligência como vista. (Em C1 da mesma 635, vista real do Wadih, Jorge fica RELATOR — tratamento assimétrico.)
2. ANS · 13 deliberações com relator inferido pela área mas SEM `relator_proveniencia` (todas de fonte própria: DICOL641, 642, 643 e DICOLE12). O relator inferido aparece como se fosse dado; as demais 192 trazem 'inferido'. Causa: ramo de fonte própria/extrato não preenche o campo.
3. ANS · DICOL641 Item 2 e DICOL642 Item 2 ('ITEM APRECIADO', página oficial): JSON dá ACOMPANHOU (inferido)×4 + RELATOR(Wadih); nas atas, 'Apreciado' vira 'SEM VOTO (apreciação, sem votação)' (30 votos). Inconsistência de regra (10 votos). Sem 'unanimidade' na fonte.
4. ANS · DICOLE06 A1 (cartões de desconto): 'acrescida da proposta, feita pela Diretora Lenise' — JSON deixa Lenise como ACOMPANHOU inferido; nas outras 4 ocorrências análogas ('ajuste solicitado', 'observações acolhidas', 'ressalvas') o JSON marca nominal 'com …'. 1 voto.
5. ANCINE · RD969 DDC 1016-E: `relator` vazio mas Patrícia tem voto RELATOR (decisão 'nos termos da manifestação da Diretora Patrícia Barcelos'). Inconsistência deliberação×voto (1 item).
6. ANCINE · RD969 DDC 1007-E e RD970 DDC 1098-E: 'decidiu por MAIORIA' com Paulo impedido; só restam 2 votantes e o JSON infere ACOMPANHOU para ambos. Fonte internamente ambígua (maioria de 2 exige dissenso não nomeado) — deveria ficar REVISAR ou ao menos observação. Risco baixo (2 itens, 4 votos).
7. ANCINE · circuitos: `data` = ABERTURA do circuito (CD1 10/02, mas votação encerrou 03/03 e proclamação saiu 31/03; CD5 17/04→11/05; CD6 28/07→14/08). Ao agregar por mês, decisão cai no mês errado. Convenção a documentar ou trocar pela data de encerramento.

## 6. Falsos positivos / convenções (não são erro)
- ANA: relator ausente com linha 'RELATOR (ausente da reunião)' (950-5, 951-2, 954-1) viola literalmente 'relator ⊆ presentes' — é decisão de desenho; `partes`=1 em vista/retirada.
- ANS: informes (24) e itens da DICOL644 (reunião futura) sem linhas de voto; aprovação de ata/retirada/informe sem relator; diretor que pede retirada fica 'SEM VOTO (retirado de pauta)' e não RELATOR.
- ANCINE: relator vazio nas RD (não publicado); 14 itens da RD964 com data 04/05; CD7/CD8 com relator e sem votos (votação em curso).
- Cabeçalho da ata ANA 956 ('28 de junho') e da ANS 636 ('24 de abril de 2025'): erros da fonte; JSON usou a data correta (2026-07-28 e 2026-04-24).

## 7. URLs da aba 'Faltam na fonte' (20, semente 9004: 6 ANA, 6 ANS, 6 ANCINE, 1 ANAC, 1 ANTAQ)
- 200: 6/6 ANA (gov.br e ata-956 PDF), 4/6 ANS (os 4 endpoints com_dicol/getSelectReunioesAjax e getDadosReuniaoAjax), 6/6 ANCINE (SEI publicações e pesquisas), ANAC departamental (200).
- ANS gov.br/…/reunioes-da-diretoria-da-ans → 302 para tela de login (require_login), ou seja, restrita (consistente com 'fonte oficial restrita'); componentes-portal.ans.gov.br/link/listadicol → 303 para index.html (a listagem não abre).
- ANTAQ sophia.antaq.gov.br/…/42870 → 403 (bloqueio no egress).
- Resultado: 18 respondem 200, 1 redireciona p/ login (302), 1 redireciona p/ home (303), 1 403 — i.e., 18/20 abrem; as 3 não-200 coincidem com 'bloqueado/restrito' descrito na planilha. Extra: url_ata das 11 atas ANA = 200 (RD952 teve 1 reset transitório; RD959 usa /atas/2027/ e responde 200).
- Atenção: 200 prova que a URL abre, não que o conteúdo continue 'ausente'; não reabri cada documento.

## 8. O que NÃO verifiquei
- ANS: ~226 dos 281 itens e as ~2.000 decisões internas dos blocões (só 5 unidades de blocão + contagens dos agregados); anexos PDF/PPTX; extraordinárias 9–11 (sem ata); DICOL644 (futura).
- ANCINE: ~1.770 dos 1.830 itens de RD; 10 itens de sessão reservada sem DDC só pela ata; CD7/CD8 (sem ata); texto extraído × PDF/HTML original (confiei em texto_*).
- ANA: texto_ana × PDF original (PDFs não estão no ambiente).
- Abas Painel/Matriz/Diretores/Controle e dashboard HTML não auditados; só Votos, Deliberações, Reuniões e Faltam na fonte (contagens).
- Voto individual real em decisões 'por unanimidade' não é verificável pela fonte.
