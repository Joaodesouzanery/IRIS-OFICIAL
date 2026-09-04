---
name: teste-nao-tautologico
description: Impede o teste que não pode discordar do código — porque usa a mesma fonte de verdade, casa o próprio comentário, ou passa por coincidência de setup. Use ao escrever QUALQUER teste novo e antes de considerar um commit pronto.
---

# Teste não-tautológico

Um teste só vale se ele **pode ficar vermelho**. O padrão que se repete aqui é o teste que
compartilha a fonte de verdade com o código sob teste — então concorda com ele por construção,
inclusive quando o código está errado.

## Os casos REAIS

| Caso | Por que não podia discordar |
|---|---|
| **Asserção casando o COMENTÁRIO** | o teste procurava a string `"SÓ o caminho ancorado"` no arquivo. O comentário dizia isso; o código chamava `extractFields`, com o fallback que causou o bug de 1996. Prosa não prova conduta. |
| **Moeda do planejador × do executor** | a simulação media o orçamento com a régua do planejador, a mesma que estava errada. Ela protegia o bug de off-by-4s em vez de pegá-lo. |
| **Balde já filtrado (C16)** | o teste alimentava a checagem com a lista de onde o impedido já tinha sido removido — a invariante nunca poderia falhar. |
| **Pino que passava por acaso** | `.in("id",` contado ≥3: continuava passando depois de o contrato mudar, porque havia `.in` de OUTRAS consultas no mesmo recorte. |
| **Coincidência de setup (Fase 19)** | a certificação alimentava o NOME do nosso fixture (`antt-pauta-1036.pdf`, que contém "pauta"). Com o nome real de produção, o mesmo PDF falhava. 46/46 verdes sobre um caso que produção não vive. |

## As regras

1. **Nasce VERMELHO.** Rode o teste contra o código ANTES do conserto e guarde a mensagem — a boa
   mensagem de falha é a descrição do bug (`expected 1 to be 50` foi o retrato exato do
   estrangulamento da coleta).
2. **Mutação nos DOIS sentidos.** Reverter o conserto derruba o teste; e remover a guarda de falso
   positivo também. Se a mutação sobrevive, **o teste é reescrito** — nunca o código é "ajustado
   para passar".
3. **Asserções negativas contra o código SEM comentários.** O cabeçalho explica o bug e cita o
   padrão proibido; casar o arquivo cru faz a explicação reprovar o conserto.
4. **Prefira comportamento a `toMatch`.** Rodar o parser contra a fixture real prova o
   comportamento; procurar uma string prova que alguém escreveu a string.
5. **Alimente o teste com a entrada de PRODUÇÃO, não a do repo.** Se o dado real chega com outro
   nome, outra codificação ou outro caminho, é ESSE que o teste tem de usar.

## Antes de dar o commit por pronto

- [ ] O teste ficou vermelho antes do conserto? (com a mensagem guardada no commit)
- [ ] A mutação que reverte o conserto derruba?
- [ ] A mutação que remove a guarda de falso positivo derruba?
- [ ] As asserções negativas rodam sobre o código sem comentários?
- [ ] A entrada é a de produção (nome, codificação, caminho), não a conveniente?
