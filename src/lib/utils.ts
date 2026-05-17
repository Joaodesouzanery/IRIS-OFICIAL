import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return dateStr;
  }
}

export function formatDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  } catch {
    return dateStr;
  }
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function getMicrotemaLabel(microtema: string): string {
  const labels: Record<string, string> = {
    tarifa: "Tarifa",
    obras: "Obras",
    multa: "Multa",
    contrato: "Contrato",
    reequilibrio: "Reequilíbrio",
    fiscalizacao: "Fiscalização",
    seguranca: "Segurança",
    ambiental: "Ambiental",
    desapropriacao: "Desapropriação",
    adimplencia: "Adimplência",
    pessoal: "Pessoal",
    usuario: "Usuário",
    outros: "Outros",
  };
  return labels[microtema] ?? microtema;
}

export function getMicrotemaColor(microtema: string): string {
  const colors: Record<string, string> = {
    tarifa: "#f97316",
    obras: "#3b82f6",
    multa: "#ef4444",
    contrato: "#8b5cf6",
    reequilibrio: "#06b6d4",
    fiscalizacao: "#10b981",
    seguranca: "#f59e0b",
    ambiental: "#22c55e",
    desapropriacao: "#ec4899",
    adimplencia: "#0ea5e9",
    pessoal: "#a855f7",
    usuario: "#6366f1",
    outros: "#71717a",
  };
  return colors[microtema] ?? "#71717a";
}

export const CATEGORIAS_REGULATORIAS = [
  { id: "economico-financeiro",    label: "Econômico-Financeiro",      microtemas: ["tarifa", "reequilibrio"] as string[] },
  { id: "contratos-concessoes",    label: "Contratos e Concessões",    microtemas: ["contrato", "obras"] as string[] },
  { id: "controle-sancoes",        label: "Controle e Sanções",        microtemas: ["multa", "fiscalizacao", "adimplencia"] as string[] },
  { id: "seguranca-ambiente",      label: "Segurança e Ambiente",      microtemas: ["seguranca", "ambiental"] as string[] },
  { id: "usuarios-administrativo", label: "Usuários e Administrativo", microtemas: ["usuario", "desapropriacao", "pessoal", "outros"] as string[] },
];

export function getMicrotemaCategoria(microtema: string): string {
  return CATEGORIAS_REGULATORIAS.find((c) => c.microtemas.includes(microtema))?.id
    ?? "usuarios-administrativo";
}

export function getMicrotemaCategoriaLabel(microtema: string): string {
  return CATEGORIAS_REGULATORIAS.find((c) => c.microtemas.includes(microtema))?.label
    ?? "Usuários e Administrativo";
}

export function getAreaRegulatoriaLabel(area: string | null | undefined): string {
  const labels: Record<string, string> = {
    rodovia: "Rodovia",
    ferrovia: "Ferrovia",
    rodoviario_passageiros: "Rodoviário de passageiros",
    cargas_logistica: "Cargas e logística",
    infraestrutura_geral: "Infraestrutura geral",
    governanca_regulatoria: "Governança regulatória",
    administrativo: "Administrativo",
    outros: "Outros",
  };
  return area ? labels[area] ?? area : "Outros";
}

export const AREAS_REGULATORIAS = [
  "rodovia",
  "ferrovia",
  "rodoviario_passageiros",
  "cargas_logistica",
  "infraestrutura_geral",
  "governanca_regulatoria",
  "administrativo",
  "outros",
] as const;
