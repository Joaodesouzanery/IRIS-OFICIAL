/**
 * Quais tipos de item detectado a ESTEIRA DE VOTOS realmente processa (Fase 7).
 *
 * Isto existia como um array local dentro da rota de enfileiramento, invisível para a tela — e o
 * resultado foi a tela prometer, embaixo de 676 itens, que "o próximo Rodar tudo baixa/enfileira
 * em rodadas". Era falso para 100% do que ela mostrava: `noticia`, `politica_publica`,
 * `consulta_publica` e `diretoria` nunca foram enfileiráveis, então aqueles itens não iam sair de
 * `novo` nunca — nem naquela rodada, nem em nenhuma.
 *
 * A lista passa a ser compartilhada para que a promessa da UI e o comportamento do servidor não
 * possam divergir de novo: quem enfileira e quem explica leem o MESMO array.
 *
 * ⚠️ `diretoria` está fora de propósito: é o tipo de páginas institucionais ("Composição da
 * Diretoria", "Quem é quem"). Que as ATAS da ANM caiam nele é um defeito de classificação, tratado
 * à parte — a correção é fazer a ata ser classificada como `ata`, nunca admitir `diretoria` aqui.
 */

/** Tipos que o enfileiramento de PDFs aceita (espelha o gate de `deliberacoes/enqueue-pdfs`). */
export const TIPOS_ESTEIRA_VOTOS = [
  "voto",
  "ata",
  "deliberacao",
  "pauta",
  "documento",
  "reuniao",
] as const;

const CONJUNTO = new Set<string>(TIPOS_ESTEIRA_VOTOS);

/** O item pode, algum dia, virar deliberação/voto? */
export function podeVirarVoto(tipo: string | null | undefined): boolean {
  return !!tipo && CONJUNTO.has(tipo);
}

/**
 * Por que um tipo NÃO é processado pela esteira de votos — o texto que a tela mostra no lugar da
 * promessa falsa. `null` quando o tipo é elegível.
 */
export function destinoForaDaEsteira(tipo: string | null | undefined): string | null {
  if (podeVirarVoto(tipo)) return null;
  switch (tipo) {
    case "noticia":
      return "notícia — alimenta Notícias e Documentos de Associados, não vira voto";
    case "politica_publica":
    case "consulta_publica":
      return "consulta/política pública — não é decisão colegiada";
    case "diretoria":
      return "página institucional de diretoria — não é documento de decisão";
    case "ato_nomeacao":
    case "mandato":
      return "ato de nomeação/mandato — alimenta Governança, não a esteira de votos";
    default:
      return "tipo fora do escopo da esteira de votos";
  }
}
