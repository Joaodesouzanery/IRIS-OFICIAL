"""ANAC: leitura das paginas de reuniao do APEX (P139) e das pautas (P141). Usado por anac_baixar.py e anac_parse.py
(a varredura 100% NAO importa isto: reimplementa a leitura por conta propria).
A pagina traz o mesmo conteudo 5x (copias escapadas em atributos JS); a copia real e a NAO escapada (<table class="c">)."""
import re, html

PROC_RE = re.compile(r'\d{5}\.\d{6}/\d{4}-\d{2}')
def _txt(s): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).replace('\xa0', ' ').strip()

def regiao_real(h):
    """parte da pagina a partir do primeiro <div class="conteudo"> nao escapado."""
    i = h.find('<div class="conteudo">')
    return h[i:] if i >= 0 else h

def cabecalho(h):
    """titulo, data textual e links Pauta/Video/Ata da copia real; 'em breve' quando o link ainda nao existe."""
    r = regiao_real(h); j = r.find('<table')
    c = r[:j] if j > 0 else r[:4000]
    tit = _txt(re.sub(r'<a .*?</a>', '', c, flags=re.S))
    links = {}
    for href, rot in re.findall(r'<a [^>]*?href=\s*"?([^\s">]+)[^>]*>(.*?)</a>', c, flags=re.S):
        links[_txt(rot)] = html.unescape(href)
    em_breve = [x for x in ('Ata', 'Vídeo', 'Pauta') if re.search(x + r' em breve', _txt(c))]
    m = re.search(r'(\d+)[ªº] Reunião Deliberativa.*?da ANAC', tit)
    d = re.search(r'(\d{1,2}) de (\w+)\s+de (\d{4})', tit)
    return {'titulo': m.group(0) if m else tit[:120], 'data_txt': d.group(0) if d else '', 'links': links, 'em_breve': em_breve}

def itens(h):
    """itens deliberados da copia real: n, Processo (limpo), processo_txt (bruto), Assunto, Relator, Deliberacao, docs=[(rotulo,url)]."""
    out = []
    for tb in re.findall(r'<table\s+class="c">(.*?)</table>', regiao_real(h), flags=re.S):
        d = {'campos': {}, 'docs': []}
        m = re.search(r'<strong>\s*(\d+)\)', tb); d['n'] = m.group(1) if m else None
        for r in re.findall(r'<tr>(.*?)</tr>', tb, flags=re.S):
            tds = re.findall(r'<td[^>]*>(.*?)</td>', r, flags=re.S)
            if len(tds) < 3: continue
            lab = _txt(tds[1]).rstrip(':').strip()
            if not lab: continue
            d['campos'][lab] = _txt(tds[2])
            if lab == 'Documentos':
                for href, rot in re.findall(r'<a [^>]*?href=\s*"?([^\s">]+)[^>]*>(.*?)</a>', tds[2], flags=re.S): d['docs'].append((_txt(rot), html.unescape(href)))
        pt = d['campos'].get('Processo', ''); mp = PROC_RE.search(pt)
        d['processo'] = mp.group(0) if mp else pt
        d['processo_txt'] = pt
        out.append(d)
    return out

def itens_pauta(h):
    """pauta (P141): secoes e itens (n, processo, assunto)."""
    t = regiao_real(h) if '<div class="conteudo">' in h else h
    its = []
    for tb in re.findall(r'<table\s+class="c">(.*?)</table>', t, flags=re.S):
        d = {}
        m = re.search(r'<strong>\s*(\d+)\)', tb); d['n'] = m.group(1) if m else None
        for r in re.findall(r'<tr>(.*?)</tr>', tb, flags=re.S):
            tds = re.findall(r'<td[^>]*>(.*?)</td>', r, flags=re.S)
            if len(tds) >= 3 and _txt(tds[1]): d[_txt(tds[1]).rstrip(':').strip()] = _txt(tds[2])
        mp = PROC_RE.search(d.get('Processo', '')); d['processo'] = mp.group(0) if mp else d.get('Processo', '')
        its.append(d)
    return its
