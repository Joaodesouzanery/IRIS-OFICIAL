import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { DemoBanner } from "@/components/DemoBanner";
import { DataSyncProvider } from "@/components/DataSyncProvider";
import type { Metadata } from "next";

/**
 * ⚠️ O `noindex` mora AQUI, e não na raiz — Fase 32.
 *
 * Ele estava no layout raiz e era herdado por tudo. A partir daqui é plataforma autenticada: não há
 * o que indexar, e o middleware já redireciona quem não tem sessão. A landing pública em `/` fica
 * livre para ser encontrada.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DataSyncProvider>
      <div className="flex min-h-screen bg-bg-base">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <DemoBanner />
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </DataSyncProvider>
  );
}
