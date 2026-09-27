import { ImageResponse } from "next/og";

/**
 * Imagem de compartilhamento (Open Graph / Twitter) — Fase 32.
 *
 * ⚠️ `next/og` JÁ VEM no Next 15 — não é dependência nova. A alternativa seria um PNG estático, que
 * eu não teria como desenhar, ou `@vercel/og`, que seria instalar o que já está instalado.
 *
 * Navy + dourado, a mesma identidade da página. Sem foto: OG é lido em miniatura no WhatsApp e no
 * LinkedIn, onde fotografia vira borrão e só o contraste alto sobrevive.
 */
export const alt = "IRIS — Instituto de Regulação, Inovação e Sustentabilidade";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0e2a",
          padding: "72px",
          // Um brilho dourado no canto, o mesmo gesto da capa do deck institucional.
          backgroundImage:
            "radial-gradient(70% 90% at 12% 0%, rgba(194,162,74,0.20), transparent 60%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 52, height: 3, background: "#c2a24a" }} />
          <div
            style={{
              color: "#c2a24a",
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Instituto de Regulação, Inovação e Sustentabilidade
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ color: "#ffffff", fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
            A regulação brasileira,
          </div>
          <div style={{ color: "#c2a24a", fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
            acompanhada de perto.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid rgba(194,162,74,0.28)",
            paddingTop: 28,
            color: "rgba(255,255,255,0.62)",
            fontSize: 26,
          }}
        >
          <div>12 agências reguladoras federais</div>
          <div style={{ color: "#c2a24a" }}>irisregulacao.org</div>
        </div>
      </div>
    ),
    size,
  );
}
