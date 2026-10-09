#!/usr/bin/env python3
"""ANTT: lê o CABEÇALHO de todos os PDFs de voto/voto vista/declaração de voto (texto do PDF ou OCR do PDF-imagem) e grava a evidência por documento.
Entrada: manifesto_antt.json + texto_antt/ (pdftotext) + texto_antt_ocr/ (RapidOCR, scripts/ocr_pdf.py). Saída: antt_votos_pdf.json
Uso: python3 -I scripts/antt_votos_pdf.py manifesto_antt.json antt_votos_pdf.json
Cada item: reuniao, rotulo, url, sha256, via (texto|ocr|SEM TEXTO), tipo (voto|voto_vista|declaracao), prefixo/numero/ano, relatoria, vista (revisor),
processos, encaminhamento, conclusao (acompanha|diverge|?), chars.  O voto escrito do relator traz a PROPOSTA dele; não traz o voto dos demais diretores."""
import re, sys, json, os, unicodedata
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from antt_parse import ORDEM, PREFIXO, quem, norm

def lê(d, tag, ocr_dir='texto_antt_ocr'):
    """texto do PDF se tiver camada de texto (>300 chars); senão o OCR; senão ''"""
    if d.get('chars', 0) > 300: return open(d['texto'], encoding='utf8').read(), 'texto'
    o = f"{ocr_dir}/{tag}__{os.path.basename(d['arquivo'])}.txt"
    if os.path.exists(o) and os.path.getsize(o) > 0: return open(o, encoding='utf8').read(), 'ocr'
    return '', 'SEM TEXTO'

def campo(t, nome):
    m = re.search(nome + r'\s*[:;]\s*(.+)', t, re.I)
    return re.sub(r'\s+', ' ', m[1]).strip() if m else ''

def cabeca(t):
    h = t[:6000]
    r = {'relatoria': None, 'vista': None, 'numero_cab': None, 'ano_cab': None, 'processos': [], 'encaminhamento': '', 'objeto': ''}
    rel = campo(h, r'RELATORIA'); vis = campo(h, r'(?:VISTA|REVIS[ÃA]O|REVISOR)')
    for k, v in (('relatoria', rel), ('vista', vis)):
        if not v: continue
        dd = [PREFIXO[x] for x in re.findall(r'\b(DG|DFQ|DLA|DAA|DAB|DSM|DMF)\b', v.upper()) if x in PREFIXO]
        if not dd and re.search(r'diretoria\s*geral', norm(v)): dd = [ORDEM[0]]
        if not dd: dd = quem(v)
        r[k] = dd[0] if dd else None
    m = re.search(r'N[ÚU]MERO\s*:?\s*(\d+)\s*/\s*(\d{4})', h, re.I) or re.search(r'VOTO\s+(?:VISTA\s+)?D\w+\s+N[ºo°]?\s*(\d+)', h, re.I)
    if m: r['numero_cab'] = int(m[1]); r['ano_cab'] = int(m[2]) if m.lastindex and m.lastindex > 1 else 2026
    # processos: bloco "PROCESSO(S): ..." (pode ter vários)
    pm = re.search(r'PROCESSO\s*\(?S?\)?\s*:?\s*([^\n]+(?:\n[^\n]*\d{4,5}\.\d+[^\n]*)?)', h, re.I)
    if pm: r['processos'] = list(dict.fromkeys(re.findall(r'\d{5}\.\d{6}/\d{4}-\d{2}', pm[1])))
    if not r['processos']: r['processos'] = list(dict.fromkeys(re.findall(r'\d{5}\.\d{6}/\d{4}-\d{2}', h)))[:3]
    r['encaminhamento'] = campo(h, r'ENCAMINHAMENTO')[:120]
    r['objeto'] = campo(h, r'OBJET[OoÓ]')[:300]
    return r

def conclusao(t):
    """voto vista / declaração: o revisor acompanha o relator? (frases da PROPOSIÇÃO FINAL / alinhamento)"""
    n = re.sub(r'\s+', ' ', norm(t))
    fim = n[-6000:]
    if re.search(r'(?:acompanho|acompanha integralmente|segue o encaminhamento|alinho-me|ratifico a minha concordancia|concordancia integral|em convergencia)', fim) or re.search(r'nao apresento divergencias', n): return 'acompanha'
    if re.search(r'divirjo|divergir|voto divergente|dissent', n): return 'diverge'
    return '?'

def main(man, out):
    R = json.load(open(man)); L = []
    for r in R:
        for d in r['docs']:
            if d['tipo'] not in ('voto', 'outro'): continue
            t, via = lê(d, r['tag'])
            item = {'reuniao': r['tag'], 'rotulo': d['rotulo'], 'url': d['url'], 'sha256': d['sha256'], 'via': via, 'chars': len(t)}
            rot = norm(d['rotulo'])
            item['tipo'] = 'declaracao' if 'declaracao' in rot else 'voto_vista' if 'vista' in rot else 'voto'
            x = re.search(r'\b(dg|dfq|dla|daa|dab|dsm|dmf)\s+(\d+)\s*-\s*(\d{4})', rot)
            if x: item.update(prefixo=x[1].upper(), numero_rotulo=int(x[2]), ano_rotulo=int(x[3]))
            if via != 'SEM TEXTO':
                c = cabeca(t); item.update(c); item['processos_corpo'] = list(dict.fromkeys(re.findall(r'\d{5}\.\d{6}/\d{4}-\d{2}', t)))[:40]
                if item['tipo'] != 'voto': item['conclusao'] = conclusao(t)
            item['autor'] = PREFIXO.get(item.get('prefixo'))          # quem assina (prefixo do rótulo: DG/DFQ/DLA/DAA/DAB/DSM/DMF)
            if item['tipo'] == 'voto' and not item.get('relatoria') and via != 'SEM TEXTO': item['relatoria'] = item['autor']; item['relatoria_via'] = 'rotulo'
            L.append(item)
    json.dump(L, open(out, 'w'), ensure_ascii=False, indent=1)
    import collections
    print('documentos', len(L), dict(collections.Counter((i['via'], i['tipo']) for i in L)))
    sem = [i for i in L if i['via'] == 'SEM TEXTO']; print('sem texto (OCR ainda não feito):', len(sem))
    bad = [i for i in L if i['via'] != 'SEM TEXTO' and i['tipo'] == 'voto' and (not i.get('relatoria') or not i.get('processos'))]; print('cabeçalho incompleto:', len(bad), [(i['reuniao'], i['rotulo']) for i in bad][:12])

if __name__ == '__main__': main(sys.argv[1], sys.argv[2])
