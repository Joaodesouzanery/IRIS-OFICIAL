# Relatório de evolução do sistema — Julho/2026

Resumo do que foi construído, corrigido e endurecido na plataforma IRIS-Regulação ao longo de julho.
Organizado por tema (sem datas exatas). O fio condutor do mês foi tornar a **esteira de votos dos
diretores** confiável de ponta a ponta e transformá-la na **fonte única** que alimenta todos os módulos,
além de deixar a plataforma **operável no plano gratuito**, **segura** e com uma **newsletter pronta para
uso real**.

---

## 1. Esteira de votos dos diretores (o coração do sistema)

A esteira vai de **coleta → extração de PDFs → deliberações → voto de cada diretor → métricas**. Em julho
ela foi destravada, certificada e endurecida.

- **Certificação com documentos oficiais reais.** Criamos um "padrão-ouro" que confere a extração contra
  PDFs reais de ANTT, ANM e ARTESP (46 verificações). Toda mudança na extração passa a ser validada contra
  esse conjunto — nada regride em silêncio.
- **Destravamento da esteira.** Removidos os bloqueadores que travavam centenas de votos em revisão;
  os votos passaram a ser materializados e a alimentar a plataforma.
- **Coleta por agência mais completa:**
  - **ANTT** — coleta de atas/pautas/deliberações do portal, com passe-leve varrendo mais reuniões por
    execução e reconhecimento de mais dispositivos de voto.
  - **ANM** — passou a coletar as **atas reais** (antes só pegava manuais do rodapé do site); a fonte foi
    apontada para a sub-página correta.
  - **ARTESP** — coleta via portal (SSR, sem headless) e leitura do roster de assinaturas.
- **Confiabilidade do voto individual (correções críticas):**
  - Corrigido o caso em que um item **indeferido por unanimidade** era invertido para "Aprovado".
  - Divergência / voto de qualidade / sobrestamento passam a atribuir o voto certo a cada diretor.
  - Casos duvidosos deixam de "fabricar" voto favorável e vão para **revisão humana** (princípio:
    nunca chutar a direção do voto).
  - Distinção honesta entre voto **lido** do documento e voto **inferido** do mandato.
- **Robustez operacional:** botão **"Rodar tudo"** processa a fila inteira numa sessão com barra de
  progresso; reaper de jobs órfãos; detecção de **buracos de numeração**; limpeza de deliberações
  duplicadas; retificações do DOE não contam como decisão.
- **Cobertura AO VIVO.** Nova auditoria que confere, contra o site de cada agência, **quais reuniões
  existem vs. quais temos** (por número de reunião), com um alerta visível de "faltam N reuniões" — a prova
  de que a coleta está completa.

## 2. Notícias e coletor regulatório

- **Honestidade do coletor.** O painel de saúde passou a distinguir "**fonte quieta**" de "**coletor
  quebrado**" (antes qualquer silêncio parecia sucesso). Scoring real de saúde por fonte.
- **Cobertura ampliada.** Cobertura das 12+ fontes oficiais, com recuperação de fontes durante o
  **defeso eleitoral** (quando os sites mudam de comportamento) e resiliência a mudança de listagem.
- **Imagens sempre.** As notícias passaram a vir sempre com imagem (incl. recuperação de imagem oficial de
  ANATEL/ANP/ANVISA/ANCINE/ANTT/ANM) e sem resumo "lixo".
- **Orçamento de tempo Hobby-safe** na coleta (parada graciosa antes do limite da Vercel).

## 3. Newsletter Regulatória (produto de e-mail)

- **Template de e-mail na identidade IRIS** (navy + dourado + tipografia serifada + logo), pronto para
  **copiar e colar** no cliente de e-mail: estrutura com destaque (hero), **notícias em cards**, seção de
  **posts sociais** e seção de **próximos eventos do IRIS**.
- **Formato E-mail x PDF como opção.** O PDF caprichado foi preservado; o e-mail virou uma opção de
  formato escolhível (o preview reflete a escolha).
- **Imagens que aparecem no e-mail enviado.** A imagem da notícia (a mesma do PDF) agora aparece para quem
  recebe o e-mail; a imagem de post social fica hospedada em local estável (não "quebra").
- **Colar renderizado.** O botão de copiar passou a copiar o e-mail **renderizado** (não o código-fonte),
  para colar direto no editor do e-mail.
- **Posts de Instagram/LinkedIn.** Novo painel para incluir posts selecionados (foto + texto). Como o
  Instagram e o LinkedIn **bloqueiam a leitura automática** (login-wall), o fluxo confiável é manual:
  colar o link, preencher título/resumo e **subir um print do post** (a foto fica hospedada e aparece no
  e-mail).
- **Próximos eventos do IRIS.** A newsletter puxa automaticamente os próximos eventos do site
  (irisregulacao.org/eventos/) e traz link para o site.
- **Boletim.** Seções que não renderizavam nada foram implementadas.

## 4. Métricas e "fonte única" alimentando a plataforma

- A esteira de votos passou a alimentar corretamente **Analytics, Votação, Governança, Mandatos, Empresas,
  Qualidade e Boletim**.
- **KPIs institucionais** que eram placeholders ("—") agora trazem números reais (score, consenso,
  qualidade da IA).
- **Regra única de "resultado favorável"** aplicada de forma consistente em todos os módulos.

## 5. Segurança e LGPD

Foram feitas **cinco rodadas de auditoria** de segurança ao longo do mês, com correções aplicadas:

- **RLS (isolamento de dados).** Re-asserção de RLS em **todas** as tabelas de dados (corrigindo um caso em
  que uma migration antiga não havia sido aplicada em produção) — fecha exposição anônima de votos,
  diretores, mandatos e dados de associados.
- **Autenticação.** `setup-owner` ficou **fail-closed** após o primeiro admin (mata o risco de tomada de
  conta do owner); fechada escalada de privilégio nas rotas de bootstrap; login **minimalista**.
- **SSRF / coleta.** Guarda anti-SSRF no proxy de imagem e nos fetches de coleta; redirects revalidados a
  cada salto; proteção contra "zip-bomb".
- **Exposição.** `/system/status` deixou de vazar a postura de configuração (quais segredos existem) para
  chamadas anônimas.
- **Dependências.** Correção de vulnerabilidade ALTA de produção (biblioteca `ws`).
- **LGPD.** Diretores/mandatos tratados como agentes públicos exercendo função pública (base legal
  registrada); coleta restrita a atos oficiais públicos.

## 6. Performance e operação (plano gratuito / Vercel Hobby)

- **Orçamento de tempo padronizado (~50s)** em toda a coleta/crawl, para parar com segurança antes do
  limite da Vercel (evita processos mortos no meio).
- **Métricas paginadas** contra subcontagem silenciosa; leitura de sub-chaves em vez do JSON inteiro;
  operações em lote (batch) no lugar de N escritas.
- **Migrations** idempotentes e forward-only aplicadas manualmente, com o código degradando com segurança
  quando a migration ainda não foi aplicada (deploy-antes-seguro).
- **Documentação de operação** (`docs/PENDENCIAS.md`): fluxo semanal manual, ações recorrentes e itens
  adiados por decisão.

## 7. Qualidade de engenharia e configuração do repositório

- **Configuração Claude Code versionada** (`CLAUDE.md` + skills/agents curados) para padronizar as
  convenções do projeto (rotas de API, migrations, segurança/LGPD).
- **Testes de domínio** ampliados a cada mudança sensível (extração de votos, filtros de coleta, parser de
  eventos, template de e-mail), mantendo o padrão-ouro de certificação sempre verde.
- **Guia de portabilidade** do módulo de votos (o que é preciso para reusar a esteira em outro projeto).

---

### Em uma frase
Em julho a plataforma saiu de uma esteira de votos travada para uma **fonte única confiável e certificada**
que alimenta todos os módulos, ganhou uma **newsletter de e-mail pronta para uso real** (com identidade
IRIS, imagens, posts sociais e eventos), e passou por **cinco rodadas de endurecimento de segurança** — tudo
operável no plano gratuito.
