#!/usr/bin/env python3
"""ANTT: auditoria INDEPENDENTE do antt.json. NÃO importa antt_parse/antt_finalizar: lê só os textos (ata em texto_antt/, voto em texto_antt/ ou OCR em texto_antt_ocr/)
com regex próprias e compara com o JSON. Duas partes:
  1) varredura (todos os itens): estrutura, resultado, relatoria, rótulos, presença, citações da revisão curada;
  2) amostra de itens ALTERADOS (semente fixa): `--amostra N SEED` imprime o TEXTO-FONTE de cada item antes de qualquer valor do JSON;
     `--confere esperado.json` compara o que foi lido por humano (esperado antes de ver o JSON) com o JSON.
Uso: python3 -I scripts/antt_auditoria.py antt.json antt_antes_ocr.json manifesto_antt.json antt_votos_pdf.json antt_revisao.json [--amostra N SEED | --confere esperado.json]"""
import re, sys, json, glob, random, collections, unicodedata
def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s.lower().replace('ﬁ', 'fi')) if unicodedata.category(c) != 'Mn')
def flat(s): return re.sub(r'\s+', ' ', s.replace('​', '').replace('‌', '')).strip()
PRE = {'DG': 'Guilherme', 'DFQ': 'Felipe', 'DLA': 'Lucas', 'DAA': 'Alex', 'DAB': 'Alessandro', 'DSM': 'Severino', 'DMF': 'Marcelo'}
PRIM = ['Guilherme', 'Felipe', 'Lucas', 'Alex', 'Alessandro', 'Severino', 'Marcelo']
ROT_OK = ('RELATOR', 'ACOMPANHOU', 'DIVERGIU', 'AUSENTE', 'IMPEDIDO', 'SEM VOTO', 'PEDIU VISTA', 'VOTOU', 'NÃO PARTICIPOU', 'VISTA COLETIVA', 'REVISAR')
def blocos(tag):
    """itens da ata, lidos do zero: [(processo, texto_da_decisao)] — independente do parser"""
    f = glob.glob(f'texto_antt/{tag}__ata_*')
    if not f: return []
    t = flat(open(f[0], encoding='utf8').read())
    t = re.sub(r'Ata da Reuni[ãa]o[^.]{0,90}?SEI \d+\.\d+/\d{4}-\d+ / pg\. \d+', ' ', t)
    out = []
    ms = list(re.finditer(r'\d+\.\d+\.\d+ Processo(?: n[ºo°]|:)? ?:? ?(\d{5}\.\d{6}/\d{4}-\d{2})', t))
    for i, m in enumerate(ms):
        seg = t[m.end(): ms[i + 1].start() if i + 1 < len(ms) else len(t)]
        d = re.search(r'D ?ecis[ãa]o: ?(.*)', seg); d = d[1] if d else ''
        d = re.split(r'Dado o encerramento| \d+\.\d+ (?:DIRETOR|GUILHERME|FELIPE|LUCAS|ALEX|ALESSANDRO|SEVERINO|MARCELO)| \d+\. (?:MAT[ÉE]RIAS|ASSUNTOS)', d)[0]
        out.append((m[1], d.strip()))
    return out
def resultado_lido(dec):
    n = norm(dec)
    if re.search(r'vista cole\s?(?:ti)?\s?va', n): return 'vista coletiva'
    if re.search(r'(pediu vista|pedido de vista|solicit\w+ vista)', n) and 'voto vista' not in n: return 'vista'
    if re.search(r're\s?(?:ti)?\s?rad[oa]', n): return 'retirado'
    a, b = n.find('por unanimidade'), n.find('por maioria')
    if b >= 0 and (a < 0 or b < a): return 'maioria'
    if a >= 0: return 'unanimidade'
    return '?'
MAPA = {'APROVADO POR UNANIMIDADE': 'unanimidade', 'APROVADO POR MAIORIA': 'maioria', 'RETIRADO DE PAUTA': 'retirado', 'SOBRESTADO (vista)': 'vista', 'SOBRESTADO (vista coletiva)': 'vista coletiva'}
def varredura(A, M, VP, REV):
    falhas = collections.defaultdict(list); n = collections.Counter()
    D = collections.defaultdict(list)
    for d in A['deliberacoes']: D[d['reuniao']].append(d)
    V = collections.defaultdict(list)
    for v in A['votos']: V[(v['reuniao'], v['processo'])].append(v)
    pdf_rel = {}
    for i in VP:
        if i['tipo'] == 'voto' and i.get('relatoria') and i.get('prefixo'): pdf_rel.setdefault((i['prefixo'], i['numero_rotulo'], i['ano_rotulo']), set()).add(i['relatoria'].split()[0])
    for r in A['reunioes']:
        if r.get('obs'): continue
        tag = r['reuniao']; bl = blocos(tag); n['reunioes'] += 1
        procs_ata = [p for p, _ in bl]; procs_json = [d['processo'] for d in D[tag]]
        n['E1 itens ata=json'] += 1
        if procs_ata != procs_json: falhas['E1 itens da ata ≠ itens do JSON'].append((tag, len(procs_ata), len(procs_json)))
        roster = set(r['presentes']) | set(r['ausentes'])
        for p, dec in bl:
            d = next((x for x in D[tag] if x['processo'] == p), None)
            if not d: continue
            n['itens'] += 1
            rl = resultado_lido(dec); n['E2 resultado'] += 1
            if MAPA.get(d['resultado']) != rl: falhas['E2 resultado do JSON ≠ lido do texto'].append((tag, p, d['resultado'], rl))
            vs = V[(tag, p)]; n['E3 1 voto por diretor da presença'] += 1
            if {v['diretor'] for v in vs} != roster or len(vs) != len(roster): falhas['E3 votos ≠ presença'].append((tag, p, len(vs), len(roster)))
            for v in vs:
                n['E4 rótulo permitido'] += 1
                if not v['voto'].startswith(ROT_OK): falhas['E4 rótulo fora da lista'].append((tag, p, v['voto']))
            # relatoria: prefixo do voto acolhido no texto
            m = re.search(r'(?:acolheu a proposi[cç][aã]o d[oa] \w+,? apresentad[oa] no|Conforme) Voto (Vista )?(D[A-Z]+) ?- ?(\d+)/(\d{4})', dec) or re.search(r'Voto (Vista )?(D[A-Z]+) ?- ?(\d+)/(\d{4})', dec)
            rels = [v for v in vs if v['voto'].startswith('RELATOR')]
            n['E5 relator'] += 1
            if d['resultado'] != 'RETIRADO DE PAUTA' and d['resultado'] != 'SOBRESTADO (vista coletiva)':
                fora = any(e['reuniao'] == tag and e['processo'] == p and e.get('relator') not in roster for e in REV)   # relator original fora da presença (revisão curada)
                if len(rels) != 1 and not (d['resultado'].startswith('SOBRESTADO') and not rels) and not (fora and not rels): falhas['E5 nº de linhas RELATOR ≠ 1'].append((tag, p, [x['diretor'].split()[0] for x in rels]))
            if m and not m[1] and not any(e['reuniao'] == tag and e['processo'] == p for e in REV) and (d.get('relator') or '').split()[0:1] != [PRE.get(m[2])]: falhas['E5 relator do JSON ≠ prefixo do voto citado'].append((tag, p, m[0], d.get('relator')))
            if m and not m[1]:
                n['E6 relatoria do PDF'] += 1
                pr = pdf_rel.get((m[2], int(m[3]), int(m[4])))
                if pr and PRE.get(m[2]) not in pr: falhas['E6 RELATORIA do PDF ≠ prefixo citado na ata'].append((tag, p, m[0], sorted(pr)))
            # nominais que exigem palavra no texto
            nd = norm(dec)
            for v in vs:
                if v['voto'] == 'PEDIU VISTA' and not re.search(r'vista', nd): falhas['E7 PEDIU VISTA sem a palavra vista'].append((tag, p, v['diretor']))
                if v['voto'].startswith('DIVERGIU') and 'diverg' not in nd: falhas['E7 DIVERGIU sem a palavra divergiu'].append((tag, p, v['diretor']))
                if v['voto'].startswith('IMPEDIDO') and 'impedid' not in nd: falhas['E7 IMPEDIDO sem a palavra impedido'].append((tag, p, v['diretor']))
                if v['voto'].startswith('AUSENTE') and v['diretor'] not in r['ausentes'] and 'ausente' not in nd and not re.search(r'a par\s?r do item', flat(open(glob.glob(f'texto_antt/{tag}__ata_*')[0], encoding='utf8').read())[:4000]): falhas['E7 AUSENTE fora da lista de ausentes e sem "ausente" no texto'].append((tag, p, v['diretor']))
                if v['proveniencia'] == 'inferido' and v['voto'].startswith('ACOMPANHOU') and rl not in ('unanimidade', 'maioria'): falhas['E8 ACOMPANHOU inferido fora de unanimidade/maioria'].append((tag, p, v['diretor'], rl))
            if rl == 'unanimidade':
                n['E9 unanimidade sem REVISAR'] += 1
                if any(v['voto'] == 'REVISAR' for v in vs): falhas['E9 REVISAR numa unanimidade'].append((tag, p))
    # E10: citações da revisão curada existem nos textos-fonte
    for e in REV:
        for g, ph in e.get('checar', []):
            n['E10 citação da revisão'] += 1
            ok = any(flat(ph).lower() in flat(open(f, encoding='utf8').read()).lower() for f in glob.glob(g))
            if not ok: falhas['E10 citação da revisão não achada'].append((e['reuniao'], e['processo'], g, ph))
    return n, falhas
def mudancas(A, B):
    """linhas de voto que diferem entre antes (B) e depois (A), por (reuniao, processo, diretor); mais campos de deliberação"""
    kb = {(v['reuniao'], v['processo'], v['diretor']): v for v in B['votos']}; out = []
    for v in A['votos']:
        o = kb.get((v['reuniao'], v['processo'], v['diretor']))
        if o is None or (o['voto'], o['proveniencia']) != (v['voto'], v['proveniencia']): out.append((v, o))
    dd = {(d['reuniao'], d['processo']): d for d in B['deliberacoes']}; dl = []
    for d in A['deliberacoes']:
        o = dd.get((d['reuniao'], d['processo']))
        if o and any(o[f] != d[f] for f in ('relator', 'resultado', 'decisao_texto')): dl.append((d, o))   # inclui texto da decisão aparado (fecho/assinaturas da ata saíram)
    return out, dl
def main():
    a = sys.argv[1:]
    A, B, M, VP, REV = (json.load(open(a[i])) for i in range(5))
    if '--amostra' in a:
        n, seed = int(a[a.index('--amostra') + 1]), int(a[a.index('--amostra') + 2])
        vs, dl = mudancas(A, B)
        itens = sorted({(v['reuniao'], v['processo']) for v, _ in vs} | {(d['reuniao'], d['processo']) for d, _ in dl})
        print('itens alterados (voto, relator, resultado ou texto da decisão):', len(itens))
        random.Random(seed).shuffle(itens)
        for tag, p in itens[:n]:
            print('=' * 100); print(tag, p)
            for q, dec in blocos(tag):
                if q == p: print('ATA:', dec[:1500])
            for i in VP:
                if p in (i.get('processos') or []) and i['reuniao'] in (tag,) or (p in (i.get('processos') or []) and i['tipo'] != 'voto' and i['reuniao'] == tag): print('PDF:', i['reuniao'], i['rotulo'], i['via'], 'relatoria=', i.get('relatoria'), 'vista=', i.get('vista'), 'concl=', i.get('conclusao'))
        return
    if '--confere' in a:
        E = json.load(open(a[a.index('--confere') + 1])); ok = tot = 0; ruins = []
        V = {(v['reuniao'], v['processo'], v['diretor'].split()[0]): v for v in A['votos']}
        for item, exp in E.items():
            tag, p = item.split('|')
            for dire, (lab, prov) in exp.items():
                tot += 1; v = V.get((tag, p, dire))
                if v and v['voto'].startswith(lab) and v['proveniencia'] == prov: ok += 1
                else: ruins.append((item, dire, (lab, prov), (v['voto'][:40], v['proveniencia']) if v else None))
        print(f'itens esperados {len(E)}; linhas conferidas {tot}; corretas {ok} ({100 * ok / max(1, tot):.1f}%)')
        itens_ok = len(E) - len({r[0] for r in ruins}); print(f'itens 100% corretos {itens_ok}/{len(E)} ({100 * itens_ok / max(1, len(E)):.1f}%)')
        for r in ruins: print('  ERRO', r)
        return
    n, f = varredura(A, M, VP, REV)
    print('verificações:', dict(n)); tot = sum(n[k] for k in n if k.startswith('E'))
    print('falhas por regra:', {k: len(v) for k, v in f.items()}, '— total de checagens', tot, '— falhas', sum(len(v) for v in f.values()))
    for k, v in f.items():
        print(' ', k)
        for x in v[:20]: print('    ', x)
if __name__ == '__main__': main()
