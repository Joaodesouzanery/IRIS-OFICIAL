/**
 * Camada fina sobre node-html-parser para o coletor de notícias.
 * Centraliza o parsing DOM (robusto a HTML malformado, aspas simples,
 * atributos multilinha) e helpers de seleção, substituindo regex frágil.
 */

import { parse, type HTMLElement } from "node-html-parser";

export type Dom = HTMLElement;

export function parseHtml(html: string): HTMLElement {
  // Mantém o conteúdo de <script> (necessário para JSON-LD) e <style>.
  return parse(html, {
    comment: false,
    blockTextElements: { script: true, style: true, pre: false, textarea: false, code: false },
  });
}

/** Conteúdo de uma <meta> por property/name/itemprop (com fallback de variantes). */
export function metaContent(
  root: HTMLElement,
  attr: "property" | "name" | "itemprop",
  key: string,
): string | null {
  // Tenta o atributo pedido e também as variantes comuns (property↔name) — sites
  // misturam og:* em property e twitter:* em name de forma inconsistente.
  const selectors = [`meta[${attr}="${key}"]`, `meta[property="${key}"]`, `meta[name="${key}"]`, `meta[itemprop="${key}"]`];
  for (const sel of selectors) {
    const el = safeQuery(root, sel);
    const content = el?.getAttribute("content");
    if (content && content.trim()) return content.trim();
  }
  return null;
}

/** Texto cru de todos os <script type="application/ld+json"> da página. */
export function jsonLdBlocks(root: HTMLElement): string[] {
  return safeQueryAll(root, 'script[type="application/ld+json"]')
    .map((el) => el.rawText || el.text || "")
    .filter((t) => t.trim().length > 0);
}

/** Primeiro elemento que casa o seletor; null em seletor inválido. */
export function safeQuery(root: HTMLElement, selector: string): HTMLElement | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** Todos os elementos que casam o seletor; [] em seletor inválido. */
export function safeQueryAll(root: HTMLElement, selector: string): HTMLElement[] {
  try {
    return root.querySelectorAll(selector);
  } catch {
    return [];
  }
}

/** Lê o primeiro atributo presente entre `names`, decodificando entidades de URL. */
export function firstAttrValue(el: HTMLElement, names: string[]): string | null {
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value && value.trim()) return value.trim();
  }
  return null;
}
