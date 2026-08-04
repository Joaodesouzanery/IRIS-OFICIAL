/**
 * Parser da cobertura-ao-vivo da ANM (QA ago/2026): as páginas atas-da-rop/pautas-da-rop têm
 * uma DATA adjacente a cada link ("31/07/2026 09h37" — verificado ao vivo), mas o parser antigo
 * concatenava os HTMLs e regexava globalmente, descartando o contexto → sem filtro de ano, o
 * `faltando`/`extra` da ANM inflava com reuniões de anos antigos. Aqui: cada nº de reunião é
 * pareado com a data mais próxima (janela de ±300 chars); sem data próxima → ano null (mantido,
 * comportamento anterior — não some reunião por falta de metadado).
 */

export interface AnmReuniaoDetectada {
  numero: number;
  ano: number | null;
}

const RE_NUMERO = /(?:ata|pauta)[_-](\d{1,3})(?=\D|$)|(\d{1,3})[ªa]\s*reuni/gi;
const RE_DATA = /\b\d{2}\/\d{2}\/(20\d{2})\b/g;

export function parseAnmReunioesComAno(html: string): AnmReuniaoDetectada[] {
  // Posições de todas as datas.
  const datas: Array<{ index: number; ano: number }> = [];
  RE_DATA.lastIndex = 0;
  let d: RegExpExecArray | null;
  while ((d = RE_DATA.exec(html)) !== null) datas.push({ index: d.index, ano: Number(d[1]) });

  // Posições de todos os matches de reunião (para delimitar o BLOCO de cada item).
  const matches: Array<{ index: number; numero: number }> = [];
  RE_NUMERO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_NUMERO.exec(html)) !== null) {
    const numero = Number.parseInt(m[1] ?? m[2], 10);
    if (Number.isFinite(numero) && numero > 0 && numero < 10000) matches.push({ index: m.index, numero });
  }

  const vistos = new Map<number, number | null>();
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    // Fim do bloco deste item: o próximo match de OUTRO número (href+texto do mesmo item
    // repetem o número) ou +600 chars. A data do item vem DEPOIS do link (estrutura real
    // verificada ao vivo) — a 1ª data dentro do bloco é a dele; a do vizinho fica fora.
    let fim = cur.index + 600;
    for (let j = i + 1; j < matches.length; j++) {
      if (matches[j].numero !== cur.numero) { fim = Math.min(fim, matches[j].index); break; }
    }
    let ano: number | null = null;
    for (const dt of datas) {
      if (dt.index > cur.index && dt.index < fim) { ano = dt.ano; break; }
    }
    // Mesmo nº visto 2× (ata E pauta): o ano conhecido vence o null.
    const atual = vistos.get(cur.numero);
    if (atual === undefined || (atual === null && ano !== null)) vistos.set(cur.numero, ano);
  }
  return [...vistos.entries()].map(([numero, ano]) => ({ numero, ano })).sort((a, b) => a.numero - b.numero);
}

/** Números de reunião da ANM do ANO pedido (sem data próxima → mantém). */
export function anmNumerosDoAno(htmls: string[], year: number): number[] {
  const out = new Set<number>();
  for (const html of htmls) {
    for (const r of parseAnmReunioesComAno(html)) {
      if (r.ano === null || r.ano === year) out.add(r.numero);
    }
  }
  return [...out].sort((a, b) => a - b);
}
