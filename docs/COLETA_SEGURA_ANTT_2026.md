# Auditoria - Coleta Segura ANTT 2026

## O que foi feito

Foi criada uma coleta automatica para documentos publicos da ANTT no ano de 2026, a partir do portal oficial de reunioes da diretoria:

https://portal.antt.gov.br/web/guest/reunioes-da-diretoria

O coletor busca somente:

- Reunioes Deliberativas Eletronicas.
- Reunioes de Diretoria publicas, incluindo ordinarias e extraordinarias.
- PDFs de Pauta.
- PDFs de Voto, inclusive votos separados por processo quando o portal publica mais de um voto na mesma reuniao.

Reunioes Administrativas sao ignoradas.

## Como a coleta funciona

1. O sistema abre a pagina oficial de reunioes da ANTT.
2. Ele percorre as paginas de resultados enquanto encontrar reunioes de 2026.
3. Para cada reuniao valida, abre a pagina individual da reuniao.
4. Dentro da pagina individual, identifica:
   - numero e tipo da reuniao;
   - data e horario;
   - pauta;
   - processos deliberados;
   - interessado;
   - relator;
   - assunto;
   - decisao;
   - PDFs de voto vinculados a cada processo.
5. Cada PDF e baixado somente depois de passar por validacoes de seguranca.
6. O PDF e salvo em bucket privado do Supabase Storage.
7. O registro fica em revisao antes de qualquer importacao para deliberacoes ou votos.

Exemplo real de QA em producao, sem gravar dados:

```text
POST https://iris-oficial.vercel.app/api/v1/antt/2026/collect?dry_run=1&max_pages=2&max_meetings=6

Resultado apos correcao do parser:
- reunioes_encontradas: 6
- processos_salvos (simulados): 27
- documentos_encontrados: 26
- documentos_baixados: 0, porque dry_run nao grava nem baixa para Storage
```

Esse QA revelou e corrigiu um erro importante: o portal da ANTT publica PDFs em URLs como `.pdf/<uuid>?t=...`. O parser inicial aceitava `.pdf` no fim da URL, mas nao esse formato com barra depois de `.pdf`. A regra foi corrigida em `src/lib/server/antt-2026-collector.ts`, funcao `classifyDocumentLink`.

## Onde os dados ficam

Foram adicionadas tres tabelas:

- `antt_reunioes_coletadas`: guarda a reuniao encontrada.
- `antt_processos_coletados`: guarda cada processo deliberado dentro da reuniao.
- `documentos_coletados`: guarda cada documento coletado, com hash, link original, caminho no Storage e status de revisao.

Os arquivos ficam no bucket privado `pdfs`, em caminhos como:

`<agencia_id>/antt/2026/<reuniao>/<hash>-<tipo>-<titulo>.pdf`

## Como o sistema prova a origem

Cada documento coletado guarda:

- URL original do portal;
- URL da reuniao;
- tipo do documento, como `pauta` ou `voto`;
- hash SHA-256 do arquivo;
- tamanho em bytes;
- content-type retornado;
- data/hora de coleta;
- processo e relator, quando houver;
- status de validacao.

O hash SHA-256 e como uma impressao digital do arquivo. Se o PDF mudar, o hash muda.

Exemplo do registro de auditoria salvo para cada PDF:

```ts
metadata: {
  connector: "antt-2026",
  original_url: doc.url,
  meeting_url: meeting.url_reuniao,
  meeting_title: meeting.titulo,
  meeting_type: meeting.tipo,
  processo: doc.processo?.processo ?? null,
  relator: doc.processo?.relator ?? null,
  collected_from: meeting.source_url,
  security: {
    allowed_hosts: ["portal.antt.gov.br", "anttlegis.antt.gov.br"],
    magic_bytes_checked: true,
    sha256: downloaded.hash,
  },
}
```

Onde olhar no codigo:

- `src/lib/server/antt-2026-collector.ts:109`: funcao principal que salva reunioes, processos e documentos.
- `src/lib/server/antt-2026-collector.ts:207`: deduplicacao por hash antes de subir arquivo ao Storage.
- `src/lib/server/antt-2026-collector.ts:429`: busca de documento existente pelo hash SHA-256.
- `supabase/migrations/009_antt_2026_secure_collection.sql:58`: tabela `documentos_coletados`.
- `supabase/migrations/009_antt_2026_secure_collection.sql:94`: indice unico por URL original.
- `supabase/migrations/009_antt_2026_secure_collection.sql:96`: indice unico por hash.

## Seguranca aplicada

O coletor trata todo documento externo como nao confiavel.

Protecoes implementadas:

- So aceita HTTPS.
- So baixa de `portal.antt.gov.br` e `anttlegis.antt.gov.br`.
- Bloqueia redirects para dominios fora da allowlist.
- Rejeita URLs de `localhost`, IPs privados e enderecos internos.
- Limita HTML a 4 MB.
- Limita PDFs a 50 MB.
- Usa timeout de 20 segundos por requisicao.
- Verifica magic bytes `%PDF-` antes de aceitar o arquivo como PDF.
- Calcula SHA-256 para deduplicacao e auditoria.
- Salva PDFs em bucket privado.
- Usa `service_role` apenas em codigo server-side.
- A tela de revisao nao renderiza HTML vindo do portal ou do PDF.

Exemplos de codigo:

```ts
const ALLOWED_HOSTS = new Set(["portal.antt.gov.br", "anttlegis.antt.gov.br"]);
const MAX_PDF_BYTES = 50 * 1024 * 1024;
```

Essas constantes limitam os dominios aceitos e o tamanho maximo do PDF.

```ts
if (url.protocol !== "https:") throw new Error("URL rejeitada: apenas HTTPS");
if (!allowedHosts.has(host)) throw new Error(`URL rejeitada: dominio nao permitido (${host})`);
```

Esse trecho impede download de dominio fora da ANTT ou sem HTTPS.

```ts
if (!isPdfBuffer(res.buffer)) {
  throw new Error("arquivo rejeitado: magic bytes de PDF ausentes");
}
```

Esse trecho rejeita arquivos que fingem ser PDF, mas nao comecam com `%PDF-`.

## Como revisar

A tela fica em:

`/dashboard/documentos-antt-2026`

Nela o usuario pode:

- rodar a coleta ANTT 2026;
- ver documentos em revisao;
- abrir a origem oficial;
- abrir uma URL assinada temporaria do PDF salvo;
- marcar documento como validado;
- ignorar documento.

A importacao final para deliberacoes/votos nao e automatica nesta entrega. Isso reduz risco de erro de classificacao.

Importante: em producao, a aplicacao publicada esta em modo demo no momento do QA:

```json
{
  "is_demo": true,
  "has_supabase_url": false,
  "has_service_role_key": false,
  "persistence": "demo"
}
```

Ou seja: o deploy existe, mas para salvar documentos de verdade ainda falta configurar `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e aplicar a migration `009_antt_2026_secure_collection.sql` no Supabase de producao.

## Como um Dev Pleno pode manter

Principais arquivos:

- `src/lib/server/antt-2026-collector.ts`: regras de scraping, seguranca, parser e download.
- `src/app/api/v1/antt/2026/collect/route.ts`: dispara a coleta.
- `src/app/api/v1/antt/2026/documentos/route.ts`: lista documentos coletados.
- `src/app/api/v1/antt/2026/documentos/[id]/route.ts`: altera status de revisao.
- `src/app/api/v1/antt/2026/documentos/[id]/download/route.ts`: cria URL assinada temporaria.
- `src/app/dashboard/documentos-antt-2026/page.tsx`: tela de revisao.
- `supabase/migrations/009_antt_2026_secure_collection.sql`: schema e monitor da ANTT.

Se o portal da ANTT mudar o HTML, o ponto mais provavel de ajuste e o parser em `antt-2026-collector.ts`, especialmente as funcoes que extraem reunioes, processos e links.

## Limites conhecidos

- A coleta foi feita para documentos publicos de 2026.
- OCR nao foi incluido; PDFs escaneados sem texto podem ser salvos, mas a extracao semantica fica limitada.
- A aprovacao de revisao ainda nao cria deliberacoes/votos automaticamente.
- A CLI do Supabase nao estava instalada neste ambiente, entao a migration foi criada manualmente seguindo a sequencia ja existente do projeto.
- A automacao diaria atual do Vercel chama `/api/v1/monitoramento/check`, que detecta novos links quando o monitor `antt-2026` existir no banco. O download e salvamento em `documentos_coletados` exige chamar `/api/v1/antt/2026/collect` ou criar um cron dedicado para essa rota.
- A seguranca de producao ainda precisa de autenticacao/autorizacao real antes de liberar escrita em banco para usuarios externos.

## Adendo - Upload manual ANTT 2026 e Observatório da Regulação

Depois da coleta automatica inicial, foi criado tambem um fluxo manual para quando o usuario ja tem os PDFs da ANTT salvos no computador e quer testar documento por documento antes do scraping ficar definitivo.

Esse fluxo nao substitui a coleta automatica. Ele serve para:

- enviar um PDF por vez;
- identificar se o documento e da ANTT;
- classificar o documento como pauta, ata, voto individual, RDE, reuniao publica ou reuniao extraordinaria;
- extrair reuniao, data, processo, interessado, assunto, relator/diretor, decisao e autor do voto quando existir;
- mostrar tudo em preview para revisao humana antes de gravar;
- evitar que pauta ou ata crie voto automaticamente sem evidencia clara.

### Arquivos novos ou alterados

- `src/lib/server/antt-manual-parser.ts`: parser especifico para PDFs manuais da ANTT.
- `src/app/api/v1/upload/preview/route.ts`: passa o PDF pelo parser ANTT durante o preview.
- `src/app/dashboard/upload/page.tsx`: mostra os campos ANTT, avisos e chave de deduplicacao na tela de revisao.
- `middleware.ts`: permite preview de upload em modo DEMO, mas continua bloqueando gravacao.
- `src/components/layout/Sidebar.tsx`: renomeia o menu para `Observatório da Regulação`.
- `src/lib/module-tabs.ts`: adiciona a aba `Relatorios`.
- `src/app/dashboard/painel-regulatorio/relatorios/page.tsx`: nova rota de relatorios dentro do Observatorio.
- `src/lib/server/associado-documents.ts`: ajusta os nomes dos modelos de relatorio.

### Como o sistema identifica que o PDF manual e da ANTT

O parser procura sinais no nome do arquivo e no texto extraido do PDF.

Exemplo de codigo em `src/lib/server/antt-manual-parser.ts`:

```ts
const normalized = normalize(`${filename} ${clean.slice(0, 5000)}`);
const isAntt = /\bantt\b/.test(normalized)
  || normalized.includes("agencia nacional de transportes terrestres");
```

Explicando para leigo: o sistema junta o nome do arquivo com o comeco do texto do PDF, normaliza o texto e procura por `ANTT` ou pelo nome completo da agencia. Se nao encontrar isso, ele deixa o extrator geral trabalhar como antes para ARTESP, ANM e outras agencias.

### Como o tipo de documento e classificado

O parser separa documentos ANTT por regras simples e auditaveis.

Exemplo de codigo em `src/lib/server/antt-manual-parser.ts`:

```ts
if (value.includes("declaracao de voto")) return "voto_individual";
if (value.includes("ata da reuniao deliberativa eletronica")) return "ata";
if (value.includes("reuniao extraordinaria de diretoria")) return "reuniao_extraordinaria";
if (value.includes("reuniao deliberativa eletronica") || /\brde\b/.test(value)) {
  return "reuniao_deliberativa_eletronica";
}
```

Explicando: se o PDF fala `Declaracao de Voto`, ele e tratado como voto individual. Se fala `RDE`, vira Reuniao Deliberativa Eletronica. Se fala `Reuniao Extraordinaria`, vira extraordinaria. Isso deixa claro para o Dev Pleno onde alterar caso a ANTT mude o padrao dos documentos.

### Como votos individuais sao tratados

Para voto individual, o sistema tenta identificar o diretor autor do voto.

Exemplo de codigo em `src/lib/server/antt-manual-parser.ts`:

```ts
const ANTT_DIRECTOR_INITIALS = {
  DLA: "Lucas Asfor",
  DFQ: "Felipe Queiroz",
  DAA: "Alex Azevedo",
  DAB: "Alessandro Baumgartner",
  DSM: "Severino Medeiros",
  DGS: "Guilherme Sampaio",
};
```

No arquivo `Declaracao de Voto DFQ 001-2026.pdf`, o parser reconheceu `DFQ` como `Felipe Queiroz`.

Para esse caso, o preview monta:

```ts
nomes_votacao: documentType === "voto_individual" && director ? [director] : [],
resultado: documentType === "voto_individual" ? "Aprovado" : firstProcess.resultado,
```

Explicando: voto individual pode gerar um voto para aquele diretor, mas ainda passa por revisao na tela antes de virar dado final. Pauta e ata nao criam votos automaticamente.

### Como pautas, atas e RDEs sao tratadas

Para documentos de pauta/ata/RDE/reuniao publica/reuniao extraordinaria, o sistema tenta dividir os processos.

Exemplo de codigo em `src/lib/server/antt-manual-parser.ts`:

```ts
const re = /(?:(\d+\.\d+(?:\.\d+)?)\s+)?Processo\s*(?:n[ºo]\s*)?([0-9]{5}\.[0-9]{6}\/[0-9]{4}-[0-9]{2}|[0-9][0-9.\-/]{10,})/gi;
const matches = [...normalizedBreaks.matchAll(re)];
```

Explicando: essa regra procura blocos de processo como `50500.046640/2025-60`. Para cada processo encontrado, o sistema tenta puxar interessado, assunto, relator e decisao.

Quando o relator aparece antes do processo, como cabecalho `DIRETOR: ...`, o parser olha para o texto anterior mais proximo:

```ts
const relator = extractRelatorForBlock(block)
  ?? extractNearestRelator(normalizedBreaks.slice(0, start));
```

Isso foi importante para documentos de pauta da ANTT, porque o portal costuma listar um diretor e, logo abaixo, varios processos.

### Como a revisao humana foi reforcada

Todo documento ANTT que nao e voto individual recebe um aviso explicito:

```ts
if (type !== "voto_individual") {
  warnings.push("ANTT: documento tratado como pauta/ata revisavel; votos nao sao criados automaticamente.");
}
```

Na tela de upload, esses avisos aparecem no card de revisao em `src/app/dashboard/upload/page.tsx`.

Exemplo do que aparece para o usuario:

```text
Revisao ANTT necessaria:
- ANTT: documento tratado como pauta/ata revisavel; votos nao sao criados automaticamente.
```

Isso evita um erro grave: transformar pauta em voto sem que exista voto assinado ou decisao clara.

### Deduplicacao semantica no upload manual

Alem do hash do PDF, o preview monta uma chave semantica:

```ts
[
  "ANTT",
  meeting.numero ?? "",
  firstProcess.processo ?? "",
  director ?? "",
  documentType,
].join("|")
```

Explicando: mesmo que dois arquivos tenham nomes diferentes, se eles falam da mesma agencia, mesma reuniao, mesmo processo, mesmo diretor e mesmo tipo, a plataforma tem uma pista forte de duplicidade. Isso ainda e usado como informacao de revisao, sem apagar dado real automaticamente.

### Como o preview manual foi encaixado no endpoint

Em `src/app/api/v1/upload/preview/route.ts`, o fluxo ficou assim:

```ts
const fields = extractFields(extraction.text);
const antt = parseAnttManualDocument(extraction.text, file.name);

if (antt.isAntt) {
  Object.assign(fields, withoutUndefined(antt.fields as Record<string, unknown>));
  if (antt.fields.tipo_documento) {
    tipo_documento = antt.fields.tipo_documento;
  }
}
```

Explicando: primeiro roda o extrator geral. Depois, se for ANTT, roda o parser especifico e sobrescreve apenas os campos que a ANTT consegue identificar melhor.

### Demo pode analisar, mas nao gravar

Foi feita uma excecao segura no middleware:

```ts
if (pathname === "/api/v1/upload/preview" && req.method === "POST" && isDemoRequest) {
  return NextResponse.next();
}
```

Explicando: no modo DEMO, o usuario consegue enviar PDF para ver o preview. Mas `confirmar`, `validar`, `ignorar`, `criar`, `editar` e `excluir` continuam bloqueados quando o header demo esta ligado.

### Observatório da Regulação e Relatórios

O menu `Regulatório` foi renomeado para `Observatório da Regulação`.

A tela de relatorios ficou em:

```text
/dashboard/painel-regulatorio/relatorios
```

Foram criados dois modelos padronizados:

- `Relatorio do Associado trimestral`
- `Relatorio Mensal regulatorio`

Exemplo de codigo em `src/lib/server/associado-documents.ts`:

```ts
const titulo = input.tipo === "relatorio_trimestral"
  ? `Relatorio do Associado trimestral - ${input.associado.nome}`
  : `Relatorio Mensal regulatorio - ${input.associado.nome}`;
```

O relatorio trimestral inclui:

- mandatos;
- lista triplice;
- concordancia dos diretores;
- recorte tematico do associado;
- tres paragrafos de Visao VP.

O relatorio mensal inclui:

- decisoes do periodo;
- pautas, votos e atos monitorados;
- noticias e politica publica correlata;
- cenarios cautelosos;
- fontes.

### QA manual com PDFs do ZIP

Foi feito QA local com os documentos do ZIP recebido, sem importar nada para o banco.

Amostras testadas:

- RDE 267, 268, 269, 270, 272, 275, 276, 278 e 280.
- Reuniao de Diretoria Publica 1.028, 1.030 e 1.032.
- Reuniao Extraordinaria 99 e 100.
- Pauta 1.026.
- Declaracao de Voto DFQ 001-2026.

Resultado observado:

- Todos foram reconhecidos como ANTT.
- RDEs e pautas extraem numero da reuniao, data e processos.
- Reunioes publicas e extraordinarias extraem reuniao, data e processos.
- Quando o texto traz relator em formato legivel, o parser associa o processo ao diretor.
- A declaracao de voto DFQ identificou `Felipe Queiroz`, data e processo.
- Pautas/atas/RDEs entraram com aviso de revisao e sem criacao automatica de voto.

Limite importante: nao existe "certeza absoluta" em PDF extraido automaticamente. Se o PDF vier digitalizado, com texto quebrado ou com layout novo da ANTT, o sistema marca baixa confianca/aviso e exige revisao humana. Esse e o comportamento correto para producao.

## Atualizacao: correcao do parser manual ANTT

Depois do teste real no Upload de PDFs, foram corrigidos pontos que impediam o uso confiavel para metricas de diretores e relatorios.

### O que mudou no parser

Arquivo principal:

```text
src/lib/server/antt-manual-parser.ts
```

O parser agora separa melhor os tipos de documento da ANTT:

- pauta/RDE: agenda regulatoria, sem resultado e sem voto automatico;
- ata: decisao por processo, com voto favoravel para diretores presentes somente quando o texto trouxer "por unanimidade";
- voto individual: voto ligado apenas ao diretor autor;
- rodape SEI: processos de "Referencia: Processo..." sao ignorados quando nao trazem interessado/assunto deliberado.

Exemplo simplificado da regra de ata:

```ts
const unanimidade = isAta && Boolean(item.decisao) && !retirada && /unanimidade/i.test(normalize(item.decisao ?? ""));
const votos = unanimidade ? presentDirectors : [];
```

Explicando para leigo: o sistema so cria votos para diretores quando encontra uma decisao real na ata e a ata diz que foi por unanimidade. Se for pauta, agenda ou item retirado de pauta, ele nao inventa voto.

### Como evita processo falso do SEI

Exemplo de regra:

```ts
if (isSeiReferenceProcess(block, interessado, assunto)) {
  continue;
}
```

Explicando: muitos PDFs da ANTT terminam com uma linha tecnica do SEI, como "Referencia: Processo no ...". Isso nao e o processo deliberado. A regra ignora esse rodape quando nao ha interessado e assunto vinculados.

### Como os votos vao para o modulo Diretores

Arquivo de confirmacao:

```text
src/app/api/v1/upload/confirm/route.ts
```

Na confirmacao do upload, o sistema usa os votos detectados em cada item:

```ts
const itemVotingNames = item.votos_detectados ?? [];
```

E removeu o fallback perigoso que criava voto para todos os diretores quando nao havia nome detectado. Isso e essencial para a metrica de concordancia dos diretores nao ficar artificialmente inflada.

### Identificador interno de pauta e ata

Pautas e atas nao fingem ser deliberacao oficial. Quando o PDF nao traz numero oficial de deliberacao, a plataforma usa um identificador interno revisavel:

```text
PAUTA-268-1
ATA-267-1.1.1
```

Explicando: isso ajuda a organizar e deduplicar o acervo, mas nao deve ser citado como numero oficial de deliberacao.

### Portugues e interface

Na tela de upload, os labels foram ajustados para portugues com acentos:

- "Reuniao Deliberativa Eletronica" passou a aparecer como "Reunião Deliberativa Eletrônica";
- "Revisao ANTT necessaria" passou a aparecer como "Revisão ANTT necessária";
- "nao identificado" passou a aparecer como "não identificado".

Arquivo:

```text
src/app/dashboard/upload/page.tsx
```

### Relatorios

Arquivo:

```text
src/lib/server/associado-documents.ts
```

Foi adicionada protecao para relatorios nao tratarem pauta como decisao final:

```ts
if (!isFinalDecisionDelib(d)) return false;
```

Explicando: pautas entram como agenda/sinal regulatorio. Elas podem aparecer no contexto, mas nao devem contar como resultado final nem como voto de diretor.

### QA especifico dos 11 PDFs enviados

Foram testados localmente estes 11 PDFs:

- Ata SEI da 267 RDE.
- Pauta 267 RDE.
- Ata SEI da 1.026 Reuniao de Diretoria.
- Pauta 1.026 RDP.
- Pautas/RDEs 268, 269, 270, 271, 272.
- Pauta da 1.027 Reuniao de Diretoria.
- Pauta da 1.028 Reuniao de Diretoria Publica.

Resultado do QA:

- 11 arquivos analisados.
- 60 processos extraidos.
- 0 processos falsos de rodape SEI.
- 0 pautas com resultado automatico indevido.
- 11 itens de ata com votos detectados por unanimidade.
- Na ata da 267 RDE, o parser identificou Guilherme Sampaio, Lucas Asfor, Felipe Queiroz e Alex Azevedo como presentes, e Severino Medeiros como ausente.

## QA executado

Comandos executados:

```text
npm.cmd run type-check
npm.cmd run build
npx vercel --prod
POST /api/v1/antt/2026/collect?dry_run=1&max_pages=2&max_meetings=6
GET /api/v1/system/status
HEAD /dashboard/documentos-antt-2026
npm.cmd audit --omit=dev --json
```

Resultados:

- TypeScript passou.
- Build local passou.
- Deploy Vercel passou e foi publicado em `https://iris-oficial.vercel.app`.
- Tela `/dashboard/documentos-antt-2026` respondeu HTTP 200.
- Dry-run da ANTT encontrou 6 reunioes, 27 processos e 26 documentos nas duas primeiras paginas testadas.
- O QA encontrou um erro no regex de PDF; foi corrigido e redeployado.
- `npm audit` encontrou vulnerabilidades em `next`, `postcss` transitive via Next e `lodash`. A prioridade de producao e atualizar Next.js para uma versao corrigida compativel.
