export type MandatoStatus = "ativo" | "vencendo_em_breve" | "vencido" | "indeterminado";

export interface MandatoCalculado {
  percentualConcluido: number | null;
  diasRestantes: number | null;
  status: MandatoStatus;
  texto: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function calcularMandato(dataPosse?: string | Date | null, dataFimMandato?: string | Date | null): MandatoCalculado {
  const inicio = parseDate(dataPosse);
  const fim = parseDate(dataFimMandato);

  if (!inicio || !fim || fim.getTime() <= inicio.getTime()) {
    return {
      percentualConcluido: null,
      diasRestantes: null,
      status: "indeterminado",
      texto: "Mandato sem data final confirmada",
    };
  }

  const hoje = startOfDay(new Date());
  const totalDias = Math.max(1, Math.ceil((fim.getTime() - inicio.getTime()) / DAY_MS));
  const diasCorridos = Math.max(0, Math.ceil((hoje.getTime() - inicio.getTime()) / DAY_MS));
  const diasRestantes = Math.ceil((fim.getTime() - hoje.getTime()) / DAY_MS);
  const percentualConcluido = clamp(Math.round((diasCorridos / totalDias) * 10000) / 100, 0, 100);
  const status: MandatoStatus = diasRestantes < 0
    ? "vencido"
    : diasRestantes < 90
      ? "vencendo_em_breve"
      : "ativo";

  return {
    percentualConcluido,
    diasRestantes,
    status,
    texto: `${formatPercent(percentualConcluido)} concluído - ${formatRemainingDays(diasRestantes)}`,
  };
}

function parseDate(value?: string | Date | null) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfDay(parsed);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatRemainingDays(days: number) {
  if (days < 0) return "mandato vencido";
  if (days === 0) return "vence hoje";
  if (days === 1) return "1 dia restante";
  return `${days} dias restantes`;
}
