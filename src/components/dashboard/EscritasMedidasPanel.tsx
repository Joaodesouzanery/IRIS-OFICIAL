"use client";

/**
 * As escritas da Fase 36 que nasceram MEDIDAS — e o número delas, sem `curl`.
 *
 * Três medições, cada uma VARRENDO o estoque inteiro em pedaços (ver `medicoes-varredura.ts`):
 *  · Completar colegiado parcial (Bloco A) — DESLIGADA no código (`COMPLETAR_PARCIAL`);
 *  · Revoto por data corrigida (B.4) — DESLIGADO no código (`REVOTO_LIGADO`);
 *  · Ausências da ARTESP que a ata diz (Bloco D) — simulação; "Aplicar" grava só depois de você
 *    conferir os trechos contra o PDF.
 *
 * ⚠️ Medir NUNCA escreve: as duas primeiras vão com `dry_run: true` e, mesmo sem ele, as constantes
 * desligadas esvaziam o lote. Só o botão "Aplicar" das ausências grava — com confirmação.
 */

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  AUSENCIAS_VAZIO,
  PARCIAL_VAZIO,
  REVOTO_VAZIO,
  acumularAusencias,
  acumularParcial,
  acumularRevoto,
  continuarAusencias,
  textoPorAgencia,
  type AcumuladoAusencias,
  type AcumuladoParcial,
  type AcumuladoRevoto,
  type RespostaAusencias,
  type RespostaParcial,
  type RespostaRevoto,
} from "@/lib/medicoes-varredura";

/** Teto de chamadas por varredura — cada uma lê o acervo inteiro; a tela não pode girar sem fim. */
const TETO_CHAMADAS = 80;

type Medicao = "parcial" | "revoto" | "ausencias" | "aplicar";

export function EscritasMedidasPanel({ demoEnabled }: { demoEnabled: boolean }) {
  const [rodando, setRodando] = useState<Medicao | null>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [parcial, setParcial] = useState<AcumuladoParcial | null>(null);
  const [revoto, setRevoto] = useState<AcumuladoRevoto | null>(null);
  const [ausencias, setAusencias] = useState<AcumuladoAusencias | null>(null);
  const parar = useRef(false);

  async function varrerBlocos<T extends { blocos_medidos: number; blocos_total: number }, R>(
    tipo: "parcial" | "revoto",
    vazio: T,
    acumular: (acc: T, r: R) => T,
    corpo: Record<string, unknown>,
    publicar: (acc: T) => void,
  ) {
    let acc = vazio;
    // O 1º bloco revela quantos existem; daí em diante, um pedido por bloco — nenhum repetido.
    for (let bloco = 0, chamadas = 0; chamadas < TETO_CHAMADAS; bloco += 1, chamadas += 1) {
      if (parar.current) break;
      setProgresso(`${tipo === "parcial" ? "Colegiado parcial" : "Revoto"}: bloco ${bloco + 1}${acc.blocos_total ? ` de ${acc.blocos_total}` : ""}…`);
      const r = await api.post<R>("/admin/votos/materializar-faltantes", { ...corpo, dry_run: true, bloco });
      acc = acumular(acc, r);
      publicar(acc);
      if (acc.blocos_total === 0 || bloco + 1 >= acc.blocos_total) break;
    }
  }

  async function medir(tipo: Medicao) {
    if (rodando || demoEnabled) return;
    parar.current = false;
    setErro(null);
    setRodando(tipo);
    try {
      if (tipo === "parcial") {
        await varrerBlocos<AcumuladoParcial, RespostaParcial>("parcial", PARCIAL_VAZIO, acumularParcial, { completar_parcial: true }, setParcial);
      } else if (tipo === "revoto") {
        await varrerBlocos<AcumuladoRevoto, RespostaRevoto>("revoto", REVOTO_VAZIO, acumularRevoto, { revoto: true }, setRevoto);
      } else {
        const aplicar = tipo === "aplicar";
        if (aplicar) {
          const base = ausencias;
          const ok = typeof window !== "undefined" && window.confirm(
            `Gravar as ausências que a ata da ARTESP DIZ e o banco não tem?\n\n` +
            `Simulação: ${base?.a_inserir ?? "?"} linha(s) a inserir e ${base?.a_promover ?? "?"} a promover ` +
            `(de inferida para a ausência lida). Voto nominal existente NÃO é tocado; nada é apagado.\n\n` +
            `Confirme que conferiu os trechos contra o PDF.`,
          );
          if (!ok) return;
        }
        let acc = AUSENCIAS_VAZIO;
        for (let chamadas = 0; chamadas < TETO_CHAMADAS; chamadas += 1) {
          if (parar.current) break;
          setProgresso(`Ausências ARTESP${aplicar ? " (gravando)" : ""}: ${acc.examinadas}${acc.candidatas ? ` de ${acc.candidatas}` : ""} deliberações…`);
          const r = await api.post<RespostaAusencias>("/admin/votos/ausencias-artesp", {
            dry_run: !aplicar, offset: acc.proximo_offset,
          });
          const depois = acumularAusencias(acc, r);
          const segue = continuarAusencias(acc, depois, r);
          acc = depois;
          setAusencias(acc);
          if (!segue) break;
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao medir.");
    } finally {
      setRodando(null);
      setProgresso(null);
    }
  }

  const parcialTexto = (a: AcumuladoParcial) => a.blocos_medidos < a.blocos_total
    ? `PARCIAL — ${a.blocos_medidos} de ${a.blocos_total} blocos`
    : `${a.blocos_medidos} de ${a.blocos_total} blocos (estoque inteiro)`;

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Escritas medidas e desligadas — o número antes de ligar</h2>
        <p className="text-xs text-text-muted mt-1 max-w-3xl">
          Medir não grava nada. Cada medição varre o estoque inteiro em pedaços e diz quantos pedaços já
          mediu — um número parcial vem marcado como parcial.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" disabled={Boolean(rodando) || demoEnabled} onClick={() => medir("parcial")}>
          Medir: completar colegiado parcial
        </button>
        <button type="button" className="btn-secondary text-xs" disabled={Boolean(rodando) || demoEnabled} onClick={() => medir("revoto")}>
          Medir: revoto por data corrigida
        </button>
        <button type="button" className="btn-secondary text-xs" disabled={Boolean(rodando) || demoEnabled} onClick={() => medir("ausencias")}>
          Medir: ausências da ARTESP
        </button>
        {rodando ? (
          <button type="button" className="btn-secondary text-xs" onClick={() => { parar.current = true; }}>
            Parar
          </button>
        ) : null}
      </div>
      {progresso ? <p className="text-xs text-text-muted">{progresso}</p> : null}
      {erro ? <p className="text-xs text-error">{erro}</p> : null}

      {parcial ? (
        <div className="rounded-md border border-border p-3 text-xs space-y-1">
          <p className="font-semibold text-text-primary">
            Completar colegiado parcial — {parcial.ligado ? "LIGADO" : "DESLIGADO (só medição)"} · {parcialTexto(parcial)}
          </p>
          <p>
            <strong>{parcial.autorizados}</strong> par(es) deliberação × diretor receberiam voto inferido
            (o preâmbulo nomeia a pessoa) — por agência: {textoPorAgencia(parcial.por_agencia)}.
          </p>
          <p className="text-text-muted">
            <strong>{parcial.barrados}</strong> barrado(s) pelo portão: {textoPorAgencia(parcial.barrados_por_motivo)}.
          </p>
        </div>
      ) : null}

      {revoto ? (
        <div className="rounded-md border border-border p-3 text-xs space-y-1">
          <p className="font-semibold text-text-primary">
            Revoto — {revoto.ligado ? "LIGADO" : "DESLIGADO (só medição)"} · {parcialTexto(revoto as unknown as AcumuladoParcial)}
          </p>
          <p>
            <strong>{revoto.apagariam}</strong> voto(s) INFERIDO(s) de quem não tinha mandato na data sairiam (com
            rastro) — por agência: {textoPorAgencia(revoto.por_agencia)}.
          </p>
          <p>
            <strong>{revoto.roster_suspeito}</strong> voto(s) NOMINAL(is) fora do mandato — <em>nunca</em> apagados:
            indicam que o CADASTRO de mandato está errado.
          </p>
          <p className="text-text-muted">
            {revoto.faltando} par(es) ficariam faltando depois (entrada do &ldquo;completar parcial&rdquo;) · recusas: {textoPorAgencia(revoto.recusas)}.
          </p>
        </div>
      ) : null}

      {ausencias ? (
        <div className="rounded-md border border-border p-3 text-xs space-y-2">
          <p className="font-semibold text-text-primary">
            Ausências da ARTESP — {ausencias.examinadas} de {ausencias.candidatas} deliberações examinadas
            {ausencias.concluido ? " (estoque inteiro)" : " (PARCIAL)"}
          </p>
          <p>
            <strong>{ausencias.a_inserir}</strong> a inserir · <strong>{ausencias.a_promover}</strong> a promover
            (inferida → ausência lida) · {ausencias.ja_corretas} já corretas · {ausencias.nominais_preservadas} nominais
            preservadas{ausencias.gravadas ? ` · ${ausencias.gravadas} GRAVADAS` : ""}.
          </p>
          {Object.keys(ausencias.nao_reconhecidos).length ? (
            <p className="text-warning">
              Nomes que o cadastro não reconhece (não viram linha): {textoPorAgencia(ausencias.nao_reconhecidos)}.
            </p>
          ) : null}
          {ausencias.detalhe.length ? (
            <details>
              <summary className="cursor-pointer">Conferir os trechos contra o PDF ({ausencias.detalhe.length})</summary>
              <ul className="mt-2 space-y-1">
                {ausencias.detalhe.map((d) => (
                  <li key={d.deliberacao_id}>
                    <span className="font-mono">{d.numero_reuniao ?? "?"}ª</span>{" "}
                    {[...d.inserir.map((x) => `+ ${x.nome}: “${x.trecho}”`), ...d.promover.map((x) => `↑ ${x.nome} (era ${x.de ?? "?"}): “${x.trecho}”`)].join(" · ")}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {(ausencias.a_inserir + ausencias.a_promover) > 0 && !ausencias.gravadas ? (
            <button type="button" className="btn-primary text-xs" disabled={Boolean(rodando) || demoEnabled} onClick={() => medir("aplicar")}>
              Aplicar (depois de conferir)
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
