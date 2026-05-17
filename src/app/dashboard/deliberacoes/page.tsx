"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AREAS_REGULATORIAS, cn, formatDate, getAreaRegulatoriaLabel, getMicrotemaLabel } from "@/lib/utils";
import type { DeliberacaoPaginada, Agencia, Deliberacao } from "@/types";
import { Search, Download, ChevronLeft, ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";
import { getLocalDelibs, clearLocalDelibs } from "@/lib/local-store";
import { useDataSyncContext } from "@/components/DataSyncProvider";

const MICROTEMAS = [
  // ARTESP
  "tarifa", "obras", "multa", "contrato", "reequilibrio",
  "fiscalizacao", "seguranca", "ambiental", "desapropriacao",
  "adimplencia", "pessoal", "usuario",
  // ANM
  "lavra", "pesquisa", "licenciamento", "servidao", "cfem",
  "disponibilidade", "recursos",
  // Genérico
  "outros",
];

const ANOS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

export default function DeliberacoesPage() {
  const queryClient = useQueryClient();
  const { sync } = useDataSyncContext();
  const [search, setSearch] = useState("");
  const [agenciaId, setAgenciaId] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [microtema, setMicrotema] = useState<string>("");
  const [areaRegulatoria, setAreaRegulatoria] = useState<string>("");
  const [resultado, setResultado] = useState<string>("");
  const [pautaExterna, setPautaExterna] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (agenciaId) params.set("agencia_id", agenciaId);
  if (year) params.set("year", year);
  if (microtema) params.set("microtema", microtema);
  if (areaRegulatoria) params.set("area_regulatoria", areaRegulatoria);
  if (resultado) params.set("resultado", resultado);
  if (pautaExterna) params.set("pauta_interna", "false");
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  params.set("page", String(page));
  params.set("limit", "50");

  const { data, isLoading } = useQuery({
    queryKey: ["deliberacoes", params.toString()],
    queryFn: () => api.get<DeliberacaoPaginada>(`/deliberacoes?${params.toString()}`),
    placeholderData: (prev) => prev,
  });

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const [localDelibs, setLocalDelibs] = useState<Deliberacao[]>([]);
  useEffect(() => { setLocalDelibs(getLocalDelibs()); }, []);

  // Merge: localStorage items first (recently uploaded), then API items (dedup by id)
  const allDelibs = useMemo(() => {
    const apiIds = new Set((data?.data ?? []).map((d) => d.id));
    return [
      ...localDelibs.filter((d) => !apiIds.has(d.id)),
      ...(data?.data ?? []),
    ];
  }, [data, localDelibs]);

  const localOnlyCount = useMemo(() => {
    const apiIds = new Set((data?.data ?? []).map((d) => d.id));
    return localDelibs.filter((d) => !apiIds.has(d.id)).length;
  }, [data, localDelibs]);

  const totalCount = (data?.total ?? 0) + localOnlyCount;

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleExport = () => {
    const exportParams = new URLSearchParams(params);
    exportParams.delete("page");
    exportParams.delete("limit");
    window.location.href = `/api/v1/deliberacoes/export?${exportParams.toString()}`;
  };

  async function handleClearTestData() {
    if (!window.confirm("Excluir todas as deliberações locais de teste?")) return;
    clearLocalDelibs();
    setLocalDelibs([]);
    await sync("local");
    queryClient.invalidateQueries();
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <ModuleTabs tabs={DELIBERACOES_TABS} />
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-text-primary">Deliberações</h1>
            <HelpTooltip text="Lista de todas as deliberações extraídas. Use filtros para encontrar por agência, ano, microtema ou resultado." />
          </div>
          <p className="text-sm text-text-muted mt-0.5">
            {totalCount > 0
              ? `${totalCount.toLocaleString("pt-BR")} deliberações encontradas`
              : data ? "Nenhuma deliberação encontrada" : "Buscando..."}
            {localOnlyCount > 0 && (
              <span className="ml-1 text-brand font-mono">({localOnlyCount} local)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-xs text-error border-error/30 hover:bg-error/10 flex items-center gap-1.5"
            onClick={handleClearTestData}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Excluir tudo do teste
          </button>
          <button onClick={handleExport} className="btn-secondary gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Busca global */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-label" />
            <input
              className="input pl-9"
              placeholder="Busca global (processo, interessado...)"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          {/* Agência */}
          <select
            className="select w-40"
            value={agenciaId}
            onChange={(e) => { setAgenciaId(e.target.value); setPage(1); }}
          >
            <option value="">Todas as agências</option>
            {(agencias ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.sigla}</option>
            ))}
          </select>

          {/* Ano */}
          <select
            className="select w-28"
            value={year}
            onChange={(e) => { setYear(e.target.value); setPage(1); }}
          >
            <option value="">Todos os anos</option>
            {ANOS.map((a) => (
              <option key={a} value={String(a)}>{a}</option>
            ))}
          </select>

          {/* Microtema */}
          <select
            className="select w-36"
            value={microtema}
            onChange={(e) => { setMicrotema(e.target.value); setPage(1); }}
          >
            <option value="">Todos os microtemas</option>
            {MICROTEMAS.map((m) => (
              <option key={m} value={m}>{getMicrotemaLabel(m)}</option>
            ))}
          </select>

          <select
            className="select w-44"
            value={areaRegulatoria}
            onChange={(e) => { setAreaRegulatoria(e.target.value); setPage(1); }}
          >
            <option value="">Todas as áreas</option>
            {AREAS_REGULATORIAS.map((area) => (
              <option key={area} value={area}>{getAreaRegulatoriaLabel(area)}</option>
            ))}
          </select>

          {/* Resultado */}
          <select
            className="select w-36"
            value={resultado}
            onChange={(e) => { setResultado(e.target.value); setPage(1); }}
          >
            <option value="">Todas as decisões</option>
            <option value="Deferido">Deferido</option>
            <option value="Indeferido">Indeferido</option>
          </select>
        </div>

        {/* Filtros de data */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-text-label font-mono uppercase tracking-wider">Período:</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="input w-36 text-xs font-mono"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              placeholder="De"
            />
            <span className="text-text-muted text-xs">até</span>
            <input
              type="date"
              className="input w-36 text-xs font-mono"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              placeholder="Até"
            />
            {(dateFrom || dateTo) && (
              <button
                className="text-xs text-text-muted hover:text-brand transition-colors"
                onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Pauta externa toggle */}
        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <div
            onClick={() => { setPautaExterna((v) => !v); setPage(1); }}
            className={cn(
              "w-9 h-5 rounded-full transition-colors duration-200 relative",
              pautaExterna ? "bg-brand" : "bg-bg-hover"
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
              pautaExterna ? "translate-x-4" : "translate-x-0.5"
            )} />
          </div>
          <span className="text-sm text-text-secondary">Mostrar apenas pauta externa</span>
        </label>
      </div>

      {/* Tabela */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Agência", "Reunião", "Data", "Interessado", "Microtema", "Resumo", ""].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-label text-text-muted font-mono whitespace-nowrap"
                  >
                    {h.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-text-muted text-sm">
                    Carregando deliberações...
                  </td>
                </tr>
              ) : allDelibs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-text-muted text-sm">
                    Nenhuma deliberação encontrada
                  </td>
                </tr>
              ) : (
                allDelibs.map((d) => {
                  const isUnanimous =
                    Array.isArray(d.votos) &&
                    d.votos.length > 0 &&
                    d.votos.every((v) => v.tipo_voto === "Favoravel");
                  const resultadoPositivo =
                    d.resultado === "Deferido" ||
                    d.resultado === "Aprovado" ||
                    d.resultado === "Aprovado por Unanimidade" ||
                    d.resultado === "Ratificado" ||
                    d.resultado === "Autorizado" ||
                    d.resultado === "Recomendado" ||
                    d.resultado === "Determinado" ||
                    d.resultado === "Aprovado com Ressalvas";

                  return (
                    <tr
                      key={d.id}
                      className="border-b border-border/50 hover:bg-bg-hover transition-colors"
                    >
                      {/* Agência */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {d.agencia ? (
                          <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold bg-brand/15 text-brand border border-brand/25">
                            {d.agencia.sigla}
                          </span>
                        ) : (
                          <span className="text-text-muted text-xs font-mono">—</span>
                        )}
                      </td>
                      {/* Reunião / Nº deliberação */}
                      <td className="px-4 py-3 font-mono text-xs text-text-secondary whitespace-nowrap">
                        {d.numero_deliberacao ?? "—"}
                      </td>
                      {/* Data */}
                      <td className="px-4 py-3 font-mono text-xs text-text-secondary whitespace-nowrap">
                        {formatDate(d.data_reuniao)}
                      </td>
                      {/* Interessado */}
                      <td className="px-4 py-3 text-sm text-text-primary max-w-[200px] truncate">
                        {d.interessado ?? "—"}
                      </td>
                      {/* Microtema */}
                      <td className="px-4 py-3">
                        {d.microtema ? (
                          <span className="badge-orange">
                            {getMicrotemaLabel(d.microtema)}
                          </span>
                        ) : (
                          <span className="text-text-muted text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge badge-gray text-xs">
                          {getAreaRegulatoriaLabel(d.area_regulatoria)}
                        </span>
                      </td>
                      {/* Resumo */}
                      <td className="px-4 py-3 text-xs text-text-muted max-w-[280px]">
                        <span className="line-clamp-2">
                          {d.resumo_pleito ?? "—"}
                        </span>
                      </td>
                      {/* Resultado + ações */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isUnanimous && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 whitespace-nowrap">
                              Unanimidade
                            </span>
                          )}
                          {d.resultado && (
                            <span className={cn(
                              "badge whitespace-nowrap",
                              resultadoPositivo ? "badge-green" :
                              d.resultado === "Indeferido" ? "badge-red" :
                              "text-xs px-2 py-0.5 rounded font-mono bg-zinc-500/15 text-zinc-400 border border-zinc-500/25"
                            )}>
                              {d.resultado}
                            </span>
                          )}
                          <Link
                            href={`/dashboard/deliberacoes/${d.id}`}
                            className="text-text-muted hover:text-brand transition-colors"
                            aria-label="Ver detalhes"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-text-muted font-mono">
              Página {data.page} de {data.pages}
            </p>
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary py-1 px-3 text-xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <button
                className="btn-secondary py-1 px-3 text-xs"
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={page === data.pages}
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
