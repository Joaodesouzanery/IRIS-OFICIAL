import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://irisregulacao.org";

/**
 * `sitemap.xml` — Fase 32.
 *
 * ⚠️ Só a landing entra. Não listo `/dashboard` nem as ~138 rotas de API: sitemap é um convite para
 * indexar, e convidar robô para porta que exige sessão só gera 302 em série e ruído no relatório de
 * cobertura do Search Console.
 *
 * `lastModified` sai da data do build. Datar com `new Date()` a cada requisição faria o sitemap
 * afirmar que a página mudou quando nada mudou — e um sinal que sempre diz "mudou" é um sinal que
 * não diz nada.
 */
const BUILD = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE, lastModified: BUILD, changeFrequency: "monthly", priority: 1 }];
}
