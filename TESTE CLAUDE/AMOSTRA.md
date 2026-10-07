# Amostra manual de verificação (07/10/2026)
Método: li, contra o texto da fonte, **todos** os casos não unânimes da ANM (20 itens) e da ANTT (24 itens), e conferi por contagem independente as âncoras de cada ata (ANM `DELIBERAÇÃO:`, ANTT `Decisão:`, ARTESP `N. Deliberação ARTESP nº`). Não é auditoria de 100% dos itens unânimes.

## Erros do meu parser achados e corrigidos
| Agência | Erro | Correção |
|---|---|---|
| ANM | Itens "PROCESSOS Nº:" (plural, vários processos, ex.: 108 processos da Mineração Caldense) escapavam | regex aceita plural/espaçamento/OCR ("No:", "N:") |
| ANM | Relator pelo cabeçalho errado em 2 itens da ROP83 (texto diz "Voto do Relator, Diretor-Geral") | texto da deliberação prevalece |
| ANM | Itens em vista: texto nomeia quem votou a favor e quem pediu vista, mas ficava "revisar" | `ACOMPANHOU (votou a favor antes da vista)` e `PEDIU VISTA` nominais |
| ANM | "divergência registrada pelo Diretor-Geral" só era vista para "Revisor" | `DIVERGIU` nominal; demais `ACOMPANHOU (por exclusão)`, inferido |
| ANTT | "retirado de pauta" sem a falha de ligadura caía em OUTRO (24 → 1) | regex tolera "retirado"/"re rado" |
| ANTT | "D ecisão:" com caractere invisível perdia 1 deliberação (RDE280) | normalização |
| ANTT | "vista coletiva" (ROD1036) | `SOBRESTADO (vista coletiva)` |
| ANTT | Vistas: demais diretores ficavam "revisar" | `SEM VOTO AINDA (vista pendente)`, inferido |
| ARTESP | Ausência justificada contava como presença (Zanatto) | presentes/ausentes separados (9 reuniões com 3 presentes) |
| ARTESP | Deliberações "(Cancelada)/(CANCELADA)/(Cancelado)" descartadas; seção "PARA REGISTRO" gerava itens falsos; rodapé de assinatura digital quebrava o item | tratados; canceladas ficam sem voto |

## Erros **da fonte** (ARTESP) detectados pela conciliação com os PDFs de Deliberação
- Ata da 236ª numera como **282** a deliberação que o PDF numera **303** (mesmo processo); a ata da 239ª numera duas como **479** (a segunda é a **480**). Corrigido pelo PDF; número original guardado.
- A "ata" publicada na linha da **243ª extraordinária (24/07)** é a da **244ª**; a ata real não está publicada. Deliberações 539 e 540 (PDF-imagem, lidas por OCR) reconstruídas; presença = 4 diretores assinantes.
- Ata da 1187ª traz "1178ª" no título (data bate: 25/03): erro de digitação, sem efeito.
- Números 12, 76, 77, 80, 102, 103 não aparecem em nenhuma ata nem PDF de Deliberação (provavelmente canceladas não listadas): lacuna **da fonte**, a confirmar com a ARTESP.

## Limites que permanecem
- Em unanimidade, o voto individual é **inferido** (a ata só diz "por unanimidade"); só relator, vista, ausência, retirada e divergência são nominais.
- Itens ANM por maioria sem nomes (ex.: 27203.802386/1974-22) ficam `REVISAR`.
- Não conferi manualmente uma amostra dos itens unânimes; a contagem automática bate com as âncoras, mas campos como interessado/assunto não foram auditados item a item.
