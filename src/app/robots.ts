import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://irisregulacao.org";

/**
 * `robots.txt` — Fase 32.
 *
 * ⚠️ O caminho `/robots.txt` já estava na allowlist do middleware desde sempre, mas o ARQUIVO nunca
 * existiu: a rota estava reservada para algo que não foi feito. Agora existe.
 *
 * A regra é a fronteira real do produto: a landing é para ser encontrada; a plataforma e a API não.
 * O `disallow` aqui é sinalização para robô educado, não segurança — quem protege `/dashboard` é o
 * middleware, e quem protege `/api/v1` são os guards.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/api/", "/login", "/setup-owner"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
