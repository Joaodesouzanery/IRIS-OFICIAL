"use client";

/**
 * Error boundary do dashboard (etapa65).
 *
 * Não conserta nenhum bug — LIMITA o custo de todos. `api.get<T>` termina em
 * `res.json() as Promise<T>`, um cast não checado: 69 call-sites declaram array sem nenhuma
 * verificação de forma, e `?? []` não protege (testa `undefined`, não forma — um objeto é truthy).
 * Quando a forma diverge, o `.reduce` lança `TypeError`, e SEM error boundary o erro sobe até a
 * raiz e a rota inteira vira tela branca. Foi exatamente o que aconteceu com a Saúde dos Dados.
 *
 * Com este arquivo, o mesmo defeito passa a mostrar uma tela recuperável, com o erro visível e um
 * botão de retry — e a navegação continua funcionando. É a convenção do App Router; o arquivo
 * simplesmente não existia.
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw, ArrowLeft } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log no console do navegador: o `digest` é o que amarra esta tela ao log do servidor.
    console.error("[dashboard] erro não tratado:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-bg-card p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text-primary">
              Não foi possível carregar esta tela
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              O restante do painel continua funcionando. Se o erro persistir, o dado desta tela
              provavelmente está num formato que ela não espera.
            </p>
          </div>
        </div>

        <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-bg-base p-3 font-mono text-xs text-text-secondary">
          {error.message || "Erro desconhecido"}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={reset} className="btn btn-primary inline-flex items-center gap-2">
            <RotateCw className="h-4 w-4" aria-hidden />
            Tentar de novo
          </button>
          <Link href="/dashboard" className="btn inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}
