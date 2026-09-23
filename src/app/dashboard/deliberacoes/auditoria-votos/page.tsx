"use client";

/**
 * Auditoria de votos — UMA LINHA POR VOTO, com o PDF ao lado.
 *
 * ═══ Por que esta tela existe ═══
 * O operador pediu: "eu não quero as deliberações em si, eu quero os votos de cada diretor" e
 * "seria possível visualizar de maneira simples qual foi o voto de X diretor naquela
 * deliberação?". É esta tela, e não um número, que responde "como sei que são confiáveis": cada
 * linha traz o documento de origem para conferir.
 *
 * ⚠️ O padrão de tabela/filtro/paginação é copiado de `dashboard/deliberacoes/page.tsx`. Não há
 * componente de tabela no repo (`src/components/ui/` tem dois arquivos); o padrão é Tailwind puro.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import type { Agencia } from "@/types";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Shuffle, X } from "lucide-react";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";

const ANOS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const TIPOS = ["Favoravel", "Desfavoravel", "Abstencao", "Ausente"] as const;

/** Os rótulos de `motivo_nao_voto`. Até a Fase 29 NADA no dashboard lia este campo. */
const MOTIVO_LABEL: Record<string, string> = {
  ausencia: "ausência",
  impedimento: "impedimento",
  suspeicao: "suspeição",
  vista: "vista",
  sobrestamento: "sobrestamento",
  vacancia: "vacância",
};

type LinhaDeVoto = {
  agencia: string | null;
  numero_reuniao: string | null;
  tipo_reuniao: string | null;
  numero_deliberacao: string | null;
  data_reuniao: string | null;
  microtema: string | null;
  resultado: string | null;
  diretor: string | null;
  tipo_voto: string | null;
  origem: "lido" | "inferido";
  proveniencia: string | null;
  is_divergente: boolean | null;
  motivo_nao_voto: string | null;
  voto_em_autos: boolean | null;
  colegiado_esperado: number | null;
  votos_na_deliberacao: number | null;
  pdf_arquivo: string | null;
  pdf_url: string | null;
  deliberacao_id: string;
  voto_id: string;
  roster_conhecido: boolean;
  faltando: number;
};
type Resposta = { linhas: LinhaDeVoto[]; total: number; page: number; limit: number; pages: number; notice?: string };
type GrupoDaAmostra = {
  agencia: string; linhas: LinhaDeVoto[]; universo: number;
  cotas_sem_exemplar: string[]; cotas_fora_do_tamanho: string[];
};
type RespostaAmostra = { amostra: GrupoDaAmostra[]; universo_total: number; truncado: boolean; notice?: string };
/** Rótulos pt-BR das cotas — a tela não repete a lista do módulo, só a traduz. */
const COTA_LABEL: Record<string, string> = {
  ausencia_ou_impedimento: "ausência/impedimento",
  divergencia_nominal: "divergência nominal",
  fonte_voto_individual: "voto individual",
  fonte_deliberacao: "deliberação",
  fonte_ata: "ata",
  desfecho_indeferido: "indeferido",
  desfecho_deferido: "deferido",
  origem_lido: "lido",
  origem_inferido: "inferido",
};
type DiretorLeve = { id: string; nome: string };

function badgeDoVoto(tipo: string | null): string {
  if (tipo === "Favoravel") return "badge-green";
  if (tipo === "Desfavoravel") return "badge-red";
  if (tipo === "Abstencao") return "badge-orange";
  return "badge-gray";
}

const COLSPAN = 9;

export default function AuditoriaVotosPage() {
  const { demoEnabled } = useDataSyncContext();
  const [agenciaId, setAgenciaId] = useState("");
  const [diretorId, setDiretorId] = useState("");
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [tipoVoto, setTipoVoto] = useState("");
  const [origem, setOrigem] = useState("");
  const [soDivergentes, setSoDivergentes] = useState(false);
  const [numeroReuniao, setNumeroReuniao] = useState("");
  const [page, setPage] = useState(1);
  const [baixando, setBaixando] = useState(false);
  const [amostrando, setAmostrando] = useState(false);
  const [amostra, setAmostra] = useState<RespostaAmostra | null>(null);

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias").then(listaDe<Agencia>).catch(() => [] as Agencia[]),
  });
  const { data: diretores } = useQuery({
    queryKey: ["diretores-auditoria", agenciaId],
    queryFn: () => api
      .get<DiretorLeve[]>(`/diretores${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)
      .then(listaDe<DiretorLeve>)
      .catch(() => [] as DiretorLeve[]),
  });

  /** Uma fonte para os filtros: a tela e o CSV mandam exatamente os mesmos parâmetros. */
  function parametros(paraCsv = false): URLSearchParams {
    const qs = new URLSearchParams();
    if (agenciaId) qs.set("agencia_id", agenciaId);
    if (diretorId) qs.set("diretor_id", diretorId);
    if (ano) qs.set("ano", ano);
    if (numeroReuniao.trim()) qs.set("numero_reuniao", numeroReuniao.trim());
    if (tipoVoto) qs.set("tipo_voto", tipoVoto);
    if (origem) qs.set("origem", origem);
    if (soDivergentes) qs.set("divergente", "1");
    if (paraCsv) qs.set("format", "csv");
    else { qs.set("page", String(page)); qs.set("limit", "50"); }
    return qs;
  }

  const filtrosDaBusca = [agenciaId, diretorId, ano, numeroReuniao, tipoVoto, origem, soDivergentes, page] as const;
  const { data, isLoading, error } = useQuery({
    queryKey: ["auditoria-votos", ...filtrosDaBusca],
    queryFn: () => api.get<Resposta>(`/admin/auditoria/votos?${parametros().toString()}`),
  });

  /** Um filtro novo recomeça da página 1 — senão a tela mostra "nada" que na verdade é a pág. 7. */
  function aoFiltrar<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  /**
   * A amostra ESTRATIFICADA: 5 por agência cobrindo o espaço (impedimento, divergência nominal,
   * as três fontes, deferido/indeferido, lido/inferido) em vez de 5 linhas do caso médio.
   *
   * ⚠️ Ela respeita os filtros da tela — amostrar "tudo" quando o revisor está olhando uma reunião
   * específica devolveria linhas que ele não pediu. E o universo é lido inteiro no servidor, não a
   * página: escolher 5 entre os 50 visíveis seria "os 5 mais recentes" com nome de amostra.
   */
  async function amostrarEstratificada() {
    if (demoEnabled || amostrando) return;
    setAmostrando(true);
    try {
      const qs = parametros();
      qs.delete("page"); qs.delete("limit");
      qs.set("amostra", "1");
      setAmostra(await api.get<RespostaAmostra>(`/admin/auditoria/votos?${qs.toString()}`));
    } catch {
      setAmostra(null);
    } finally {
      setAmostrando(false);
    }
  }

  /**
   * ⚠️ O CSV é baixado por fetch AUTENTICADO + blob, nunca `window.location.href`: o middleware
   * exige header `Bearer` em toda rota de /api/v1, e um link direto devolveria "Login obrigatório"
   * em vez do arquivo. (É o defeito vivo de `deliberacoes/page.tsx`, registrado em PENDENCIAS.)
   */
  async function baixarCsv() {
    if (demoEnabled || baixando) return;
    setBaixando(true);
    try {
      let token: string | null = null;
      try {
        const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
        const { data: sessao } = await createSupabaseBrowserClient().auth.getSession();
        token = sessao.session?.access_token ?? null;
      } catch { token = null; }
      const res = await fetch(`/api/v1/admin/auditoria/votos?${parametros(true).toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `iris-auditoria-votos-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch {
      window.alert("Não foi possível exportar agora. Tente de novo.");
    } finally {
      setBaixando(false);
    }
  }

  const linhas = data?.linhas ?? [];
  const nomeDoDiretor = (diretores ?? []).find((d) => d.id === diretorId)?.nome ?? "";

  return (
    <div className="space-y-4">
      <ModuleTabs tabs={DELIBERACOES_TABS} />

      <div>
        <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
          Auditoria de votos
          <HelpTooltip text="Uma linha por VOTO. «Lido» = extraído do documento; «Inferido» = completado por unanimidade ou mandato. Abra o PDF ao lado para conferir." />
        </h1>
        <p className="text-sm text-text-secondary">
          Cada linha é o voto de um diretor numa deliberação, com o documento de origem ao lado.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <select className="select w-40" value={agenciaId}
          onChange={(e) => { aoFiltrar(setAgenciaId)(e.target.value); setDiretorId(""); }}>
          <option value="">Todas as agências</option>
          {(agencias ?? []).map((a) => <option key={a.id} value={a.id}>{a.sigla}</option>)}
        </select>

        <select className="select w-56" value={diretorId} onChange={(e) => aoFiltrar(setDiretorId)(e.target.value)}>
          <option value="">Todos os diretores</option>
          {(diretores ?? []).map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
        </select>

        <select className="select w-28" value={ano} onChange={(e) => aoFiltrar(setAno)(e.target.value)}>
          <option value="">Todos os anos</option>
          {ANOS.map((a) => <option key={a} value={String(a)}>{a}</option>)}
        </select>

        {/* ⚠️ Filtra por `numero_reuniao`, não por `reuniao_id`: o vínculo só é gravado quando há
            data (`reunioes.ts:75`), e filtrar pela FK esconderia as deliberações sem data. */}
        <input
          className="input w-40" type="text" inputMode="text" maxLength={20}
          placeholder="Reunião (ex.: 83)"
          value={numeroReuniao}
          onChange={(e) => aoFiltrar(setNumeroReuniao)(e.target.value)}
        />

        <select className="select w-36" value={tipoVoto} onChange={(e) => aoFiltrar(setTipoVoto)(e.target.value)}>
          <option value="">Todos os votos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <select className="select w-36" value={origem} onChange={(e) => aoFiltrar(setOrigem)(e.target.value)}>
          <option value="">Lido e inferido</option>
          <option value="lido">Só lido</option>
          <option value="inferido">Só inferido</option>
        </select>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="accent-accent" checked={soDivergentes}
            onChange={(e) => aoFiltrar(setSoDivergentes)(e.target.checked)} />
          <span className="text-sm text-text-secondary">Só divergentes</span>
        </label>

        <button className="btn-secondary gap-1.5 ml-auto" onClick={amostrarEstratificada}
          disabled={demoEnabled || amostrando}>
          <Shuffle className="w-3.5 h-3.5" />
          {amostrando ? "Montando…" : "Amostra estratificada"}
        </button>

        <button className="btn-secondary gap-1.5" onClick={baixarCsv} disabled={demoEnabled || baixando}>
          <Download className="w-3.5 h-3.5" />
          {baixando ? "Exportando…" : "Exportar CSV"}
        </button>
      </div>

      <p className="text-xs text-text-muted">
        <strong>lido</strong> = voto extraído do documento · <strong>inferido</strong> = completado
        por unanimidade ou mandato (proxy) · <strong>«N de M»</strong> compara quem votou com quem
        tinha mandato naquela data; sem mandato conhecido a coluna fica vazia, nunca «completo».
      </p>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
      {amostra ? (
        <div className="card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Amostra estratificada · {amostra.universo_total.toLocaleString("pt-BR")} voto(s) no universo filtrado
              </h2>
              <p className="text-xs text-text-muted mt-0.5">{amostra.notice}</p>
            </div>
            <button className="btn-ghost p-1" onClick={() => setAmostra(null)} aria-label="Fechar amostra">
              <X className="w-4 h-4" />
            </button>
          </div>

          {amostra.truncado ? (
            <p className="text-xs text-warning">
              ⚠️ A leitura do universo truncou — a amostra saiu de uma parte dele, não do todo.
            </p>
          ) : null}

          {amostra.amostra.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhum voto com estes filtros para amostrar.</p>
          ) : amostra.amostra.map((g) => (
            <div key={g.agencia} className="space-y-1.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-semibold text-text-primary">{g.agencia}</span>
                <span className="text-xs text-text-muted">
                  {g.linhas.length} de {g.universo.toLocaleString("pt-BR")}
                </span>
                {/* ⚠️ Os dois baldes são diferentes e a tela NÃO os funde: "não existe" é achado
                    sobre o dado; "não coube" é parâmetro da amostra. */}
                {g.cotas_sem_exemplar.length ? (
                  <span className="text-xs text-text-muted">
                    · sem nenhum caso de: {g.cotas_sem_exemplar.map((c) => COTA_LABEL[c] ?? c).join(", ")}
                  </span>
                ) : null}
                {g.cotas_fora_do_tamanho.length ? (
                  <span className="text-xs text-warning">
                    · existe mas não coube: {g.cotas_fora_do_tamanho.map((c) => COTA_LABEL[c] ?? c).join(", ")}
                  </span>
                ) : null}
              </div>
              <ul className="space-y-1">
                {g.linhas.map((l) => (
                  <li key={l.voto_id} className="text-xs text-text-secondary flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-text-muted">{l.numero_reuniao ?? "—"}</span>
                    <span>{l.numero_deliberacao ?? "—"}</span>
                    <span className="text-text-muted">·</span>
                    <span>{l.diretor ?? "—"}</span>
                    <span className={cn("badge", badgeDoVoto(l.tipo_voto))}>
                      {l.tipo_voto ?? "—"}{l.motivo_nao_voto ? ` · ${l.motivo_nao_voto}` : ""}
                    </span>
                    <span className={cn("badge", l.origem === "lido" ? "badge-green" : "badge-gray")}>{l.origem}</span>
                    {l.is_divergente ? <span className="badge badge-orange">div.</span> : null}
                    {l.pdf_url ? (
                      <a href={l.pdf_url} target="_blank" rel="noopener noreferrer"
                         className="text-accent hover:underline inline-flex items-center gap-1">
                        PDF <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["DIRETOR", "AGÊNCIA", "REUNIÃO", "DATA", "DELIBERAÇÃO", "RESULTADO", "VOTO", "COLEGIADO", "PDF"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-label text-text-muted font-mono whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center text-error text-sm">
                  Não foi possível carregar os votos agora.
                </td></tr>
              ) : isLoading ? (
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center text-text-muted text-sm">
                  Carregando votos…
                </td></tr>
              ) : linhas.length === 0 ? (
                /* ⚠️ Tabela em branco numa ferramenta de auditoria lê como "o sistema perdeu os
                   votos" — que é exatamente o medo do operador. O vazio diz POR QUÊ. */
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center text-text-muted text-sm">
                  {nomeDoDiretor
                    ? `Nenhum voto de ${nomeDoDiretor}${ano ? ` em ${ano}` : ""} com estes filtros. Isso pode ser o mandato: confira o período em Mandatos.`
                    : "Nenhum voto com estes filtros."}
                </td></tr>
              ) : (
                linhas.map((l) => (
                  <tr key={l.voto_id} className="border-b border-border last:border-0 hover:bg-bg-hover/40">
                    <td className="px-4 py-3 text-sm text-text-primary whitespace-nowrap">{l.diretor ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{l.agencia ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap"
                        title={l.tipo_reuniao ?? undefined}>{l.numero_reuniao ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">{formatDate(l.data_reuniao)}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary max-w-56 truncate" title={l.microtema ?? undefined}>
                      {l.numero_deliberacao ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{l.resultado ?? "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn("badge", badgeDoVoto(l.tipo_voto))}>
                        {l.tipo_voto ?? "—"}
                        {l.motivo_nao_voto ? ` · ${MOTIVO_LABEL[l.motivo_nao_voto] ?? l.motivo_nao_voto}` : ""}
                      </span>
                      <span className={cn("badge ml-1.5", l.origem === "lido" ? "badge-green" : "badge-gray")}>
                        {l.origem}
                      </span>
                      {l.is_divergente ? <span className="badge badge-orange ml-1.5">div.</span> : null}
                      {l.voto_em_autos ? (
                        <span className="badge badge-gray ml-1.5" title="Voto proferido em sessão anterior">em autos</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {l.roster_conhecido && l.colegiado_esperado !== null ? (
                        <span className={cn(
                          "font-mono text-xs",
                          (l.votos_na_deliberacao ?? 0) < l.colegiado_esperado ? "text-warning" : "text-text-muted",
                        )} title={l.faltando > 0 ? `${l.faltando} diretor(es) com mandato nesta data sem voto nesta deliberação` : undefined}>
                          {l.votos_na_deliberacao ?? 0} de {l.colegiado_esperado}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted" title="Não há mandato cadastrado cobrindo esta data — não dá para dizer quantos deveriam votar">
                          roster desconhecido
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {l.pdf_url ? (
                        <a href={l.pdf_url} target="_blank" rel="noopener noreferrer"
                          className="text-accent hover:underline inline-flex items-center gap-1"
                          title={l.pdf_arquivo ?? undefined}>
                          PDF <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-text-muted">sem PDF</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-text-muted font-mono">
              Página {data.page} de {data.pages} · {data.total} voto(s)
            </p>
            <div className="flex items-center gap-2">
              <button className="btn-secondary py-1 px-3 text-xs" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-3 h-3" />
              </button>
              <button className="btn-secondary py-1 px-3 text-xs" onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page === data.pages}>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
