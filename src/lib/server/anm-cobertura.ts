/**
 * Parser da cobertura-ao-vivo da ANM — lê a ESTRUTURA da página, não conta caracteres (Fase 28).
 *
 * ═══ O instrumento que não media nada ═══
 * A versão anterior pareava cada número de reunião com a primeira data numa janela de 600 chars
 * depois do link. Medido contra a fixture VERBATIM do portal
 * (`__tests__/fixtures/anm/atas-da-rop.html`): a distância real entre o link e a data é de
 * **731 a 799 caracteres em TODOS os 13 matches**. A janela nunca alcança. Resultado:
 * `parseAnmReunioesComAno` devolvia `ano: null` para todas, e `anmNumerosDoAno(html, 2026)` e
 * `anmNumerosDoAno(html, 2025)` retornavam **a mesma lista**. O filtro de ano não filtrava nada —
 * e o `faltando`/`extra` da ANM saía inflado com reuniões de anos antigos, na rota que o operador
 * usa como prova de cobertura.
 *
 * O teste que o "cobria" (etapa37) usava HTML sintético com ~150 chars entre link e data: verde
 * sobre um layout que não existe.
 *
 * ═══ Por que não aumentar a janela para 1200 ═══
 * Seria um limiar tirado de uma amostra de UMA página — exatamente como o 600 nasceu. A fixture
 * oferece coisa melhor que um número: cada item vive num bloco com UMA âncora de conteúdo e um
 * `<time datetime="2026-08-21T10:36:25-03:00">`. Subir do link até o bloco que o contém sozinho é
 * uma regra sobre a ESTRUTURA, que não depende de quanta marcação a origem resolva pôr no meio.
 *
 * ═══ Degrade declarado ═══
 * Layout que o DOM não reconhece cai no scan por regex, com o bloco delimitado pelo próximo número
 * DIFERENTE (não por uma janela fixa), e o resultado vem marcado `estrutura_nao_reconhecida`. Uma
 * origem que muda de layout não pode virar lista vazia em silêncio — é a lição da etapa101.
 */

import { parse as parseHtml, type HTMLElement } from "node-html-parser";

export type SerieDaReuniao = "ROP" | "REP" | null;

export interface AnmReuniaoDetectada {
  numero: number;
  ano: number | null;
  /** ROP (ordinária) × REP (extraordinária). Hoje as faixas não cruzam; é bug latente, não ativo. */
  serie: SerieDaReuniao;
}

export interface AnmLeituraDaPagina {
  reunioes: AnmReuniaoDetectada[];
  /** `true` quando o DOM não deu nenhuma âncora de conteúdo e o scan por regex assumiu. */
  estruturaNaoReconhecida: boolean;
}

const RE_NUMERO = /(?:ata|pauta)[_-](\d{1,3})(?=\D|$)|(\d{1,3})[ªa]\s*reuni/gi;
const RE_DATA_BR = /\b\d{2}\/\d{2}\/(20\d{2})\b/;
const RE_DATA_BR_G = /\b\d{2}\/\d{2}\/(20\d{2})\b/g;
/** O seletor que a coleta já usa: âncora de MENU do Plone leva `state-published`. */
const CLASSE_DE_MENU = "state-published";

function numeroDe(texto: string): number | null {
  RE_NUMERO.lastIndex = 0;
  const m = RE_NUMERO.exec(texto);
  if (!m) return null;
  const n = Number.parseInt(m[1] ?? m[2], 10);
  return Number.isFinite(n) && n > 0 && n < 10000 ? n : null;
}

function serieDe(texto: string): SerieDaReuniao {
  if (/extraordin/i.test(texto)) return "REP";
  if (/ordin/i.test(texto)) return "ROP";
  return null;
}

/** O ano do bloco: `<time datetime>` primeiro (é o dado da origem), `dd/mm/aaaa` depois. */
function anoDoBloco(no: HTMLElement): number | null {
  const time = no.querySelector("time[datetime]");
  const iso = time?.getAttribute("datetime");
  if (iso) {
    const ano = Number.parseInt(String(iso).slice(0, 4), 10);
    if (Number.isFinite(ano) && ano > 1990 && ano < 2200) return ano;
  }
  const m = RE_DATA_BR.exec(no.text ?? "");
  return m ? Number(m[1]) : null;
}

export function lerPaginaDaAnm(html: string): AnmLeituraDaPagina {
  const vistos = new Map<number, AnmReuniaoDetectada>();
  const guardar = (r: AnmReuniaoDetectada) => {
    const atual = vistos.get(r.numero);
    // Mesmo nº visto 2× (ata E pauta): o dado conhecido vence o null, nos dois campos.
    if (!atual) { vistos.set(r.numero, r); return; }
    if (atual.ano === null && r.ano !== null) atual.ano = r.ano;
    if (atual.serie === null && r.serie !== null) atual.serie = r.serie;
  };

  let ancorasDeConteudo = 0;
  try {
    const raiz = parseHtml(html);
    const ancoras = raiz
      .querySelectorAll("a")
      .filter((a) => !String(a.getAttribute("class") ?? "").includes(CLASSE_DE_MENU));

    for (const a of ancoras) {
      const texto = `${a.text ?? ""} ${a.getAttribute("href") ?? ""}`;
      const numero = numeroDe(texto);
      if (numero === null) continue;
      ancorasDeConteudo++;

      // Sobe enquanto o ancestral contiver ESTA âncora sozinha. No momento em que passa a conter
      // duas, o bloco deixou de ser deste item e a data encontrada seria a do vizinho.
      let bloco: HTMLElement = a;
      let ano = anoDoBloco(a);
      let pai = a.parentNode as HTMLElement | null;
      while (ano === null && pai) {
        const dentro = pai
          .querySelectorAll("a")
          .filter((x) => !String(x.getAttribute("class") ?? "").includes(CLASSE_DE_MENU))
          .filter((x) => numeroDe(`${x.text ?? ""} ${x.getAttribute("href") ?? ""}`) !== null);
        if (dentro.length > 1) break;
        bloco = pai;
        ano = anoDoBloco(pai);
        pai = pai.parentNode as HTMLElement | null;
      }
      guardar({ numero, ano, serie: serieDe(`${texto} ${bloco === a ? "" : bloco.text ?? ""}`) });
    }
  } catch {
    // HTML irreparável: cai no scan, que é o caminho de degrade declarado abaixo.
  }

  if (ancorasDeConteudo > 0) {
    return { reunioes: [...vistos.values()].sort((x, y) => x.numero - y.numero), estruturaNaoReconhecida: false };
  }
  return { reunioes: scanPorRegex(html), estruturaNaoReconhecida: true };
}

/**
 * Degrade: sem âncora reconhecível, varre por regex. O bloco de cada item vai até o próximo match
 * de número DIFERENTE — não uma janela de N caracteres, que foi o erro original.
 */
function scanPorRegex(html: string): AnmReuniaoDetectada[] {
  const datas: Array<{ index: number; ano: number }> = [];
  RE_DATA_BR_G.lastIndex = 0;
  let d: RegExpExecArray | null;
  while ((d = RE_DATA_BR_G.exec(html)) !== null) datas.push({ index: d.index, ano: Number(d[1]) });

  const matches: Array<{ index: number; numero: number }> = [];
  RE_NUMERO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_NUMERO.exec(html)) !== null) {
    const n = Number.parseInt(m[1] ?? m[2], 10);
    if (Number.isFinite(n) && n > 0 && n < 10000) matches.push({ index: m.index, numero: n });
  }

  const vistos = new Map<number, AnmReuniaoDetectada>();
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    let fim = html.length;
    for (let j = i + 1; j < matches.length; j++) {
      if (matches[j].numero !== cur.numero) { fim = matches[j].index; break; }
    }
    let ano: number | null = null;
    for (const dt of datas) if (dt.index > cur.index && dt.index < fim) { ano = dt.ano; break; }
    const serie = serieDe(html.slice(cur.index, Math.min(fim, cur.index + 400)));
    const atual = vistos.get(cur.numero);
    if (!atual) vistos.set(cur.numero, { numero: cur.numero, ano, serie });
    else {
      if (atual.ano === null && ano !== null) atual.ano = ano;
      if (atual.serie === null && serie !== null) atual.serie = serie;
    }
  }
  return [...vistos.values()].sort((a, b) => a.numero - b.numero);
}

/** Compatibilidade: a forma antiga, sem a série. */
export function parseAnmReunioesComAno(html: string): AnmReuniaoDetectada[] {
  return lerPaginaDaAnm(html).reunioes;
}

/** Números de reunião da ANM do ANO pedido (sem data → mantém; a dúvida não apaga reunião). */
export function anmNumerosDoAno(htmls: string[], year: number): number[] {
  const out = new Set<number>();
  for (const html of htmls) {
    for (const r of lerPaginaDaAnm(html).reunioes) {
      if (r.ano === null || r.ano === year) out.add(r.numero);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** As reuniões do ano COM a série, para quem puder comparar série a série. */
export function anmReunioesDoAno(htmls: string[], year: number): AnmReuniaoDetectada[] {
  const out = new Map<number, AnmReuniaoDetectada>();
  for (const html of htmls) {
    for (const r of lerPaginaDaAnm(html).reunioes) {
      if (r.ano === null || r.ano === year) out.set(r.numero, r);
    }
  }
  return [...out.values()].sort((a, b) => a.numero - b.numero);
}
