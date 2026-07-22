import { describe, it, expect } from "vitest";
import { parseMonitoringHtml } from "@/lib/server/monitoring";

// PR-N (QA jul/2026): a ANM (gov.br Volto) tinha 0 deliberações porque o crawler aceitava QUALQUER
// .pdf → coletava só os MANUAIS do rodapé (manual-de-vistas-anm.pdf, sistema…pdf) como documento,
// e as atas reais (sei_*_ata_85_*.pdf, que SÃO links estáticos) se perdiam no ruído. O filtro
// descarta PDF de seção genérica sem rótulo de reunião e mantém as atas.

const BASE = "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop";

const HTML = `
<html><body>
  <main>
    <a href="https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop/sei_19975061_ata_85__reuniao_ordinaria_publica_da_dirc.pdf">Ata 85ª Reunião Ordinária</a>
    <a href="https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop/ata-32-rep.pdf">Ata 32ª Reunião Extraordinária</a>
  </main>
  <footer>
    <a href="https://www.gov.br/anm/pt-br/assuntos/requerimentos-minerarios/manual-de-vistas-anm.pdf">Manual de Vistas</a>
    <a href="https://www.gov.br/anm/pt-br/acesso-a-informacao/processo-eletronico-sei/dados-minerarios/sistema-de-dados-minerarios-sdm-instrucoes-de-uso.pdf">Sistema SDM</a>
    <a href="https://www.gov.br/anm/pt-br/canais_atendimento/peticionamentos-administrativos/manual-do-peticionamento-administrativo-anm.pdf">Manual do Peticionamento</a>
  </footer>
</body></html>`;

describe("ANM — filtro de manuais do rodapé [PR-N]", () => {
  const items = parseMonitoringHtml(HTML, BASE);
  const urls = items.map((i) => i.url_item);

  it("mantém as ATAS reais (têm 'ata'/'reuniao' no nome)", () => {
    expect(urls.some((u) => u.includes("sei_19975061_ata_85"))).toBe(true);
    expect(urls.some((u) => u.includes("ata-32-rep"))).toBe(true);
  });

  it("descarta os MANUAIS/SISTEMAS do rodapé (seção genérica, sem rótulo de reunião)", () => {
    expect(urls.some((u) => u.includes("manual-de-vistas-anm"))).toBe(false);
    expect(urls.some((u) => u.includes("sistema-de-dados-minerarios"))).toBe(false);
    expect(urls.some((u) => u.includes("manual-do-peticionamento"))).toBe(false);
  });

  it("sobrou só documento de reunião (as 2 atas)", () => {
    expect(items.length).toBe(2);
  });
});
