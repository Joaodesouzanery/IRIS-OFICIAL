/**
 * Escolhe a codificação do nome do arquivo por PLAUSIBILIDADE, não por palpite (Fase 31).
 *
 * ═══ O defeito que este módulo conserta, e por que ele é instrutivo ═══
 * A Fase 14 corrigiu um mojibake de nome de entrada de ZIP trocando "UTF-8 leniente" por
 * "UTF-8 estrito, com fallback Latin-1". O fallback foi escolhido MEDINDO um lote de ZIPs da
 * ARTESP, e o docblock de `zip-extractor.ts` registrou a conclusão: *"os antigos (2023) têm
 * LATIN-1 sem flag — Ç=0xC7, Ã=0xC3, º=0xBA"*.
 *
 * ⚠️ Produção refutou isso: **623 nomes (23% do acervo, 100% ARTESP)** saíram como
 * `"DELIBERAÇO ARTESP N§ 646"`. Se os bytes fossem 0xC7/0xC3/0xBA, `toString("latin1")` devolveria
 * `Ç Ã º` perfeitos e não haveria defeito nenhum. Os bytes são **CP850** — a página DOS latina que
 * os produtores brasileiros usam:
 *
 *   byte 0x80 → CP850 `Ç` → lido como Latin-1 vira U+0080, um controle INVISÍVEL
 *   byte 0xC7 → CP850 `Ã` → lido como Latin-1 vira `Ç`
 *   byte 0xA7 → CP850 `º` → lido como Latin-1 vira `§`
 *   byte 0xB5 → CP850 `Á` → lido como Latin-1 vira `µ`   ← o discriminador: CP437 não tem `Á`
 *
 * É por isso que parece que "o Ã sumiu": o `Ç` virou invisível e o `Ã` deslizou para `Ç`.
 * A Fase 14 acertou ao descartar CP437 (testou, e CP437 produziria `╟├║`) e errou ao concluir
 * Latin-1, porque nunca testou CP850. Ela trocou a IDENTIDADE do mojibake (U+FFFD → `§`/`µ`) e o
 * monitor existente, que conta só U+FFFD, ficou cego.
 *
 * ═══ ⚠️ Por que a nota é por conjunto ESPERADO, e não por lista de caracteres ruins ═══
 * A tentação é penalizar C1, NBSP e box-drawing — os caracteres que ESTE mojibake produz. Seria a
 * mesma armadilha de novo: resolve o caso visto e falha no seguinte, porque a lista só conhece as
 * páginas de código que alguém já encontrou. A nota aqui é a **fração de caracteres dentro do
 * conjunto plausível** para nome de documento brasileiro. Assim qualquer caractere inesperado — de
 * qualquer página que eu nunca enumerei — pontua mal sozinho, sem precisar estar numa lista.
 */

/**
 * As páginas de código, 0x80–0xFF. Geradas a partir do `codecs` do Python e conferidas contra os
 * quatro bytes do caso real. São DADO, não dependência: o Node não traz CP850 nem CP437
 * (`new TextDecoder("cp850")` lança), e o repo tem 29 dependências — nenhuma de encoding.
 */
const CP850 =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ" +
  "áíóúñÑªº¿®¬½¼¡«»" +
  "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" +
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" +
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" +
  "ÓßÔÒõÕµþÞÚÛÙýÝ¯´" +
  "­±‗¾¶§÷¸°¨·¹³²■ ";

const CP437 =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜ¢£¥₧ƒ" +
  "áíóúñÑªº¿⌐¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩" +
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

export type CodificacaoDoNome = "utf-8" | "latin-1" | "cp850" | "cp437";

/**
 * O conjunto plausível num nome de documento regulatório brasileiro.
 *
 * Deliberadamente generoso na acentuação e avaro no resto: é a assimetria que faz a nota funcionar
 * sem lista de proibidos. Note que `º` e `ª` ENTRAM — "Nº 646" e "83ª ROP" são a norma aqui.
 */
const PLAUSIVEL = new Set(
  ("abcdefghijklmnopqrstuvwxyz" +
   "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
   "áàâãäéèêëíìîïóòôõöúùûüçñ" +
   "ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ" +
   "0123456789" +
   " .,-_()[]{}'ºª#&+/°;!@=~").split(""),
);

/** A fração de caracteres dentro do conjunto plausível. Vazio vale 0 — não é nome. */
export function notaDePlausibilidade(nome: string): number {
  if (nome.length === 0) return 0;
  let bons = 0;
  for (const ch of nome) if (PLAUSIVEL.has(ch)) bons++;
  return bons / [...nome].length;
}

function decodeComTabela(bytes: Uint8Array, tabela: string): string {
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : tabela[b - 0x80];
  return out;
}

export interface EscolhaDeNome {
  nome: string;
  codificacao: CodificacaoDoNome;
  nota: number;
  /** Todos os candidatos com suas notas — é o que torna a escolha auditável. */
  candidatos: Array<{ codificacao: CodificacaoDoNome; nome: string; nota: number }>;
}

const UTF8_ESTRITO = new TextDecoder("utf-8", { fatal: true });

/**
 * Decodifica os bytes do nome escolhendo a página de código mais plausível.
 *
 * UTF-8 ESTRITO primeiro e sem concorrência: se os bytes são UTF-8 válido, eles SÃO UTF-8 — a
 * probabilidade de uma sequência multibyte válida ser outra coisa é desprezível, e o produtor que
 * liga o bit 11 da spec do ZIP está dizendo exatamente isso.
 *
 * ⚠️ Empate mantém **Latin-1**, que é o comportamento de hoje: uma mudança de codificação sem
 * ganho medido de plausibilidade não é melhoria, é risco. É também o que garante que nome ASCII
 * puro (a maioria) atravesse idêntico — os três candidatos produzem a mesma string, e a ordem
 * decide sem efeito.
 */
export function decodificarNomeDeArquivo(bytes: Uint8Array): EscolhaDeNome {
  try {
    const nome = UTF8_ESTRITO.decode(bytes);
    return { nome, codificacao: "utf-8", nota: notaDePlausibilidade(nome), candidatos: [] };
  } catch {
    /* não é UTF-8: vai para a disputa entre as páginas de código */
  }

  // Latin-1 é identidade byte↔codepoint — não precisa de tabela, e é essa propriedade que torna o
  // dano reversível: o byte original sobrevive DENTRO da string corrompida.
  const comoLatin1 = Array.from(bytes, (b) => String.fromCharCode(b)).join("");

  // ⚠️ A ORDEM é o desempate: latin-1 primeiro preserva o comportamento atual quando ninguém é
  // estritamente melhor. Trocar de codificação sem ganho medido não é melhoria, é risco.
  const candidatos: EscolhaDeNome["candidatos"] = [
    { codificacao: "latin-1" as const, nome: comoLatin1 },
    { codificacao: "cp850" as const, nome: decodeComTabela(bytes, CP850) },
    { codificacao: "cp437" as const, nome: decodeComTabela(bytes, CP437) },
  ].map(({ codificacao, nome }) => ({ codificacao, nome, nota: notaDePlausibilidade(nome) }));

  let melhor = candidatos[0];
  for (const c of candidatos) if (c.nota > melhor.nota) melhor = c;
  return { nome: melhor.nome, codificacao: melhor.codificacao, nota: melhor.nota, candidatos };
}

/**
 * Reinterpreta um nome JÁ GRAVADO, para o reparo do acervo.
 *
 * ⚠️ Isto só é possível porque `latin1` no Node é identidade byte↔codepoint: **a string corrompida
 * ainda CARREGA os bytes originais**. Por isso o reparo é sem perda e não exige re-download — ao
 * contrário do mojibake de U+FFFD da era pré-Fase-14, em que o byte se perdeu de verdade.
 *
 * Devolve `null` quando o nome tem caractere acima de U+00FF: aí ele não veio de uma leitura
 * Latin-1 e não há bytes a reinterpretar.
 */
export function reinterpretarNomeGravado(nome: string): EscolhaDeNome | null {
  const pontos = [...nome];
  if (pontos.some((ch) => ch.codePointAt(0)! > 0xff)) return null;
  const bytes = Uint8Array.from(pontos, (ch) => ch.charCodeAt(0));
  return decodificarNomeDeArquivo(bytes);
}

/**
 * O nome gravado está corrompido, e qual seria o reparo?
 *
 * ⚠️ O teste é COMPARATIVO, nunca por lista de caracteres. `"Ata ordinária"` corrompido vira
 * `"Ata ordin ria"` — o `á` (CP850 0xA0) vira NBSP, **sem nenhum caractere de controle**. Um
 * detector que procurasse só C1 perderia esse caso inteiro.
 *
 * E a margem existe porque o reparo aplicado a um nome SADIO o destrói: `"DELIBERAÇÃO"` viraria
 * `"DELIBERAÃ├O"`. Sem exigir ganho ESTRITO de plausibilidade, o conserto corromperia os 2.103
 * nomes que estão certos.
 */
export function reparoDoNome(nome: string): { reparado: string; codificacao: CodificacaoDoNome } | null {
  const escolha = reinterpretarNomeGravado(nome);
  if (!escolha) return null;
  // ⚠️ UMA guarda, e ela basta — a primeira versão tinha duas, e a segunda era INALCANÇÁVEL.
  //
  // `nome` É, por construção, o candidato latin-1 (identidade byte↔codepoint). Logo a nota da
  // escolha é sempre >= a nota de `nome`, e o desempate por ordem devolve o próprio latin-1
  // quando ninguém é melhor. Então `escolha.nome !== nome` já significa "outra página pontuou
  // ESTRITAMENTE melhor": um `if (escolha.nota <= nota(nome))` depois disso nunca dispararia.
  // Guarda que não pode disparar é pior que guarda nenhuma — ela dá confiança que não existe.
  // A propriedade que ela aparentava proteger é asseverada por teste, sobre um corpus inteiro.
  if (escolha.nome === nome) return null;
  return { reparado: escolha.nome, codificacao: escolha.codificacao };
}
