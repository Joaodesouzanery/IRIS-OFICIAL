# Fotos dos eventos

Solte aqui os arquivos `.jpg` das fotos dos eventos. O nome do arquivo é o **slug do título do
evento**: minúsculas, sem acento, espaços virando hífen.

Exemplos, a partir dos eventos que hoje estão no calendário:

| evento | arquivo esperado |
|---|---|
| 1º Fórum Brasil de Regulação | `1o-forum-brasil-de-regulacao.jpg` |
| Summit Future Minerals | `summit-future-minerals.jpg` |
| Seminário IRIS do Setor Metroferroviário | `seminario-iris-do-setor-metroferroviario.jpg` |
| Painel IRIS – Telecomunicações | `painel-iris-telecomunicacoes.jpg` |

⚠️ Não é preciso mexer em código: `LpEventos.tsx` confere o disco a cada render (`existsSync`).
Arquivo que existir aparece; o que faltar continua com o placeholder desenhado.

Proporção recomendada: **16:9** (ex.: 1280×720). Peso alvo: até ~200 KB.
