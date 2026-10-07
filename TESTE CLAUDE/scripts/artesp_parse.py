#!/usr/bin/env python3
"""ARTESP: atas (texto_artesp/*.txt) + inventario -> deliberacoes e votos por diretor.
Proveniencia: inferido (ata: "aprovacao dos presentes por unanimidade de votos"), nominal (diretoria que retirou de pauta, presenca/ausencia pela Constituicao), REVISAR (qualquer outro desfecho).
Uso: python3 -I artesp_parse.py artesp_inventario.json texto_artesp saida.json"""
import re, sys, json, os, unicodedata, collections
def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')
DIRS = {'barnabe': 'André Isper Rodrigues Barnabé', 'zanatto': 'Diego Albert Zanatto', 'rudnik': 'Fernanda Esbízaro Rodrigues Rudnik', 'carneiro': 'Raquel França Carneiro'}
SIGLA = {'PRE': 'André Isper Rodrigues Barnabé', 'DZ': 'Diego Albert Zanatto', 'FR': 'Fernanda Esbízaro Rodrigues Rudnik', 'RC': 'Raquel França Carneiro'}
def limpa(t):
    t = re.sub(r'https://sei\.sp\.gov\.br\S*\s+\d+/\d+', ' ', t)
    t = re.sub(r'\d\d/\d\d/\d{4}, \d\d:\d\d\s+SEI/GESP - \d+ - DOE: Ata \(Seção 1 - Normativo\)', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'Este documento pode ser verificado pelo c[óo]digo [\d.]+ Documento assinado digitalmente conforme MP n[ºo] 2\.200-2/2001, em https://www\.doe\.sp\.gov\.br/autenticidade(?: \d+/\d+)? que institui a Infraestrutura de Chaves P[úu]blicas \(ICP-Brasil\)\.', ' ', t)
    return t
def presentes(t):
    m = re.search(r'Constitui[çc][ãa]o:(.+?)(?:Aos \d|Passou-se|Verificado)', t)
    seg = m[1] if m else ''
    k = re.search(r'Aus[êe]ncias?\s+Justificadas?:?', seg)
    pre, aus = (seg[:k.start()], seg[k.end():]) if k else (seg, '')
    return [DIRS[x] for x in DIRS if x in norm(pre)], [DIRS[x] for x in DIRS if x in norm(aus)], bool(m)
def parse(tag, r, txt):
    t = limpa(txt); pres, aus, achou = presentes(t)
    meta = {'reuniao': tag, 'numero': r['numero'], 'data': r['data'][6:] + '-' + r['data'][3:5] + '-' + r['data'][:2], 'tipo': 'Extraordinária' if r['numero'] < 1000 else 'Ordinária', 'presentes': pres, 'ausentes': aus, 'constituicao_lida': achou}
    blocos = [m for m in re.finditer(r'(?<!\d)(\d{1,3})\.\s+Delibera[çc][ãa]o ARTESP n[ºo]\s*(\d+)\.?', t) if re.match(r'[\s.]*(?:\(Cancelad[oa]\)[\s.]*)?Processo\s+SEI', t[m.end():m.end() + 60], re.I)]
    unid = [(mm.start(), re.sub(r'\s+', ' ', mm[1]).strip()) for mm in re.finditer(r'((?:Superintend[êe]ncia|Ger[êe]ncia|Diretoria|Assessoria|Ouvidoria|Corregedoria|Procuradoria)[^.]{0,90}?(?:-|–)\s*[A-Z]{3,8}|Gabinete da Presid[êe]ncia)\.\s+(?=\d{1,3}\.\s+Delibera)', t)]
    D, V = [], []
    bl, notas = {}, {}
    reg = t.find('PARA REGISTRO'); reg = reg if reg >= 0 else len(t) + 1
    for i, m in enumerate(blocos):
        b = t[m.end(): blocos[i+1].start() if i+1 < len(blocos) else len(t)]
        if m.start() >= reg: notas[m[2]] = b[:400]; continue
        pr_ = re.search(r'Processo SEI! n[ºo]\s*([\d./-]+)', b); k_ = (m[2], pr_[1].rstrip('.') if pr_ else '')
        if k_ not in bl or len(b) > len(bl[k_][1]): bl[k_] = (m, b)
    for m, b in sorted(bl.values(), key=lambda x: x[0].start()):
        proc = re.search(r'Processo SEI! n[ºo]\s*([\d./-]+)', b); inte = re.search(r'Interessad[oa]s?:\s*(.+?)\s*Assunto:', b); ass = re.search(r'Assunto:\s*(.+?)(?:\s*Visto, relatado|\s*A mat[ée]ria foi|$)', b)
        unidade = ([u for pos_, u in unid if pos_ < m.start()] or [''])[-1]
        dm = re.search(r'DELIBERA\s+nos\s+seguintes\s+termos:\s*(.{20,600})', b); dispositivo = re.split(r'PUBLIQUE-SE', re.sub(r'\s+', ' ', dm[1]))[0][:500] if dm else ''
        bn = norm(b); canc = bool(re.match(r'[\s.]*\(Cancelad[oa]\)', b, re.I))
        if canc: res = 'CANCELADA (não votada)'
        elif 'foi retirada de pauta' in bn or 'retirada de pauta' in bn: res = 'RETIRADO DE PAUTA'
        elif 'por unanimidade de votos' in bn: res = 'APROVADO POR UNANIMIDADE'
        elif 'por maioria' in bn or 'diverg' in bn: res = 'MAIORIA/DIVERGÊNCIA (revisar)'
        else: res = 'SEM DESFECHO NO TEXTO'
        retirou = None
        mr = re.search(r'Diretoria\s+DIR-(\w\w)', b) if res == 'RETIRADO DE PAUTA' else None
        if mr: retirou = SIGLA.get(mr[1])
        d = {'reuniao': tag, 'data': meta['data'], 'deliberacao': int(m[2]), 'item': int(m[1]), 'processo': proc[1] if proc else '', 'interessado': (inte[1] if inte else '')[:200],
             'assunto': (ass[1] if ass else '')[:300], 'resultado': res, 'retirada_por': retirou or '', 'registro': notas.get(m[2], ''), 'unidade': unidade, 'dispositivo': dispositivo}
        D.append(d)
        if canc: continue
        for p in aus: V.append({'reuniao': tag, 'data': meta['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': p, 'voto': 'AUSENTE (justificada)', 'proveniencia': 'nominal'})
        for p in pres:
            if res == 'APROVADO POR UNANIMIDADE': v, pv = 'ACOMPANHOU', 'inferido'
            elif res == 'RETIRADO DE PAUTA': v, pv = ('RETIROU DE PAUTA', 'nominal') if p == retirou else ('SEM VOTO (retirado de pauta)', 'n/a')
            else: v, pv = 'REVISAR', 'REVISAR'
            V.append({'reuniao': tag, 'data': meta['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': p, 'voto': v, 'proveniencia': pv})
    return meta, D, V
if __name__ == '__main__':
    inv = [r for r in json.load(open(sys.argv[1])) if r['data'].endswith('2026')]; out = {'reunioes': [], 'deliberacoes': [], 'votos': []}
    for r in sorted(inv, key=lambda r: (r['numero'] > 1000, r['numero'])):
        tag = ('ORD' if r['numero'] > 1000 else 'S230_') + str(r['numero']); f = os.path.join(sys.argv[2], tag + '.txt')
        if not os.path.exists(f) or os.path.getsize(f) < 500:
            out['reunioes'].append({'reuniao': tag, 'numero': r['numero'], 'data': r['data'][6:] + '-' + r['data'][3:5] + '-' + r['data'][:2], 'tipo': 'Extraordinária' if r['numero'] < 1000 else 'Ordinária', 'presentes': [], 'obs': 'ATA NÃO BAIXADA/SEM TEXTO'}); continue
        m, D, V = parse(tag, r, open(f, encoding='utf8').read()); m['obs'] = '' if m['constituicao_lida'] else 'CONSTITUIÇÃO NÃO LIDA'
        out['reunioes'].append(m); out['deliberacoes'] += D; out['votos'] += V
    json.dump(out, open(sys.argv[3], 'w'), ensure_ascii=False, indent=1)
    print('reunioes', len(out['reunioes']), 'delib', len(out['deliberacoes']), 'votos', len(out['votos']))
    print(collections.Counter(d['resultado'] for d in out['deliberacoes'])); print(collections.Counter(v['proveniencia'] for v in out['votos']))
    print('problemas:', [(m['reuniao'], m['obs']) for m in out['reunioes'] if m.get('obs')])
