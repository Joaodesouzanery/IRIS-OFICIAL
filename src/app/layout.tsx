import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://irisregulacao.org";

/**
 * ⚠️ O `robots: "noindex, nofollow"` SAIU daqui — Fase 32.
 *
 * Ele estava no layout RAIZ, logo era herdado por TODA rota. Enquanto `/` era só um `redirect()`
 * isso não custava nada; com uma landing page pública em `/`, significaria uma página construída
 * para ser encontrada e marcada para não ser. Agora ele vive em `src/app/dashboard/layout.tsx`,
 * que é onde "plataforma interna" de fato começa.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "IRIS — Instituto de Regulação, Inovação e Sustentabilidade",
    template: "%s · IRIS",
  },
  description:
    "Instituto de Regulação, Inovação e Sustentabilidade: estudo, análise e aprimoramento da " +
    "regulação no Brasil, com acompanhamento das agências reguladoras federais.",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "IRIS",
    title: "IRIS — Instituto de Regulação, Inovação e Sustentabilidade",
    description:
      "Acompanhamento regulatório das agências federais: deliberações, votos de diretores e " +
      "qualidade regulatória.",
    url: SITE,
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="bg-bg-base text-text-primary antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
