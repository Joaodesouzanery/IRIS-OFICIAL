/**
 * nav-active.ts — o item ativo da navegação, decidido por MELHOR CASAMENTO, não por prefixo cru.
 *
 * ═══ O defeito que isto corrige (etapa67) ═══
 *
 * Sidebar e ModuleTabs tinham dois `isActive` independentes com a mesma regra:
 * `pathname === href || pathname.startsWith(href + "/")`, com um único caso especial hardcoded
 * (`/dashboard`). Sempre que um href era prefixo próprio de outro da MESMA lista, os dois
 * acendiam ao mesmo tempo. Cinco colisões mapeadas em produção:
 *
 *   · Sidebar — "Análise" (`/dashboard/analytics`) engolia "Diretores"
 *     (`/dashboard/analytics/diretores`);
 *   · Qualidade Regulatória — a aba "Dashboard" ficava PERMANENTEMENTE ativa nas 8 abas,
 *     porque o href dela é o prefixo comum de todas as outras;
 *   · Deliberações — "Deliberações" × "Votos dos Diretores";
 *   · Análise — "Analytics" × "Temas"/"Institucional";
 *   · Observatório — "Visão Geral" × Setores/Microtemas/Relatórios; "Empresas" × "Associados".
 *
 * ═══ A regra ═══
 *
 * Cada item possui um conjunto de paths (na sidebar, o `MODULE_PATHS[href]`; nas abas, o próprio
 * href). Entre TODOS os paths de TODOS os itens que casam o pathname (igualdade, ou prefixo
 * seguido de `/`), vence o MAIS LONGO — e só o item dono do vencedor fica ativo. Exatamente um
 * item acende, sem caso especial por rota: `/dashboard` deixa de precisar de exceção porque
 * qualquer rota mais funda tem um dono mais específico.
 */

export interface NavItem {
  /** Identidade do item (o href do link). */
  href: string;
  /** Paths que este item "possui". Default: `[href]`. */
  paths?: string[];
}

/**
 * O path casa o pathname? (igualdade, ou prefixo de segmento inteiro)
 *
 * ⚠️ Exceção ÚNICA e documentada: o path raiz `/dashboard` casa só por IGUALDADE. Ele é prefixo de
 * todas as rotas do app — por prefixo, o item que o possui (Deliberações, dono da aba "Dashboard")
 * acenderia em qualquer rota ÓRFÃ que nenhum outro item reivindica (ex.: uma rota nova ainda não
 * mapeada). Rota órfã com NENHUM item aceso é sinal de mapeamento faltando; item errado aceso é
 * mentira. Preferimos o sinal.
 */
function matches(pathname: string, path: string): boolean {
  if (path === "/dashboard") return pathname === "/dashboard";
  return pathname === path || pathname.startsWith(path + "/");
}

/**
 * Devolve o `href` do ÚNICO item ativo para o pathname — ou `null` se nenhum casa.
 * Empate de comprimento (dois itens possuindo o MESMO path) resolve pelo primeiro da lista,
 * o que é determinístico e sinaliza erro de configuração em vez de acender os dois.
 */
export function resolveActiveHref(pathname: string, itens: NavItem[]): string | null {
  let vencedor: { href: string; len: number } | null = null;
  for (const item of itens) {
    for (const path of item.paths ?? [item.href]) {
      if (!matches(pathname, path)) continue;
      if (!vencedor || path.length > vencedor.len) {
        vencedor = { href: item.href, len: path.length };
      }
    }
  }
  return vencedor?.href ?? null;
}
