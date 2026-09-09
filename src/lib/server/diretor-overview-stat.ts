/**
 * A agregação de UM voto no card do diretor — pura, para ser testada (Fase 22).
 *
 * ═══ Por que separar impedimento de ausência ═══
 * O card somava `Ausente` de qualquer motivo com `Abstencao` num único "+N aus/abst". Mas
 * impedimento (o diretor ESTAVA na sessão e não votou aquele item, por suspeição/impedimento) e
 * ausência física são coisas diferentes para quem lê o perfil de um diretor — e o dado já existia
 * em `motivo_nao_voto`; a rota só não o selecionava. Com "+48 aus/abst" num único diretor da
 * ARTESP, a primeira pergunta é "48 do quê?", e o card não sabia responder.
 */

export interface StatDoDiretor {
  total: number;
  favoravel: number;
  desfavoravel: number;
  divergente: number;
  nominais: number;
  inferidos: number;
  ausentes: number;
  abstencoes: number;
  /** `Ausente` com `motivo_nao_voto` de impedimento/suspeição — estava na sessão, não votou. */
  impedidos: number;
}

export interface LinhaDeVoto {
  tipo_voto?: string | null;
  motivo_nao_voto?: string | null;
  is_divergente?: boolean | null;
  nominal: boolean;
}

export function statVazio(): StatDoDiretor {
  return { total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, ausentes: 0, abstencoes: 0, impedidos: 0 };
}

export function agregarVoto(s: StatDoDiretor, v: LinhaDeVoto): void {
  s.total++;
  if (v.tipo_voto === "Favoravel") s.favoravel++;
  else if (v.tipo_voto === "Desfavoravel") s.desfavoravel++;
  else if (v.tipo_voto === "Ausente") {
    if (v.motivo_nao_voto === "impedimento" || v.motivo_nao_voto === "suspeicao") s.impedidos++;
    else s.ausentes++;
  }
  else if (v.tipo_voto === "Abstencao") s.abstencoes++;
  if (v.is_divergente) s.divergente++;
  if (v.nominal) s.nominais++; else s.inferidos++;
}
