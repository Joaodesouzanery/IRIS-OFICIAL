"use client";

/**
 * O REVOTO, simulado contra o gabarito antes de escrever (Fase 39, passo 3).
 *
 * "Simular" lê o banco e responde, para cada ata conferida à mão: o roster da data CERTIFICADA
 * reproduz o colegiado? o que o revoto apagaria e o completar-parcial acrescentaria? e o DEPOIS bate
 * com o gabarito voto a voto? Só quando reproduz — e quando a data gravada já é a certa, porque o
 * materializador usa a data gravada — o botão de aplicar aparece, por agência.
 */

import { useRef, useState } from "react";
import { api } from "@/lib/api";

type PorDiretor = { nome: string; esperado: number; hoje: number; depois: number };
type Ata = {
  ata: string;
  data_certa: string;
  datas_gravadas: string[];
  roster: string[];
  portao: { reproduz: boolean; faltando: string[]; sobrando: string[] };
  itens_no_banco: number;
  itens_esperados: number;
  apagaria: Array<{ item: string | null; diretor: string }>;
  acrescentaria: number;
  roster_suspeito: Array<{ item: string | null; diretor: string }>;
  recusas_do_completar: Record<string, number>;
  por_diretor: PorDiretor[];
  divergencias_depois: Array<{ tipo: string; diretor?: string; esperado: number; encontrado: number }>;
  reproduz: boolean;
};
type Resposta = { atas: Ata[]; agencias: Record<string, string>; leitura_completa: boolean };
type RespostaMaterializar = { janela_bloco?: number; janela_blocos?: number; revoto_apagados?: number; votos?: number; aplicado_pelo_painel?: boolean };

const TETO_BLOCOS = 80;
const siglaDe = (ata: string) => ata.split(" ")[0];

export function RevotoSimuladoPanel({ demoEnabled }: { demoEnabled: boolean }) {
  const [rodando, setRodando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sim, setSim] = useState<Resposta | null>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const parar = useRef(false);

  async function simular() {
    if (rodando || demoEnabled) return;
    setErro(null); setRodando("simular");
    try {
      setSim(await api.post<Resposta>("/admin/votos/simular-revoto", {}));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao simular.");
    } finally { setRodando(null); }
  }

  /** Varre os blocos da janela do materializador, UM pedido por bloco, aplicando. */
  async function varrer(modo: "revoto" | "completar_parcial", agenciaId: string, rotulo: string): Promise<number> {
    let total = 0;
    for (let bloco = 0, n = 1; bloco < n && bloco < TETO_BLOCOS && !parar.current; bloco += 1) {
      setProgresso(`${rotulo}: bloco ${bloco + 1} de ${n}…`);
      const r = await api.post<RespostaMaterializar>("/admin/votos/materializar-faltantes", {
        [modo]: true, aplicar: true, dry_run: false, agencia_id: agenciaId, bloco,
      });
      n = Math.max(1, Number(r.janela_blocos ?? 1));
      total += modo === "revoto" ? Number(r.revoto_apagados ?? 0) : Number(r.votos ?? 0);
    }
    return total;
  }

  async function aplicar(sigla: string, comRevoto: boolean) {
    const agenciaId = sim?.agencias?.[sigla];
    if (!agenciaId || rodando || demoEnabled) return;
    const ok = typeof window !== "undefined" && window.confirm(
      `Aplicar na ${sigla}: ${comRevoto ? "1) revoto (apaga o voto INFERIDO de quem não tinha mandato na data, com auditoria) e 2) " : ""}` +
      "completar o colegiado parcial (cria o voto inferido de quem tinha mandato e não tem linha, só onde o documento nomeia os presentes).\n\n" +
      "Voto nominal nunca é apagado. Confirme que a simulação reproduziu o gabarito.",
    );
    if (!ok) return;
    parar.current = false; setErro(null); setRodando(sigla);
    try {
      const apagados = comRevoto ? await varrer("revoto", agenciaId, `Revoto ${sigla}`) : 0;
      const criados = await varrer("completar_parcial", agenciaId, `Completar ${sigla}`);
      setProgresso(`${sigla}: ${apagados} voto(s) inferido(s) fora do mandato apagado(s) (auditados) · ${criados} voto(s) criado(s). Simule de novo para conferir.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao aplicar.");
    } finally { setRodando(null); }
  }

  const porSigla = new Map<string, Ata[]>();
  for (const a of sim?.atas ?? []) porSigla.set(siglaDe(a.ata), [...(porSigla.get(siglaDe(a.ata)) ?? []), a]);

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Revoto — simulado contra o gabarito antes de escrever</h2>
          <p className="text-xs text-text-muted mt-1 max-w-3xl">
            Na data conferida contra o PDF, o colegiado bate com a ata? O que sairia e o que entraria? O
            resultado bate voto a voto com o gabarito? Aplicar só aparece quando sim — e quando a data
            gravada já é a certa (corrija em &ldquo;Datas a corrigir&rdquo; antes).
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-xs" disabled={Boolean(rodando) || demoEnabled} onClick={simular}>
            {rodando === "simular" ? "Simulando…" : "Simular"}
          </button>
          {rodando && rodando !== "simular" ? (
            <button type="button" className="btn-secondary text-xs" onClick={() => { parar.current = true; }}>Parar</button>
          ) : null}
        </div>
      </div>
      {erro ? <p className="text-xs text-error">{erro}</p> : null}
      {progresso ? <p className="text-xs text-text-primary">{progresso}</p> : null}
      {sim && !sim.leitura_completa ? <p className="text-xs text-warning">⚠️ Leitura incompleta — não aplique sobre esta simulação.</p> : null}

      {[...porSigla.entries()].map(([sigla, atas]) => {
        const datasCertas = atas.every((a) => a.datas_gravadas.length === 1 && a.datas_gravadas[0] === a.data_certa);
        const reproduz = atas.every((a) => a.reproduz);
        const comRevoto = sigla === "ANM";
        return (
          <div key={sigla} className="rounded-md border border-border p-3 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-text-primary">{sigla}</p>
              {reproduz && datasCertas && sim?.leitura_completa ? (
                <button type="button" className="btn-primary text-xs" disabled={Boolean(rodando) || demoEnabled} onClick={() => aplicar(sigla, comRevoto)}>
                  {comRevoto ? `Aplicar revoto + completar na ${sigla}` : `Aplicar completar na ${sigla}`}
                </button>
              ) : (
                <span className="text-text-muted">
                  {!reproduz ? "não reproduz o gabarito — não aplicar" : !datasCertas ? "a data gravada ainda não é a certa — corrija antes" : ""}
                </span>
              )}
            </div>
            {atas.map((a) => (
              <div key={a.ata} className="border-t border-border pt-2 space-y-1">
                <p>
                  <span className={a.reproduz ? "text-success font-semibold" : "text-error font-semibold"}>{a.reproduz ? "✓" : "✕"} {a.ata}</span>
                  {" "}— data certa {a.data_certa}; gravada {a.datas_gravadas.join(", ") || "—"} · itens {a.itens_no_banco} de {a.itens_esperados}
                </p>
                <p className={a.portao.reproduz ? "text-text-muted" : "text-error"}>
                  Colegiado na data certa: {a.roster.join(", ") || "vazio"}
                  {a.portao.faltando.length ? ` · falta: ${a.portao.faltando.join(", ")}` : ""}
                  {a.portao.sobrando.length ? ` · sobra: ${a.portao.sobrando.join(", ")}` : ""}
                </p>
                <p className="text-text-muted">
                  Revoto apagaria {a.apagaria.length} · completar criaria {a.acrescentaria}
                  {a.roster_suspeito.length ? ` · ${a.roster_suspeito.length} nominal(is) fora do mandato (ficam)` : ""}
                  {Object.keys(a.recusas_do_completar).length ? ` · recusas: ${Object.entries(a.recusas_do_completar).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}
                </p>
                <p className="tabular-nums">
                  {a.por_diretor.map((d) => `${d.nome.split(" ")[0]} ${d.hoje}→${d.depois} (gabarito ${d.esperado})`).join(" · ")}
                </p>
                {a.divergencias_depois.length ? (
                  <p className="text-warning">Depois ainda diverge: {a.divergencias_depois.slice(0, 6).map((d) => `${d.tipo}${d.diretor ? ` ${d.diretor}` : ""} (esperado ${d.esperado}, seria ${d.encontrado})`).join("; ")}</p>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
