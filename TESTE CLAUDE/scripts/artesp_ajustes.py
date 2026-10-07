#!/usr/bin/env python3
"""ARTESP: aplica correcoes comprovadas pelos PDFs de Deliberacao (conciliacao) sobre artesp.json.
 1) numero de deliberacao digitado errado na ata (duplicado) -> numero do PDF, pelo mesmo processo
 2) ata publicada em reuniao errada (243a traz a ata da 244a) -> deliberacoes da 243a lidas dos PDFs (OCR), presenca = assinantes
Uso: python3 -I artesp_ajustes.py artesp.json artesp_conciliacao.json texto_artesp_ocr artesp_final.json"""
import json, sys, re, glob, collections
art = json.load(open(sys.argv[1])); con = json.load(open(sys.argv[2])); ocr = sys.argv[3]
reun = {m['reuniao']: m for m in art['reunioes']}
log = []
# --- 2) 243a
m243 = reun['S230_243']
if any(m['obs'] == '' and 'ATA DA 244' in open('texto_artesp/S230_243.txt', encoding='utf8').read()[:2500] for m in [m243]):
    art['deliberacoes'] = [d for d in art['deliberacoes'] if d['reuniao'] != 'S230_243']; art['votos'] = [v for v in art['votos'] if v['reuniao'] != 'S230_243']
    m243['obs'] = 'ATA PUBLICADA NESTA LINHA É A DA 244ª (erro de publicação da ARTESP); deliberações lidas dos PDFs de Deliberação (OCR); presença = diretores assinantes'
    m243['presentes'] = list(reun['S230_244']['presentes']); log.append('S230_243: ata trocada; removidas deliberações copiadas da 244ª')
    for f in sorted(glob.glob(f'{ocr}/DELIB_*.txt')):
        num = int(re.search(r'DELIB_(\d+)', f)[1]); t = re.sub(r'\s+', ' ', open(f, encoding='utf8').read())
        pr = re.search(r'Processo SEI?[!lI]? n\W{0,2}\s*([\d./-]{10,})', t); ass = re.search(r'Assunto:\s*(.+?)\s*Visto, relatado', t); it = re.search(r'Interessado:\s*(.+?)\s*(?:Assunto:|Visto)', t)
        unan = 'unanimidade' in t.lower()
        d = {'reuniao': 'S230_243', 'data': '2026-07-24', 'deliberacao': num, 'item': 0, 'processo': pr[1].rstrip('.') if pr else '', 'interessado': (it[1] if it else '')[:200], 'assunto': (ass[1] if ass else '')[:300],
             'resultado': 'APROVADO POR UNANIMIDADE' if unan else 'SEM DESFECHO NO TEXTO', 'retirada_por': '', 'registro': 'lida do PDF da Deliberação (OCR); ata da reunião não publicada corretamente'}
        art['deliberacoes'].append(d)
        for p in m243['presentes']: art['votos'].append({'reuniao': 'S230_243', 'data': d['data'], 'processo': d['processo'], 'deliberacao': num, 'diretor': p, 'voto': 'ACOMPANHOU' if unan else 'REVISAR', 'proveniencia': 'inferido' if unan else 'REVISAR'})
        log.append(f'S230_243: deliberação {num} reconstruída do PDF')
# --- 1) numeros duplicados na ata corrigidos pelo PDF
cnt = collections.Counter(d['deliberacao'] for d in art['deliberacoes']); nums_ata = set(cnt)
zdocs = collections.defaultdict(list)
for z in con['docs']: zdocs[z['processo'].rstrip('.')].append(z['numero'])
for d in art['deliberacoes']:
    if cnt[d['deliberacao']] > 1 and d['processo']:
        alt = [n for n in zdocs.get(d['processo'].rstrip('.'), []) if n not in nums_ata]
        if len(set(alt)) == 1:
            log.append(f"{d['reuniao']}: deliberação {d['deliberacao']} -> {alt[0]} (processo {d['processo']}, número do PDF)")
            for v in art['votos']:
                if v['reuniao'] == d['reuniao'] and v['processo'] == d['processo'] and v.get('deliberacao') == d['deliberacao']: v['deliberacao'] = alt[0]
            d['numero_na_ata'] = d['deliberacao']; d['deliberacao'] = alt[0]
json.dump(art, open(sys.argv[4], 'w'), ensure_ascii=False, indent=1)
art['_log'] = log; print('\n'.join(log)); print('delib', len(art['deliberacoes']), 'votos', len(art['votos']))
