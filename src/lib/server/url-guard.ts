/**
 * Guard anti-SSRF para coletas: rejeita URLs não-http(s) e hosts internos
 * (loopback, redes privadas, link-local / metadata de nuvem). Usado por todo
 * fetch de coleta que recebe URL não-confiável (cadastrada por admin ou extraída
 * de páginas). NÃO resolve DNS (rebinding fica fora de escopo); bloqueia IPs
 * literais privados, que é o vetor de roubo de credenciais de metadata.
 */

function isBlockedHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // IPv6 loopback / link-local / unique-local
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
    // IPv4-mapeado em IPv6 (ex.: ::ffff:127.0.0.1)
    const v4 = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.[1];
    if (v4 && isBlockedIPv4(v4)) return true;
    return false;
  }

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return isBlockedIPv4(host);

  return false;
}

function isBlockedIPv4(ip: string): boolean {
  return (
    /^0\./.test(ip) ||            // "this" network
    /^127\./.test(ip) ||          // loopback
    /^10\./.test(ip) ||           // privado A
    /^192\.168\./.test(ip) ||     // privado C
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) || // privado B
    /^169\.254\./.test(ip) ||     // link-local (metadata de nuvem)
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) // carrier-grade NAT
  );
}

/** Lança se a URL não for http(s) pública. Retorna a URL parseada. */
export function assertPublicUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL inválida");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`URL rejeitada: protocolo não permitido (${url.protocol})`);
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error(`URL rejeitada: endereço interno (${url.hostname})`);
  }
  return url;
}

export function isPublicUrl(rawUrl: string): boolean {
  try {
    assertPublicUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
