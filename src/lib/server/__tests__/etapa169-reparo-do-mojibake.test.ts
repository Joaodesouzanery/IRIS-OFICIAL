/**
 * Etapa 169 (Fase 31, Bloco 2) — o reparo dos 623 nomes, medido antes de escrever.
 *
 * ═══ Por que este reparo precisa de mais cuidado que o normal ═══
 * O mesmo `latin1 → cp850` que conserta `"DELIBERAÇO ARTESP N§ 646"` **DESTRÓI** um nome sadio:
 * `"DELIBERAÇÃO"` viraria `"DELIBERAÃ├O"`. Aplicado sem guarda, o conserto corromperia os 2.103
 * nomes que estão certos — trocaria um defeito cosmético por dano real.
 *
 * Três travas, e este arquivo mede as três:
 *  1. **a guarda de plausibilidade** (`reparoDoNome`, etapa168) — só repara quando a nota SOBE;
 *  2. **o escopo por procedência** — só quem veio de ZIP. O mojibake conhecido é 100% ARTESP/ZIP;
 *     ANM e ANTT recebem nome por outros caminhos, e varrer as três arriscaria "reparar" nome
 *     legítimo. Candidato fora do escopo é MOSTRADO e não tocado — é achado novo, não caso conhecido;
 *  3. **o dry-run por default** — só `?dry_run=0` escreve, mesmo contrato de `redatar`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => globalThis.__mojiDb }));
vi.mock("@/lib/server/is-demo", () => ({ isDemo: () => false }));
vi.mock("@/lib/server/request-guards", () => ({
  isDemoRequest: () => false,
  requireAdmin: async () => null,
}));

declare global { var __mojiDb: unknown }

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/v1/admin/documentos/mojibake/route";

/** "DELIBERAÇÃO ARTESP Nº 646" como ficou gravado: bytes CP850 lidos como Latin-1. */
const CORROMPIDO = "DELIBERAÇO ARTESP N§ 646.pdf";
const CORRETO = "DELIBERAÇÃO ARTESP Nº 646.pdf";

type Escrita = { tabela: string; patch: Record<string, unknown>; filtros: Array<[string, unknown]> };

function montarDb(docs: any[]) {
  const escritas: Escrita[] = [];
  const db: any = {
    escritas,
    from(tabela: string) {
      const q: any = {};
      let patch: Record<string, unknown> | null = null;
      let select = "";
      const filtros: Array<[string, unknown]> = [];
      q.select = (s: string) => { select = s; return q; };
      q.update = (p: Record<string, unknown>) => { patch = p; return q; };
      q.eq = (c: string, v: unknown) => { filtros.push([c, v]); return q; };
      q.in = () => q;
      q.order = () => q;
      q.range = () => q;
      q.then = (ok: any, err: any) => {
        if (patch) {
          escritas.push({ tabela, patch, filtros });
          return Promise.resolve({ data: null, error: null }).then(ok, err);
        }
        if (tabela === "agencias") {
          return Promise.resolve({ data: [{ id: "ag-artesp", sigla: "ARTESP" }, { id: "ag-anm", sigla: "ANM" }], error: null }).then(ok, err);
        }
        if (tabela === "documentos_regulatorios" && select.includes("campos_detectados")) {
          return Promise.resolve({
            data: docs.map((d) => ({ id: d.id, campos_detectados: d.campos_detectados ?? null })),
            error: null,
          }).then(ok, err);
        }
        if (tabela === "documentos_regulatorios") {
          return Promise.resolve({ data: docs, error: null }).then(ok, err);
        }
        return Promise.resolve({ data: [], error: null }).then(ok, err);
      };
      return q;
    },
  };
  return db;
}

const DOC_ZIP = {
  id: "d-zip", agencia_id: "ag-artesp", filename: CORROMPIDO,
  source_archive: "Lote 646.zip", metadata: { source_zip_entry: CORROMPIDO, uploaded_via: "monitoramento_deliberacoes", source_url: "https://x" },
  created_at: "2026-09-01T10:00:00Z", semantic_duplicate_key: "artesp|deliberacao|646", tipo_documento: "deliberacao",
  campos_detectados: { preview: { fields: { numero_deliberacao: "646", numero_reuniao: "1210", data_reuniao: "2026-09-02", processo: null } } },
};
/** Mesmo mojibake, mas SEM procedência de ZIP — fora do escopo. */
const DOC_FORA = {
  id: "d-fora", agencia_id: "ag-anm", filename: CORROMPIDO,
  source_archive: null, metadata: {}, created_at: "2026-09-01T10:00:00Z",
  semantic_duplicate_key: null, tipo_documento: "ata", campos_detectados: null,
};
const DOC_SADIO = {
  id: "d-ok", agencia_id: "ag-artesp", filename: "Voto DFQ 043-2026.pdf",
  source_archive: "Lote.zip", metadata: {}, created_at: "2026-09-01T10:00:00Z",
  semantic_duplicate_key: null, tipo_documento: "voto", campos_detectados: null,
};

const url = (qs = "") => `http://localhost/api/v1/admin/documentos/mojibake${qs}`;

beforeEach(() => { globalThis.__mojiDb = undefined; });

describe("etapa169 · o GET mede e não escreve", () => {
  it("⚠️ nenhuma escrita, nunca — dry-run não é parâmetro, é a ausência do verbo", async () => {
    const db = montarDb([DOC_ZIP, DOC_FORA, DOC_SADIO]);
    globalThis.__mojiDb = db;
    const corpo = await (await GET(new NextRequest(url()) as never)).json();
    expect(db.escritas).toHaveLength(0);
    expect(corpo.modo).toBe("medicao");
  });

  it("acha só quem tem reparo — o nome sadio não entra na conta", async () => {
    globalThis.__mojiDb = montarDb([DOC_ZIP, DOC_FORA, DOC_SADIO]);
    const corpo = await (await GET(new NextRequest(url()) as never)).json();
    expect(corpo.universo.documentos_lidos).toBe(3);
    expect(corpo.universo.candidatos, "o nome sadio entrou como candidato").toBe(2);
    expect(corpo.amostra[0].de).toBe(CORROMPIDO);
    expect(corpo.amostra[0].para).toBe(CORRETO);
    expect(corpo.amostra[0].nota_depois).toBeGreaterThan(corpo.amostra[0].nota_antes);
  });

  it("⚠️ o histograma de bytes decide a codepage pelo DADO, sem depender de nenhum ZIP", async () => {
    // `latin1` preserva byte↔codepoint, então a coluna `filename` carrega os bytes originais.
    globalThis.__mojiDb = montarDb([DOC_ZIP]);
    const corpo = await (await GET(new NextRequest(url()) as never)).json();
    expect(corpo.assinaturas.bytes_altos_mais_frequentes["0x80"], "o Ç do CP850").toBeGreaterThan(0);
    expect(corpo.assinaturas.bytes_altos_mais_frequentes["0xA7"], "o º do CP850").toBeGreaterThan(0);
    expect(corpo.assinaturas.cp850_0x80_ou_0xB5).toBeGreaterThan(0);
  });

  it("separa quem veio de ZIP de quem não veio — e nomeia os de fora", async () => {
    globalThis.__mojiDb = montarDb([DOC_ZIP, DOC_FORA]);
    const corpo = await (await GET(new NextRequest(url()) as never)).json();
    expect(corpo.por_agencia.ARTESP).toMatchObject({ candidatos: 1, de_zip: 1, fora_do_escopo: 0 });
    expect(corpo.por_agencia.ANM).toMatchObject({ candidatos: 1, de_zip: 0, fora_do_escopo: 1 });
    expect(corpo.fora_do_escopo.map((f: any) => f.id)).toEqual(["d-fora"]);
  });

  it("a dependência da chave de dedup é MEDIDA com a função real, não adivinhada", async () => {
    globalThis.__mojiDb = montarDb([DOC_ZIP]);
    const corpo = await (await GET(new NextRequest(url()) as never)).json();
    // O documento tem `numero_deliberacao: "646"` → a chave resolve no primeiro ramo e NÃO
    // depende do filename. É exatamente a pergunta que o usuário fez.
    expect(corpo.chave_de_dedup.mediu).toBe(1);
    expect(corpo.chave_de_dedup.mudaria).toBe(0);
  });
});

describe("etapa169 · o POST só escreve com dry_run=0", () => {
  it("⚠️ sem parâmetro nenhum é DRY-RUN — o default não pode escrever", async () => {
    const db = montarDb([DOC_ZIP]);
    globalThis.__mojiDb = db;
    const corpo = await (await POST(new NextRequest(url(), { method: "POST" }) as never)).json();
    expect(corpo.modo).toBe("dry_run");
    expect(db.escritas).toHaveLength(0);
    expect(corpo.aplicado).toBeNull();
  });

  it("dry_run=1 explícito também não escreve", async () => {
    const db = montarDb([DOC_ZIP]);
    globalThis.__mojiDb = db;
    await POST(new NextRequest(url("?dry_run=1"), { method: "POST" }) as never);
    expect(db.escritas).toHaveLength(0);
  });

  it("dry_run=0 escreve — e só no que veio de ZIP", async () => {
    const db = montarDb([DOC_ZIP, DOC_FORA]);
    globalThis.__mojiDb = db;
    const corpo = await (await POST(new NextRequest(url("?dry_run=0"), { method: "POST" }) as never)).json();
    expect(corpo.modo).toBe("aplicado");
    expect(corpo.escopo).toMatchObject({ no_escopo_zip: 1, fora_do_escopo_nao_tocado: 1 });
    const docs = db.escritas.filter((e: Escrita) => e.tabela === "documentos_regulatorios");
    expect(docs).toHaveLength(1);
    expect(docs[0].filtros).toContainEqual(["id", "d-zip"]);
    // ⚠️ O de fora do escopo NÃO pode ter sido tocado.
    expect(db.escritas.some((e: Escrita) => e.filtros.some(([, v]) => v === "d-fora"))).toBe(false);
  });
});

describe("etapa169 · o que o patch pode e não pode conter", () => {
  async function patchDoDocumento() {
    const db = montarDb([DOC_ZIP]);
    globalThis.__mojiDb = db;
    await POST(new NextRequest(url("?dry_run=0"), { method: "POST" }) as never);
    return db.escritas.find((e: Escrita) => e.tabela === "documentos_regulatorios")!.patch;
  }

  it("repara filename, source_archive e a entrada do ZIP", async () => {
    const patch = await patchDoDocumento();
    expect(patch.filename).toBe(CORRETO);
    expect((patch.metadata as any).source_zip_entry).toBe(CORRETO);
  });

  it("⚠️⚠️ o `metadata` é MESCLADO — substituir apagaria o resto do jsonb", async () => {
    // A primeira versão deste laço fazia `patch.metadata = { source_zip_entry: ... }`, o que
    // apagaria `uploaded_via` e `source_url`. Seria trocar um mojibake cosmético por perda de dado.
    const patch = await patchDoDocumento();
    expect((patch.metadata as any).uploaded_via, "a chave sumiu do jsonb").toBe("monitoramento_deliberacoes");
    expect((patch.metadata as any).source_url).toBe("https://x");
  });

  it("⚠️ `semantic_duplicate_key` NUNCA é escrita — a decisão é do usuário, com o número na mão", async () => {
    const patch = await patchDoDocumento();
    expect(Object.keys(patch)).not.toContain("semantic_duplicate_key");
  });

  it("`storage_path` também não — é `agencia/sha256.pdf`, não carrega nome", async () => {
    const patch = await patchDoDocumento();
    expect(Object.keys(patch)).not.toContain("storage_path");
  });

  it("o job correspondente também é reparado, casando pelo nome ANTIGO", async () => {
    const db = montarDb([DOC_ZIP]);
    globalThis.__mojiDb = db;
    await POST(new NextRequest(url("?dry_run=0"), { method: "POST" }) as never);
    const job = db.escritas.find((e: Escrita) => e.tabela === "upload_jobs");
    expect(job, "o nome na fila de upload ficaria corrompido").toBeTruthy();
    expect(job!.patch.filename).toBe(CORRETO);
    // Casar pelo nome antigo evita reescrever um job que já foi corrigido por outro caminho.
    expect(job!.filtros).toContainEqual(["filename", CORROMPIDO]);
  });
});
