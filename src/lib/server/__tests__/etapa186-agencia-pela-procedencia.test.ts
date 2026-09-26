/**
 * Etapa 186 (Fase 31, Bloco 4) — a agência vem da PROCEDÊNCIA, e o beco sem saída fecha.
 *
 * ═══ ⚠️ A medição INVERTEU a ordem de causas que eu escrevi ═══
 * No commit `f9c1026` eu apontei o upload manual de ZIP sem escolher agência como "o caminho mais
 * curto" para os 19 documentos sem agência. A produção respondeu: `storage_em_auto` = **1** e
 * `com_source_url` = **18**. Dezoito dos dezenove vieram da **ESTEIRA**, não do upload manual — e os
 * nomes dizem SEI `134.xxx`, que é da ARTESP.
 *
 * ═══ Por que isso é grave e não cosmético ═══
 * `deliberacoes.agencia_id` é **NOT NULL** (`001_initial_schema.sql`). Documento sem agência
 * **nunca vira deliberação**: fica no acervo sem poder avançar e sem constar em contagem por agência
 * nenhuma. É beco sem saída, e os 19 estão todos `ignored` — arquivados, fora de fila, e não voltam
 * sozinhos.
 *
 * ═══ Três frentes, e nenhuma adivinha agência ═══
 * 1. **Prevenir**: `enqueue-pdfs` passa a resolver item → sítio. `monitoramento_itens.site_id` é
 *    NOT NULL e o sítio é literalmente de onde o documento veio — é procedência, não inferência.
 * 2. **Fechar a porta**: fonte de DOCUMENTO sem agência nasce INATIVA. Não recuso o cadastro (para
 *    fonte `institucional` a agência nula é legítima e há sítios seedados assim); o que muda é que
 *    ela não começa a produzir documentos inertes sozinha.
 * 3. **Reparar os 19**: migration idempotente, pela mesma cadeia de procedência, com o motivo de
 *    quem sobrar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ENQ = semComentarios(ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts"));
const ENQ_BRUTO = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");
const SITES = semComentarios(ler("src/app/api/v1/monitoramento/sites/route.ts"));
const MIG = ler("supabase/migrations/20260925120000_reparar_documentos_sem_agencia.sql");

describe("etapa186 · prevenir: a agência do item cai no SÍTIO, não no nulo", () => {
  it("as duas consultas trazem `site_id` — sem ele não há o que resolver", () => {
    const comSite = (ENQ.match(/\.select\("id, agencia_id, site_id, tipo, titulo, url_item, status, metadata/g) ?? []).length;
    expect(comSite, "uma das consultas (janela ou retry) deixou de trazer site_id").toBe(2);
  });

  it("⚠️ e o `enqueuePdfBuffer` recebe a agência RESOLVIDA, não `item.agencia_id` cru", () => {
    // Mutação a matar: voltar o campo cru. O `tsc` fica verde e o documento volta a nascer inerte.
    expect(ENQ).toMatch(/agenciaId: agenciaResolvida,/);
    expect(ENQ, "voltou a passar item.agencia_id cru ao enfileiramento")
      .not.toMatch(/agenciaId: \(item\.agencia_id as string \| null\) \?\? null/);
  });

  it("o job enfileirado recebe a MESMA agência resolvida", () => {
    // `upload-queue` lê `upload_jobs.agencia_id` de volta num reenvio: divergir aqui reintroduziria
    // o nulo pela porta do reenvio.
    expect(ENQ).toMatch(/jobsToProcess\.push\(\{ jobId: enqueued\.job_id, agenciaId: agenciaResolvida \}\)/);
  });

  it("⚠️ falha de leitura do sítio NÃO inventa agência — devolve null e o contador denuncia", () => {
    expect(ENQ).toMatch(/const resolvida = error \? null : \(\(data as \{ agencia_id\?: string \| null \} \| null\)\?\.agencia_id \?\? null\);/);
  });

  it("uma leitura por SÍTIO, não por item — o cache é por `site_id`", () => {
    expect(ENQ).toMatch(/const agenciaDoSiteCache = new Map<string, string \| null>\(\);/);
    expect(ENQ).toMatch(/const cacheado = agenciaDoSiteCache\.get\(siteId\);\s*if \(cacheado !== undefined\) return cacheado;/);
  });

  it("⚠️ `cacheado !== undefined`, não truthy — sítio SEM agência é resposta cacheável", () => {
    // Com `if (cacheado)` um sítio sem agência seria relido a cada item: N round-trips na fatia.
    expect(ENQ, "voltou o teste truthy, que não cacheia o sítio sem agência")
      .not.toMatch(/const cacheado = agenciaDoSiteCache\.get\(siteId\);\s*if \(cacheado\) return cacheado;/);
  });

  it("⚠️ os DOIS desfechos são contados — herdou, e não herdou", () => {
    /**
     * "Não herdou" é defeito de cadastro de FONTE, não de extração, e tem de aparecer como número.
     * Silenciá-lo é exatamente como o documento ficou inerte no acervo por semanas.
     */
    expect(ENQ).toMatch(/if \(agenciaResolvida\) agenciaHerdadaDoSite\+\+;\s*else semAgenciaNemNoSite\+\+;/);
    expect(ENQ).toMatch(/agencia_herdada_do_site: agenciaHerdadaDoSite/);
    expect(ENQ).toMatch(/sem_agencia_nem_no_site: semAgenciaNemNoSite/);
  });

  it("e a contagem só acontece quando o item NÃO tinha agência — senão infla", () => {
    expect(ENQ).toMatch(/if \(!item\.agencia_id\) \{\s*if \(agenciaResolvida\)/);
  });

  it("o docblock registra a medição que inverteu o diagnóstico", () => {
    expect(ENQ_BRUTO).toMatch(/storage_em_auto` é \*\*1\*\*/);
    expect(ENQ_BRUTO).toMatch(/BECO SEM SAÍDA/);
  });

  it("`site_id` é de fato NOT NULL — a premissa do fallback é verificada", () => {
    const M005 = ler("supabase/migrations/005_monitoramento_multiagency.sql");
    expect(M005).toMatch(/site_id\s+UUID NOT NULL REFERENCES monitoramento_sites\(id\)/);
  });

  it("e `deliberacoes.agencia_id` é NOT NULL — é o que faz o beco ser beco", () => {
    const M001 = ler("supabase/migrations/001_initial_schema.sql");
    expect(M001).toMatch(/agencia_id\s+UUID NOT NULL REFERENCES agencias\(id\)/);
  });
});

describe("etapa186 · fechar a porta: fonte de DOCUMENTO sem agência nasce inativa", () => {
  it("o gate é por `tipo_fonte` E ausência de agência", () => {
    expect(SITES).toMatch(/const nasceInativa = tipo_fonte === "documentos_regulatorios" && !agencia_id;/);
    expect(SITES).toMatch(/\.\.\.\(nasceInativa \? \{ ativo: false \} : \{\}\)/);
  });

  it("⚠️ e NÃO recusa o cadastro — fonte `institucional` sem agência é legítima", () => {
    /**
     * Há sítios seedados como institucional sem agência (notícias, diretoria). Recusar quebraria
     * cadastro que hoje funciona. O defeito era criar ATIVA, não aceitar o nulo.
     */
    expect(SITES, "passou a recusar o cadastro em vez de criar inativo")
      .not.toMatch(/Agência obrigatória|agencia_id é obrigat/i);
    const i = SITES.indexOf("const nasceInativa");
    const bloco = SITES.slice(i, i + 600);
    expect(bloco, "o gate deixou de olhar o tipo e passou a valer para toda fonte")
      .toMatch(/tipo_fonte === "documentos_regulatorios"/);
  });

  it("⚠️ e o operador é AVISADO — senão ele cadastra e espera itens que nunca vêm", () => {
    expect(SITES).toMatch(/nasceInativa\s*\?\s*\{\s*aviso:/);
    expect(ler("src/app/api/v1/monitoramento/sites/route.ts"))
      .toMatch(/Fonte de documentos criada INATIVA porque não tem agência/);
  });
});

describe("etapa186 · reparar os 19: pela procedência, e idempotente", () => {
  it("a derivação são DOIS saltos exatos, sem heurística nenhuma", () => {
    expect(MIG).toMatch(/mi\.id = \(dr\.metadata->>'monitoramento_item_id'\)::uuid/);
    expect(MIG).toMatch(/JOIN public\.monitoramento_sites AS s ON s\.id = mi\.site_id/);
    expect(MIG).toMatch(/SET agencia_id = s\.agencia_id/);
  });

  it("⚠️ nada de adivinhar pelo NOME ou pelo texto — a migration não pode inferir agência", () => {
    // Mutação a matar: alguém "melhora" o reparo casando sigla no filename. O nome é justamente o
    // que estava corrompido (mojibake) nesta mesma fase.
    for (const proibido of [/filename\s+ILIKE/i, /raw_text/i, /LIKE\s+'%ARTESP%'/i, /sigla\s*=/i]) {
      expect(MIG, `a migration passou a inferir agência: ${proibido}`).not.toMatch(proibido);
    }
  });

  it("idempotente: o `WHERE agencia_id IS NULL` faz a 2ª execução não tocar nada", () => {
    /**
     * ⚠️ A asserção é sobre o UPDATE, não sobre o arquivo. A primeira versão fazia
     * `toMatch(/WHERE dr.agencia_id IS NULL/)` solto e SOBREVIVEU à mutação que trocava o `WHERE`
     * do UPDATE por `WHERE TRUE` — porque o bloco de conferência no fim tem a mesma expressão, e o
     * `toMatch` achou aquela. O reparo teria passado a reescrever TODAS as linhas a cada execução.
     * Décima vez nesta fase que procurei texto em vez de medir o lugar.
     */
    const update1 = MIG.slice(MIG.indexOf("UPDATE public.documentos_regulatorios AS dr"),
                              MIG.indexOf("-- ── 3."));
    expect(update1, "o UPDATE dos documentos perdeu a guarda de idempotência")
      .toMatch(/WHERE dr\.agencia_id IS NULL/);
    expect(update1, "o UPDATE dos documentos passou a reescrever tudo").not.toMatch(/WHERE TRUE/i);
    const update2 = MIG.slice(MIG.indexOf("UPDATE public.upload_jobs AS uj"), MIG.indexOf("-- ── 4."));
    expect(update2, "o UPDATE dos jobs perdeu a guarda de idempotência").toMatch(/AND uj\.agencia_id IS NULL/);
  });

  it("⚠️ só repara quando o sítio TEM agência — senão escreveria nulo sobre nulo", () => {
    expect(MIG).toMatch(/AND s\.agencia_id IS NOT NULL;/);
  });

  it("o JOB também é reparado — `upload-queue` lê esse campo de volta num reenvio", () => {
    /**
     * ⚠️ Exigido NÃO-COMENTADO. A primeira versão fazia `toMatch(/UPDATE public.upload_jobs AS uj/)`
     * e sobreviveu à mutação que prefixava `-- ` na linha: `--` não impede o `toMatch`, e um UPDATE
     * comentado é exatamente um reparo que não acontece. Em SQL essa é a mutação mais fácil de
     * todas, porque comentar uma linha não quebra sintaxe nenhuma.
     */
    expect(MIG, "o UPDATE dos jobs está comentado — o reparo não acontece")
      .toMatch(/^UPDATE public\.upload_jobs AS uj$/m);
    expect(MIG).toMatch(/^ WHERE uj\.documento_id = dr\.id$/m);
  });

  it("⚠️ e quem SOBRA tem o motivo nomeado — duas causas, dois consertos", () => {
    expect(MIG).toMatch(/sem monitoramento_item_id \(upload MANUAL/);
    expect(MIG).toMatch(/com o SITIO tambem sem agencia \(defeito de cadastro de FONTE\)/);
    // E se sobrar sem nenhuma das duas causas, isso é dito em vez de passar batido.
    expect(MIG).toMatch(/sobrou % sem nenhuma das duas causas conhecidas/);
  });

  it("tem envelope transacional e o reload do PostgREST, como as outras", () => {
    expect(MIG).toMatch(/^BEGIN;/m);
    expect(MIG).toMatch(/^COMMIT;/m);
    expect(MIG).toMatch(/NOTIFY pgrst, 'reload schema';/);
  });

  it("⚠️ o cast `::uuid` é explícito — `metadata->>` é TEXT e a comparação falharia", () => {
    // Sem o cast o Postgres recusa a comparação, e num UPDATE...FROM isso derruba a transação toda.
    expect(MIG).toMatch(/\)::uuid/);
    expect(MIG).toMatch(/devolve TEXT e `id` é UUID/);
  });

  it("e NÃO desativa fonte existente por conta própria — isso é decisão do usuário", () => {
    expect(MIG).not.toMatch(/UPDATE public\.monitoramento_sites[\s\S]{0,200}?SET ativo = false/);
    expect(MIG).toMatch(/seria decisão de produto tomada por mim/);
  });
});
