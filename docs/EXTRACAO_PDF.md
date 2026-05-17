# Extração de Dados de PDFs — IRIS Regulação

> Documentação técnica do pipeline de extração, fluxo de dados e estratégias de otimização.

---

## Sumário

1. [Visão Geral do Pipeline](#1-visão-geral-do-pipeline)
2. [Campos Extraídos](#2-campos-extraídos)
3. [Formato das Deliberações ARTESP](#3-formato-das-deliberações-artesp)
4. [Fluxo de Dados Completo](#4-fluxo-de-dados-completo)
5. [Confiança de Extração](#5-confiança-de-extração)
6. [Deduplicação de PDFs](#6-deduplicação-de-pdfs)
7. [Matching de Diretores e Votos](#7-matching-de-diretores-e-votos)
8. [Limitações Conhecidas](#8-limitações-conhecidas)
9. [Como Otimizar para Novos Formatos](#9-como-otimizar-para-novos-formatos)
10. [Monitoramento de Sites (Arquitetura Futura)](#10-monitoramento-de-sites-arquitetura-futura)

---

## 1. Visão Geral do Pipeline

```
PDF (arquivo)
     │
     ▼
[pdf-extractor.ts]
 ├─ Valida magic bytes (%PDF-)
 ├─ Extrai texto com pdf-parse
 ├─ Corrige encoding UTF-8
 └─ Remove cabeçalhos/rodapés repetidos
     │
     ▼
[nlp-extractor.ts]
 ├─ Estágio 1: Regex globais por campo
 ├─ Estágio 2: Varredura linha a linha (extractLabeledFields)
 └─ Calcula confiança ponderada (0.0 – 1.0)
     │
     ▼
[classifier.ts]
 ├─ classifyMicrotema() → tarifa, obras, multa, contrato...
 └─ classifyPautaInterna() → true/false
     │
     ▼
[API /upload/preview]
 Retorna PreviewResult[] para revisão do usuário
     │
     ▼ (após revisão e confirmação)
[API /upload/confirm]
 ├─ Sanitiza e valida campos
 ├─ INSERT deliberacoes
 └─ [name-matcher.ts] → match fuzzy de nomes de diretores
      └─ INSERT votos (Favoravel / Desfavoravel)
```

---

## 2. Campos Extraídos

### Tabela completa de campos

| Campo | Tipo | Estratégia de Extração | Exemplo |
|-------|------|------------------------|---------|
| `numero_deliberacao` | `string \| null` | Regex: `DELIBERAÇÃO Nº (\d+)` | `"1234"`, `"1234.56"` |
| `reuniao_ordinaria` | `string \| null` | Regex: `(\d{3,4})ª Reunião Ordinária` | `"1176ª Reunião Ordinária"` |
| `numero_reuniao` | `string \| null` | Extraído de `reuniao_ordinaria` | `"1176"` |
| `data_reuniao` | `string \| null` | Extenso contextual → extenso global → numérico contextual → numérico global | `"2026-03-12"` |
| `interessado` | `string \| null` | 13 rótulos + varredura linha a linha | `"Empresa XYZ Ltda."` |
| `processo` | `string \| null` | SEI, PA, Proc. Adm., Autos + varredura linha | `"001.0036/2024-51"` |
| `assunto` | `string \| null` | "Assunto:" → "Ementa:" → "Tema:" + varredura linha | `"Ratificação de reajuste tarifário"` |
| `resultado` | `string \| null` | 17 verbos decisórios (frequência máxima) | `"Aprovado"`, `"Ratificado"` |
| `pauta_interna` | `boolean` | Keywords administrativas \| ausência de interessado | `false` |
| `resumo_pleito` | `string \| null` | "Resumo:" → "Objeto:" → "Trata-se de..." → fallback assunto | `"Trata-se de requerimento..."` |
| `fundamento_decisao` | `string \| null` | "Fundamento:" → "Em face do exposto" → "DECIDE" → "RESOLVE" | `"Em face do exposto, a Diretoria..."` |
| `nomes_votacao` | `string[]` | Bloco de assinatura + contexto narrativo | `["Maria Silva", "João Costa"]` |
| `nomes_votacao_favor` | `string[]` | Unanimidade / "– Favorável" / padrões narrativos | `["Maria Silva"]` |
| `nomes_votacao_contra` | `string[]` | "voto dissidente" / "– Contrário" / "– Abstenção" | `["João Costa"]` |
| `signatarios` | `string[]` | Bloco de assinatura (Title Case + CAIXA ALTA) | `["MARIA SILVA"]` |
| `unanimidade_detectada` | `boolean` | "por unanimidade de votos" e variações | `true` |

### Rótulos reconhecidos por campo

**`interessado`** (13 rótulos):
- `Interessado`, `Requerente`, `Empresa`, `Solicitante`, `Demandante`
- `Concessionária`, `Permissionária`, `Peticionário`, `Proponente`
- `Beneficiária`, `Outorgado/a`, `Postulante`, `Requerida`

**`processo`** (7 variantes):
- `SEI nº`, `SEI! nº`, `Processo SEI nº`, `Processo nº`
- `PA nº`, `Proc. Adm. nº`, `Procedimento nº`, `Autos nº`

**`resultado`** (17 verbos → 11 valores normalizados):

| Texto no PDF | Valor normalizado |
|-------------|-------------------|
| DEFERIDO / DEFERIMENTO | `Deferido` |
| INDEFERIDO / INDEFERIMENTO | `Indeferido` |
| PARCIALMENTE DEFERIDO | `Parcialmente Deferido` |
| RETIRADO DE PAUTA | `Retirado de Pauta` |
| RATIFICA / RATIFICADO | `Ratificado` |
| APROVA / APROVADO | `Aprovado` |
| APROVADO COM RESSALVAS | `Aprovado com Ressalvas` |
| RECOMENDA / RECOMENDADO | `Recomendado` |
| DETERMINA / DETERMINADO | `Determinado` |
| AUTORIZA / AUTORIZADO | `Autorizado` |
| HOMOLOGA / HOMOLOGADO | `Aprovado` |
| ARQUIVA / ARQUIVADO | `Retirado de Pauta` |
| ANULA / ANULADO | `Indeferido` |
| REVOGA / REVOGADO | `Indeferido` |
| CANCELA / CANCELADO | `Retirado de Pauta` |
| PREJUDICA / PREJUDICADO | `Retirado de Pauta` |

---

## 3. Formato das Deliberações ARTESP

### Estrutura típica de uma deliberação ARTESP

```
╔══════════════════════════════════════════════════════════════╗
║  DELIBERAÇÃO Nº 1234                              ← numero_deliberacao
║  1176ª Reunião Ordinária da Diretoria             ← reuniao_ordinaria
║  São Paulo, 12 de março de 2026                   ← data_reuniao
╠══════════════════════════════════════════════════════════════╣
║  Assunto: Ratificação de reajuste tarifário       ← assunto
║  Interessado: Empresa XYZ Ltda.                   ← interessado
║  Processo SEI! nº 001.0036/2024-51                ← processo
╠══════════════════════════════════════════════════════════════╣
║  Trata-se de requerimento formulado pela          ← resumo_pleito
║  Empresa XYZ Ltda. visando...
║
║  [Corpo da deliberação]
╠══════════════════════════════════════════════════════════════╣
║  Em face do exposto, a Diretoria da ARTESP        ← fundamento_decisao
║  RATIFICA o reajuste tarifário...                 ← resultado (RATIFICA)
║
║  Votação: por unanimidade de votos                ← unanimidade_detectada
╠══════════════════════════════════════════════════════════════╣
║  MARIA SILVA                                      ← signatarios (CAPS)
║  Diretora-Presidente
║
║  JOÃO COSTA
║  Diretor
╚══════════════════════════════════════════════════════════════╝
```

### Particularidades ARTESP

- **Nomes em CAIXA ALTA** nos blocos de assinatura (padrão E: `RE_ASSINATURA_CAPS`)
- **Verbos decisórios no infinitivo**: `RATIFICA`, `APROVA`, `DETERMINA` (não `RATIFICADO`)
- **Processo SEI com `!`**: `SEI! nº` (exclamação é comum nas deliberações)
- **Data no cabeçalho**: `"São Paulo, 12 de março de 2026"` — busca contextualizada próxima a "São Paulo,"

---

## 4. Fluxo de Dados Completo

### Etapa 1: Upload e Preview

```
Usuário → dropzone (upload/page.tsx)
  │ Lote de até 5 PDFs por vez (BATCH_SIZE = 5)
  ▼
POST /api/v1/upload/preview
  ├─ isPdfBuffer() — valida magic bytes
  ├─ sha256Hex() — hash para deduplicação
  ├─ Verifica duplicata binária (tabela upload_jobs.file_hash)
  ├─ extractPdfText() — extrai e limpa texto
  ├─ extractFields() — NLP regex + linha a linha
  ├─ classifyMicrotema() — keyword matching
  ├─ calcConfidence() — score ponderado 0.0–1.0
  ├─ detectAgenciaSigla() — contagem de ocorrências
  └─ Verifica duplicata semântica (deliberacoes.numero_deliberacao + agencia_id)
  │
  ▼ Retorna PreviewResult[]
```

### Etapa 2: Revisão pelo Usuário

```
ReviewCard por arquivo:
  ├─ Exibe campos extraídos (editáveis)
  ├─ Mostra score de confiança (Alta ≥ 80% | Média 50–80% | Baixa < 50%)
  ├─ Alerta de duplicata (binária ou semântica)
  └─ Usuário corrige campos incorretos se necessário
```

### Etapa 3: Confirmação e Persistência

```
POST /api/v1/upload/confirm
  ├─ sanitizeDelib() — allowlists, length limits
  ├─ INSERT deliberacoes (com extraction_confidence, auto_classified=true)
  ├─ Carrega diretores da agência para matching
  ├─ Para cada nome em nomes_votacao:
  │    findBestMatch() → Levenshtein similarity
  │    CREATE voto (Favoravel/Desfavoravel)
  └─ Fallback unanimidade: se nenhum nome → todos diretores recebem Favoravel
```

### Etapa 4: Exibição

```
GET /api/v1/deliberacoes
  ├─ JOIN votos + diretores
  ├─ Merge com localStorage (modo demo)
  └─ Filtros: agência, ano, microtema, resultado, data range, busca full-text
```

### Tabelas no banco

```
agencias ──→ deliberacoes ←── upload_jobs
               ↑
diretores ──→ votos
  └── mandatos
```

---

## 5. Confiança de Extração

### Cálculo ponderado

```typescript
// Pesos somam 1.0 quando todos os campos estão presentes
const weights = [
  [numero_deliberacao !== null, 0.22],  // campo identificador central
  [data_reuniao       !== null, 0.18],  // data sempre presente
  [resultado          !== null, 0.18],  // decisão final
  [interessado        !== null, 0.14],  // quem fez o requerimento
  [assunto            !== null, 0.12],  // tema da deliberação
  [processo           !== null, 0.10],  // número SEI
  [resumo_pleito      !== null, 0.04],
  [fundamento_decisao !== null, 0.02],
];
```

### Faixas de confiança

| Score | Status | Significado |
|-------|--------|-------------|
| ≥ 0.85 | **Alta** (verde) | Extração muito provavelmente correta |
| 0.50–0.84 | **Média** (amarelo) | Revisar campos faltantes |
| < 0.50 | **Baixa** (vermelho) | Revisão obrigatória, PDF pode ter formato atípico |

### O que não afeta a confiança

- `reuniao_ordinaria` — campo de contexto, não crítico
- `nomes_votacao` — extraídos por padrão separado, não entram no score
- `pauta_interna` — flag booleana, não afeta score

---

## 6. Deduplicação de PDFs

### Camada 1: Hash SHA-256 do arquivo

Detecta cópias binárias **exatamente iguais**:
```typescript
// Computed at upload time
const file_hash = await sha256Hex(buffer);
// Checked against upload_jobs.file_hash (UNIQUE constraint)
```

### Camada 2: Semântica por número de deliberação

Detecta **a mesma deliberação em arquivos diferentes** (re-scan, watermark, compressão diferente):
```typescript
// After NLP extraction
await db.from("deliberacoes")
  .select("id")
  .eq("numero_deliberacao", fields.numero_deliberacao)
  .eq("agencia_id", agencia_id_detected)
  .maybeSingle();
```

### Comportamento

- Duplicata binária → marcado como `is_duplicate: true`, exibido com badge "Já processado"
- Duplicata semântica → `is_duplicate: true`, avisa "Número de deliberação já cadastrado"
- Usuário pode **forçar re-upload** (override manual na UI)

---

## 7. Matching de Diretores e Votos

### Algoritmo de matching (Levenshtein + Token Sort)

```
Nome extraído do PDF: "MARIA SILVA"
         │
         ▼
Normalização: lowercase + remove acentos + tokenize + sort
         │ "maria silva"
         ▼
Comparar com cada diretor da agência:
  ├─ "Maria Aparecida Silva"  → "aparecida maria silva"  → score: 0.72
  ├─ "Maria Silva Costa"     → "costa maria silva"      → score: 0.83
  └─ "Maria Silva"           → "maria silva"            → score: 1.00 ✓
         │
         ▼
Resultado: score ≥ 0.85 → match automático (needsReview: false)
           score 0.60–0.84 → match com revisão (needsReview: true)
           score < 0.60    → novo diretor (isNew: true)
```

### Votos gerados

```typescript
// Para cada nome em nomes_votacao:
{
  deliberacao_id: string,
  diretor_id: string | null,  // null se não match
  tipo_voto: "Favoravel" | "Desfavoravel",
  is_divergente: boolean,     // true se votou contra
  is_nominal: boolean,        // true se diretor identificado
}
```

### Como adicionar variantes de nome

Para evitar falsos "novo diretor" ao processar deliberações onde o mesmo diretor aparece com nome abreviado:

```sql
-- Via Supabase ou API:
UPDATE diretores
SET nome_variantes = array_append(nome_variantes, 'MARIA A. SILVA')
WHERE nome = 'Maria Aparecida Silva';
```

O `findBestMatch()` também compara contra `nome_variantes`.

---

## 8. Limitações Conhecidas

### PDFs digitalizados (scaneados)

- `pdf-parse` extrai texto nativo de PDFs digitais
- PDFs scaneados são imagens — retornam `charsPerPage < 80`
- **Solução futura**: integrar `tesseract.js` para OCR
- **Detecção**: o sistema avisa "PDF sem texto extraível — possível documento digitalizado"

### Layouts em colunas

- O `pdf-parse` extrai texto linearmente, sem respeitar colunas
- Em PDFs com duas colunas, os campos podem aparecer misturados
- **Impacto**: campos `interessado` e `processo` podem se misturar se o PDF tiver layout complexo

### PDFs com proteção de cópia

- PDFs com flag de cópia desabilitada retornam texto vazio ou incompleto
- **Comportamento**: mesmo tratamento de PDFs scaneados

### Formatos atípicos de outras agências

- Agências como ANEEL, ANVISA têm formatos próprios que podem não seguir o padrão ARTESP
- O extrator é genérico mas foi otimizado para ARTESP
- Veja seção 9 para como adicionar suporte a novos formatos

### Encoding de PDFs antigos

- PDFs gerados antes de 2010 frequentemente usam Latin-1 ou Windows-1252
- O `fixEncoding()` corrige 18 padrões comuns de corrupção UTF-8
- PDFs muito antigos podem ter artefatos não cobertos

---

## 9. Como Otimizar para Novos Formatos

### Passo 1: Identificar os rótulos usados

Abra um PDF da nova agência no modo texto e anote:
- Qual rótulo precede o nome da empresa? (`Interessado:`, `Outorgado:`, etc.)
- Qual é o padrão do número de processo? (`SEI nº`, `NUP nº`, `OFÍCIO nº`, etc.)
- Qual é o verbo de decisão? (`DELIBERA`, `DECIDE`, `RESOLVE`, etc.)
- Como aparecem os nomes dos diretores? (Title Case, CAIXA ALTA, com título?)

### Passo 2: Adicionar rótulos ao `nlp-extractor.ts`

**Arquivo:** `src/lib/server/nlp-extractor.ts`

```typescript
// Adicionar ao RE_INTERESSADO:
const RE_INTERESSADO = /(?:...|SuaNovaLabel[:\s]+)([^\n]{3,200})/gi;

// Adicionar ao RE_PROCESSO:
const RE_PROCESSO = /(?:...|NUP\s*n[ºo°]?|OFÍCIO\s*n[ºo°]?)\s*([\d\.\/\-]+)/gi;

// Adicionar ao RE_RESULTADO para novos verbos:
const RE_RESULTADO = /\b(...|DELIBERA(?:DO)?|DECIDE(?:-SE)?)\b/gi;

// Adicionar ao normalizeResultado():
if (upper.startsWith("DELIBERA")) return "Aprovado";
```

### Passo 3: Adicionar keywords de microtema ao `classifier.ts`

**Arquivo:** `src/lib/server/classifier.ts`

```typescript
const MICROTEMA_KEYWORDS: Record<string, string[]> = {
  tarifa: [
    ...existingKeywords,
    "novidade específica da agência",  // adicionar aqui
  ],
};
```

### Passo 4: Adicionar o padrão de assinatura se necessário

Se a nova agência usa um formato de assinatura diferente:

```typescript
// Exemplo: "Nome Completo — Conselheiro"
const RE_ASSINATURA_NOVA_AGENCIA = /^([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü\s]+)\s*—\s*Conselheiro/gm;
```

### Passo 5: Testar e validar

1. Fazer upload de 5–10 PDFs da nova agência
2. Verificar o score de confiança na UI (deve ser ≥ 0.70)
3. Para campos com confiança baixa, identificar o padrão regex ausente
4. Iterar até atingir confiança consistente

---

## 10. Monitoramento de Sites (Arquitetura Futura)

> Esta funcionalidade **ainda não está implementada**. Aqui está o plano técnico para implementação futura.

### Objetivo

Monitorar automaticamente páginas de transparência das agências reguladoras para detectar quando novas deliberações são publicadas, sem precisar visitar manualmente o site.

**Exemplo:** `https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria`

### Desafio: Sites com JavaScript (SPA)

| Abordagem | Funciona no Vercel | Adequada para ARTESP |
|-----------|--------------------|-----------------------|
| `cheerio` + `fetch` (HTML estático) | ✅ Leve | ❓ Depende do site |
| `playwright` (headless browser) | ⚠️ Binário 50MB+ | ✅ Funciona |
| `puppeteer` + `@sparticuz/chromium` | ✅ Layer otimizado para Lambda | ✅ Funciona |
| Serviço externo (ScrapingBee, Apify) | ✅ Qualquer site | ✅ Funciona |

**Recomendação:** `puppeteer` + `@sparticuz/chromium` para sites governamentais (frequentemente usam Liferay CMS com renderização JavaScript).

### Arquitetura planejada

```
Vercel Cron (2×/dia, dias úteis)
     │
     ▼
GET /api/v1/monitoramento/check
     │
     ├─ Para cada site em monitoramento_sites (ativo = true):
     │    1. Fazer scraping da página
     │    2. Extrair lista de links/títulos de deliberações
     │    3. Comparar com itens_conhecidos (JSONB no banco)
     │    4. Novos itens → INSERT alertas_monitoramento
     │    5. Atualizar ultimo_check e ultimo_hash
     │
     └─ Retornar sumário: {checados, novos_detectados}
```

### Schema de banco proposto

```sql
-- Sites monitorados
CREATE TABLE monitoramento_sites (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_id       UUID REFERENCES agencias(id) ON DELETE SET NULL,
  nome             TEXT NOT NULL,
  url              TEXT NOT NULL,
  ativo            BOOLEAN DEFAULT TRUE,
  seletor_links    TEXT DEFAULT 'a[href]',    -- CSS selector para links
  ultimo_check     TIMESTAMPTZ,
  ultimo_hash      CHAR(64),                   -- SHA-256 do conteúdo
  itens_conhecidos JSONB DEFAULT '[]',         -- [{url, titulo, data_detectado}]
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Alertas de novos itens detectados
CREATE TABLE alertas_monitoramento (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id   UUID NOT NULL REFERENCES monitoramento_sites(id) ON DELETE CASCADE,
  tipo      TEXT NOT NULL DEFAULT 'novo_item',
  titulo    TEXT,
  url_item  TEXT,
  lido      BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Fluxo de uso

1. Usuário cadastra site no painel de Monitoramento
2. Sistema faz scraping imediato para estabelecer baseline
3. Cron verifica 2x ao dia → detecta novos itens → cria alertas
4. Badge no dashboard mostra contagem de alertas não lidos
5. Usuário clica no alerta → abre URL do PDF → importa manualmente ou aciona upload automático

### Nota sobre ARTESP

O site ARTESP usa **Liferay CMS** que renderiza parcialmente via JavaScript. O `cheerio` simples pode retornar 0 itens. Recomendado usar `puppeteer` com aguardo de carregamento dinâmico antes de extrair os links.

## 11. Otimizações para envio a outros módulos

As extrações de PDF devem alimentar a plataforma como um dossiê regulatório, não apenas como uma linha em `deliberacoes`.

- **Classificação documental**: `pauta`, `ata`, `voto_individual` e `deliberacao` têm efeitos diferentes. Pautas e votos entram como sinais revisáveis; apenas decisões finais entram nas métricas principais.
- **Agrupamento por contexto**: documentos com a mesma agência, reunião e processo devem ficar agrupados para conectar pauta, voto, ata e deliberação oficial.
- **Dashboard**: contagens devem ignorar envelopes de ata e documentos sem decisão final para evitar duplicidade.
- **Diretores**: votos nominais alimentam a matriz de votação; nomes não reconhecidos viram candidatos pendentes de revisão.
- **Empresas**: interessado, processo, assunto e resultado alimentam histórico por concessionária/empresa regulada.
- **Notícias e newsletter**: deliberações recentes podem ser sugeridas junto das notícias selecionadas para a Newsletter Regulatório.
- **Revisão humana**: baixa confiança, PDF digitalizado, diretor não reconhecido, voto sem conclusão ou pauta sem decisão final devem bloquear importação automática para métricas definitivas.
