"""ANP: parser das atas de Reuniao de Diretoria (RD) e Reuniao Extraordinaria 2026 -> anp.json.
Uso: python3 -I scripts/anp_parse.py manifesto_anp.json anp.json   (le texto_anp/ e anp_inventario.json; roda da raiz da pasta)
Entradas independentes usadas no QA: calendario/pasta paginada do inventario (anp_baixar.py) e ancoras do proprio texto."""
import re, sys, json, glob, unicodedata, itertools, collections, datetime, os

# ------------------------------------------------------------------ NORMALIZACAO DO TEXTO (ligaduras quebradas)
# O PDF da ANP perde as ligaduras 'ti'/'tí'/'tt'/'fí' ("Biocombus veis", "Par ciparam", "Wa Neto"). Reparo por vocabulario:
# vocabulario = palavras COM ti/tí/tt/fí atestadas >=3x em textos intactos (outras agencias da pasta + a propria ANP);
# junta 2-3 fragmentos separados por UM espaco quando o resultado esta no vocabulario.
def _toks(t): return re.findall(r'[A-Za-zÀ-ÿ]+', t)
_LIG = {'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', '­': '', '​': '', ' ': ' '}
def _lig(t):
    for a, b in _LIG.items(): t = t.replace(a, b)
    return t
EXTRAS = {'biocombustíveis', 'biocombustível', 'automotivos', 'automotivo', 'compatível', 'compatíveis', 'motivo', 'tipos', 'físico', 'físicas', 'físico-químicas'}
def monta_vocab(textos_anp):
    C = collections.Counter()
    for d in ('texto_anvisa', 'texto_anpd', 'texto_antt', 'texto_artesp', 'texto_anvisa_cd', 'texto'):
        for f in glob.glob(d + '/*.txt'):
            C.update(w.lower() for w in _toks(_lig(open(f, encoding='utf8', errors='ignore').read())))
    for t in textos_anp: C.update(w.lower() for w in _toks(t))
    return {w for w, c in C.items() if c >= 3 and re.search('ti|tí|tt|fí', w)} | EXTRAS
GAPS = ['tí', 'ti', 'tt', 'fí']
def conserta_linha(ln, VOC):
    ms = list(re.finditer(r'[A-Za-zÀ-ÿ]+', ln)); out = []; i = 0; pos = 0
    while i < len(ms):
        feito = False
        for n in (3, 2):
            if i + n > len(ms): continue
            ch = ms[i:i + n]
            if any(ln[ch[k].end():ch[k + 1].start()] != ' ' for k in range(n - 1)): continue
            fr = [m[0] for m in ch]
            for gs in itertools.product(GAPS, repeat=n - 1):
                c = fr[0] + ''.join(g + f for g, f in zip(gs, fr[1:]))
                if c.lower() in VOC:
                    out.append(ln[pos:ch[0].start()] + c); pos = ch[-1].end(); i += n; feito = True; break
            if feito: break
        if not feito: i += 1
    out.append(ln[pos:]); r = ''.join(out)
    r = re.sub(r'\bWa\b(?=\s*[,.]|\s+Neto)', 'Watt', r)               # Artur Watt Neto (tt perdido)
    r = re.sub(r'(?<![A-Za-zÀ-ÿ])pos(?= de (?:derivados|combust))', 'tipos', r)
    r = re.sub(r'(?<![A-Za-zÀ-ÿ])sico-', 'físico-', r)
    return r
# ---- FIM NORMALIZACAO
