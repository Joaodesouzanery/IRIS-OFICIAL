#!/usr/bin/env python3
"""Classifica modal/tema/subtema de cada deliberação (regras) e mescla a revisão por IA (cache).
Uso: python3 -I scripts/temas.py            -> temas.json, temas_revisao_pendente.json
     python3 -I scripts/temas.py --medir     -> imprime cobertura/distribuição"""
import json, sys, os, collections, hashlib
sys.path.insert(0, os.path.dirname(__file__)); import taxonomia as T
anm, antt, art = (json.load(open(f)) for f in ('anm.json', 'antt.json', 'artesp_final.json')); rde = json.load(open('antt_rde270.json'))
EXTRAS = {sg: json.load(open(f)) for sg, f in (('ANPD', 'anpd.json'), ('ANVISA', 'anvisa_final.json'), ('ANP', 'anp.json'), ('ANTAQ', 'antaq.json'), ('ANATEL', 'anatel.json'), ('ANEEL', 'aneel.json')) if os.path.exists(f)}
LIMIAR = 0.45

def itens():
    for d in anm['deliberacoes']:
        if d['data'].startswith('2026'):
            yield 'ANM', d, {'assunto': d.get('assunto') or ('Aprovação da ata da reunião anterior' if d.get('tipo_item') == 'Aprovação de ata' else ''), 'interessado': d.get('interessado', ''), 'unidade': '', 'texto': d.get('voto_resumo', '')}
    for d in antt['deliberacoes']: yield 'ANTT', d, {'assunto': d.get('assunto', ''), 'interessado': d.get('interessado', ''), 'unidade': '', 'texto': d.get('decisao_texto', '')}
    for x in rde: yield 'ANTT', {'reuniao': 'RDE270', 'processo': x['processo'], 'tipo_item': 'Só voto do relator (sem ata)'}, {'assunto': x['objeto'], 'interessado': '', 'unidade': '', 'texto': x['encaminhamento']}
    for d in art['deliberacoes']: yield 'ARTESP', d, {'assunto': d.get('assunto', ''), 'interessado': d.get('interessado', ''), 'unidade': d.get('unidade', ''), 'texto': d.get('dispositivo', '')}
    for sg, x in EXTRAS.items():
        for d in x['deliberacoes']:
            un = f"{d.get('secao', '')}|{d.get('unidade', '')}" if sg == 'ANVISA' else (d.get('natureza') or '')
            yield sg, d, {'assunto': d.get('assunto', ''), 'interessado': d.get('interessado', ''), 'unidade': un, 'texto': d.get('decisao_texto', '')}

def chave(ag, d): return f"{ag}|{d['reuniao']}|{d.get('processo')}|{d.get('deliberacao') or ''}"

def classificar(ag, d, c):
    if d.get('tipo_item') == 'Aprovação de ata':
        return {'modal': 'Institucional e administrativo', 'tema': 'Aprovação de ata', 'subtema': 'Ata da reunião anterior', 'tipo_ato': 'Aprovação de ata', 'confianca': 1.0, 'termos': ['aprovação de ata'], 'fonte': 'regra'}
    if ag in T.SETOR:
        (tema, sub), ts, conf, tt = T.pontuar_setor(c, ag); modal = T.SETOR[ag]['modal']; alltxt = ' '.join([c['assunto'], c['interessado'], c['texto']])
        conf_tema = 0.0 if tema == 'Outros' else conf
        return {'modal': modal, 'tema': tema, 'subtema': sub, 'tipo_ato': T.tipo_ato(c), 'microtema_iris': T.microtema_iris(alltxt, ag), 'area_iris': T.area_iris(alltxt), 'confianca': conf, 'conf_tema': conf_tema, 'conf_modal': 1.0, 'termos': tt[:6], 'fonte': 'regra'}
    modal, ms, mt = T.pontuar_modal(c, ag)
    (tema, sub), ts, conf, tt = T.pontuar_tema(c, ag)
    alltxt = ' '.join([c['assunto'], c['interessado'], c['unidade'], c['texto']])
    if modal == 'Outros / não identificado' and tema in ('Gestão institucional e administrativa',): modal = 'Institucional e administrativo'
    if tema in ('Gestão institucional e administrativa',) and ag != 'ANM': modal = 'Institucional e administrativo'
    if ag == 'ARTESP' and T.norm(c['interessado']).startswith('agencia reguladora') and tema.startswith('Contratos de concess'):
        tema, sub, modal = 'Gestão institucional e administrativa', 'Contratação interna / licitação da agência', 'Institucional e administrativo'   # contrato da própria agência, não concessão
    conf_tema = 0.0 if tema == 'Outros' else conf
    if tema == 'Outros': conf = 0.0
    if modal.startswith('Outros'): conf = min(conf, 0.3)
    return {'modal': modal, 'tema': tema, 'subtema': sub, 'tipo_ato': T.tipo_ato(c), 'microtema_iris': T.microtema_iris(alltxt, ag), 'area_iris': T.area_iris(alltxt),
            'confianca': conf, 'conf_tema': conf_tema, 'conf_modal': (0.3 if modal.startswith('Outros') else min(1.0, ms / 8)), 'termos': (mt + tt)[:6], 'fonte': 'regra'}

def hash_item(ag, c): return hashlib.sha1(json.dumps([ag, c['assunto'], c['interessado'], c['unidade']], ensure_ascii=False).encode()).hexdigest()[:16]

def importar_ia(pasta):
    tax = json.load(open('taxonomia_fechada.json')); cache = json.load(open('temas_cache.json')) if os.path.exists('temas_cache.json') else {}
    n = ruins = 0
    for f in sorted(os.listdir(pasta)):
        if not f.startswith('resultado_'): continue
        for x in json.load(open(os.path.join(pasta, f)))['resultados']:
            if x['modal'] in tax['modais'] and x['tema'] in tax['temas'] and x['subtema'] in tax['temas'][x['tema']]: cache[x['hash']] = {k: x.get(k) for k in ('modal', 'tema', 'subtema', 'confianca', 'motivo')}; n += 1
            else: ruins += 1
    json.dump(cache, open('temas_cache.json', 'w'), ensure_ascii=False, indent=1); print('importados', n, 'rejeitados (fora da taxonomia)', ruins, '| cache total', len(cache))

if __name__ == '__main__':
    if '--importar-ia' in sys.argv: importar_ia(sys.argv[sys.argv.index('--importar-ia') + 1]); sys.exit()
    cache = json.load(open('temas_cache.json')) if os.path.exists('temas_cache.json') else {}
    out, pend = {}, []
    for ag, d, c in itens():
        r = classificar(ag, d, c); k = chave(ag, d); h = hash_item(ag, c); r['hash'] = h; r['tipo_item'] = d.get('tipo_item', '')
        if r['confianca'] < LIMIAR and d.get('tipo_item') != 'Aprovação de ata':
            if h in cache:
                ia = cache[h]; r['regra'] = f"{r['modal']} / {r['tema']} / {r['subtema']}"
                if r['conf_tema'] >= LIMIAR: r['modal'] = ia['modal']                      # regra segura no tema: IA só decide o modal
                else: r.update({k2: ia[k2] for k2 in ('modal', 'tema', 'subtema')})
                r['confianca'] = ia.get('confianca', r['confianca']); r['fonte'] = 'IA'; r['motivo_ia'] = ia.get('motivo', '')
                r['concorda_regra'] = (r['regra'] == f"{r['modal']} / {r['tema']} / {r['subtema']}")
            else: pend.append({'hash': h, 'agencia': ag, 'assunto': c['assunto'][:400], 'interessado': c['interessado'][:120], 'unidade': c['unidade'], 'texto': c['texto'][:350], 'regra': [r['modal'], r['tema'], r['subtema']]})
        out[k] = r
    # um item por hash para a IA
    vistos = {}; [vistos.setdefault(p['hash'], p) for p in pend]
    json.dump(out, open('temas.json', 'w'), ensure_ascii=False, indent=1); json.dump(list(vistos.values()), open('temas_revisao_pendente.json', 'w'), ensure_ascii=False, indent=1)
    n = collections.Counter(); 
    for k, r in out.items(): n[(k.split('|')[0], r['modal'])] += 1
    print('itens', len(out), '| baixa confiança sem IA (únicos):', len(vistos), '| classificados pela IA:', sum(1 for r in out.values() if r['fonte'] == 'IA'))
    if '--medir' in sys.argv:
        for ag in ['ANM', 'ANTT', 'ARTESP'] + list(EXTRAS):
            L = [r for k, r in out.items() if k.startswith(ag + '|')]
            print(f"\n== {ag}: {len(L)} itens | tema!=Outros: {sum(1 for r in L if r['tema'] != 'Outros')} | modal!=Outros: {sum(1 for r in L if not r['modal'].startswith('Outros'))} | conf>={LIMIAR}: {sum(1 for r in L if r['confianca'] >= LIMIAR)}")
            print(' modal:', collections.Counter(r['modal'] for r in L).most_common()); print(' tema :', collections.Counter(r['tema'] for r in L).most_common(14))
