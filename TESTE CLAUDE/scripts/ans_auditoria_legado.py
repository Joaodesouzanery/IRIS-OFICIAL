"""[ESCOPO LEGADO: reunioes SEM ata oficial (641-644, extras 9-12); as reunioes com ata usam ans_auditoria.py] ANS: amostra estratificada (semente fixa) de itens de ans.json com o TEXTO-FONTE antes do JSON, para auditoria manual campo a campo.
Uso: python3 -I scripts/ans_auditoria.py ans.json [N=44] [semente=2026]   (o veredito humano vai em ans_auditoria.json)
Ordem de cada cartao: 1) texto da pauta/pagina/extrato 2) so depois o JSON gerado."""
import sys, json, random, re, collections
d = json.load(open(sys.argv[1])); N = int(sys.argv[2]) if len(sys.argv) > 2 else 44; SEM = int(sys.argv[3]) if len(sys.argv) > 3 else 2026
man = json.load(open('manifesto_ans.json')); V = d['votos']
COM_ATA = {'DICOL' + m['ref'] if m['ref'][0] != 'X' else 'DICOLE' + m['ref'][1:] for m in man if m['tipo'] == 'ata_dicol' and m['ok']}
D = [x for x in d['deliberacoes'] if x['reuniao'] not in COM_ATA]
vb = collections.defaultdict(list)
for v in V: vb[(v['reuniao'], v['processo'], v['deliberacao'])].append(v)
def estrato(x):
    if x['processo'].startswith('BLOCAO') and x['tipo_item'] == 'Deliberação': return 'blocao'
    if x['tipo_item'] == 'Retirada de pauta': return 'retirada'
    if x['tipo_item'] == 'Informe': return 'informe'
    if x['tipo_item'] == 'Aprovação de ata': return 'ata'
    if x['resultado'].startswith(('RESULTADO NÃO', 'REUNIÃO AINDA')): return 'sem_resultado'
    if 'unanimidade' in x['resultado']: return 'extrato'
    return 'pagina'
PESO = {'pagina': 14, 'extrato': 6, 'blocao': 6, 'ata': 6, 'informe': 3, 'retirada': 1, 'sem_resultado': 8}
random.seed(SEM); g = collections.defaultdict(list)
for x in D: g[estrato(x)].append(x)
am = []
for k, n in PESO.items():
    L = sorted(g[k], key=lambda x: (x['reuniao'], x['item_n'])); random.shuffle(L); am += [(k, x) for x in L[:n]]
am = am[:N]
def fonte_txt(x):
    out = []
    ref = x['reuniao'].replace('DICOLE', 'X').replace('DICOL', '')
    for m in man:
        if not m['ok'] or not m['texto']: continue
        r = m['ref'] if not m['ref'].startswith('X') else 'X%02d' % int(m['ref'][1:])
        if r != ref and not (m['tipo'] == 'pauta_linkada' and ref == '641'): continue
        t = open(m['texto'].split(' (VAZIO')[0], encoding='utf8').read()
        if m['tipo'] in ('pauta', 'pauta_linkada'):
            if m['tipo'] == 'pauta_linkada' and 'Pauta_aberta' in m['url']: continue
            if x['processo'].startswith('BLOCAO'): out.append(f"[{m['tipo']} {m['url'].split('/')[-1]}] blocão: {len(set(re.findall(r'[0-9]{5}[.][0-9]{6}/[0-9]{4}-[0-9]{2}', t.split('BLOCÃO')[-1].split('ATUALIZA')[0])))} processos distintos após 'BLOCÃO'")
            else:
                n_ = x['item_n']; mm = re.search(r'(?ms)^\s*' + re.escape(n_) + r'\)\s+(.*?)(?=^\s*\d+\)\s|\bBLOCÃO)', t)
                if mm: out.append(f"[pauta {m['url'].split('/')[-1]}] {n_}) " + re.sub(r'\s+', ' ', mm[1]))
        elif m['tipo'] == 'extrato':
            i = t.find(x['processo'])
            if i < 0: continue
            out.append(f"[extrato {m['url'].split('/')[-1]}] " + re.sub(r'\s+', ' ', t[:900])[250:] + ' ... ' + (re.sub(r'\s+', ' ', t[max(0, i - 30):i + 700]) if i >= 0 else ''))
    return out
def pagina_txt(x):
    for m in man:
        if m['formato'] == 'html' and re.search(r'deliberacoes-da-' + x['reuniao'][5:] + r'a-reuniao', m['url']):
            t = re.sub(r'<[^>]+>', ' ', open(m['arquivo_local'], encoding='utf8').read()); t = re.sub(r'\s+', ' ', t)
            t = t[:t.find('Categoria', t.find('INÍCIO'))]
            i = t.find('presença'); j = t.find('INÍCIO')
            ini = t[i - 20:i + 330]
            if x['processo'].startswith('BLOCAO'): seg = t[t.find('BLOCÃO'):]
            elif x.get('minuto_video'):
                mm = x['minuto_video'].lstrip('0:') ; k = t.find(x['minuto_video'][3:]) if t.find(x['minuto_video']) < 0 else t.find(x['minuto_video'])
                seg = t[k:k + 900]; seg = re.split(r'\d{1,2}: ?\d{2}:\d{2} [–-] (?!ITENS? ' + x['item_n'] + r')', seg[10:], 1)[0] if False else seg
            else: seg = ''
            return [f"[página {m['url'].split('/')[-1]}] PRESENÇA: ..." + ini + ' ... ITEM: ' + seg[:600]]
    return []
for i, (k, x) in enumerate(am, 1):
    print('=' * 100); print(f"#{i} estrato={k} {x['reuniao']} item {x['item_n']}")
    print('--- TEXTO-FONTE'); [print(' ', s[:2600]) for s in fonte_txt(x)]; [print(' ', s[:4200]) for s in pagina_txt(x)]
    print('--- JSON'); vs = vb[(x['reuniao'], x['processo'], x['deliberacao'])]
    print(' ', {k_: x[k_] for k_ in ('data', 'processo', 'tipo_item', 'relator', 'secao', 'resultado')}, '| partes:', [(p['modo'], p['vencidos']) for p in x['partes']])
    print('  votos:', [(v['diretor'].split()[0], v['voto'], v['proveniencia']) for v in vs])
