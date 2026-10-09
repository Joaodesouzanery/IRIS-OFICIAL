"""ANS: amostra estratificada (semente fixa) de itens de ans.json para auditoria manual campo a campo, TEXTO-FONTE ANTES DO JSON.
Uso: python3 -I scripts/ans_auditoria.py ans.json [N=44] [semente=2026] [escopo=ata|legado]
  escopo=ata    (padrao) so itens das reunioes com ATA OFICIAL (632-640 e extraordinarias 1-8): cartao = trecho da ata (pdftotext direto do PDF, SEM o pipeline) -> JSON
  escopo=legado delega para scripts/ans_auditoria_legado.py (reunioes sem ata; pauta/pagina/extrato)
O veredito humano (campo a campo) vai em ans_auditoria.json. Este script NAO importa o parser nem o ans_ata."""
import sys, json, random, re, collections, subprocess, glob, os
d = json.load(open(sys.argv[1])); N = int(sys.argv[2]) if len(sys.argv) > 2 else 44; SEM = int(sys.argv[3]) if len(sys.argv) > 3 else 2026
ESC = sys.argv[4] if len(sys.argv) > 4 else 'ata'
man = json.load(open('manifesto_ans.json')); D = d['deliberacoes']; V = d['votos']
vb = collections.defaultdict(list)
for v in V: vb[(v['reuniao'], v['processo'], v['deliberacao'])].append(v)
ATA_PDF = {}
for m in man:
    if m['tipo'] == 'ata_dicol' and m['ok']: ATA_PDF[m['ref']] = m['arquivo_local']
def ref_de(x): return x['reuniao'].replace('DICOLE', 'X').replace('DICOL', '')
def texto_ata(ref):
    out = subprocess.run(['pdftotext', '-layout', ATA_PDF[ref], '-'], capture_output=True, text=True).stdout   # extracao DIRETA do PDF (independente do pipeline)
    return re.sub(r'Ata de Reunião - DICOL.*?/ pg\. \d+', ' ', re.sub(r'\s+', ' ', out))
CACHE = {}; VISTOS = set()
def ata_txt(ref):
    if ref not in CACHE: CACHE[ref] = texto_ata(ref)
    return CACHE[ref]
def estrato(x):
    if x['processo'].startswith('BLOCAO'): return 'blocao_agregado'
    if x['tipo_item'] == 'Retirada de pauta': return 'retirada'
    if x['tipo_item'] == 'Vista': return 'vista'
    if x['tipo_item'] == 'Informe': return 'informe'
    if x['tipo_item'] == 'Aprovação de ata': return 'ata'
    if x.get('impedidos'): return 'impedimento'
    if x['secao'].startswith('Blocão'): return 'blocao_excecao'
    if 'ressalv' in x['decisao_texto'].lower(): return 'ressalva'
    if x.get('sessao') == 'Reservada': return 'sessao_reservada'
    return 'sessao_aberta'
PESO = {'sessao_aberta': 8, 'sessao_reservada': 10, 'impedimento': 4, 'retirada': 2, 'vista': 2, 'informe': 3, 'ata': 3, 'blocao_agregado': 2, 'blocao_excecao': 2, 'ressalva': 1, 'blocao_decisao': 9}
random.seed(SEM)
if ESC == 'ata':
    pop = [x for x in D if ref_de(x) in ATA_PDF]
    g = collections.defaultdict(list)
    for x in pop: g[estrato(x)].append(x)
    am = []
    for k, n in PESO.items():
        if k == 'blocao_decisao':
            todas = [(x, r) for x in pop if x['processo'].startswith('BLOCAO') for r in x['decisoes_individuais']]
            random.shuffle(todas); am += [(k, x, r) for x, r in todas[:n]]; continue
        L = sorted(g[k], key=lambda x: (x['reuniao'], str(x['item_n']))); random.shuffle(L); am += [(k, x, None) for x in L[:n]]
    am = am[:N]
    for i, (k, x, r) in enumerate(am, 1):
        ref = ref_de(x); t = ata_txt(ref)
        print('=' * 100); print(f"#{i} estrato={k} {x['reuniao']} item {x['item_n']}  [ata sha256 {next(m['sha256'][:12] for m in man if m['tipo']=='ata_dicol' and m['ref']==ref)}]")
        print('--- TEXTO-FONTE (pdftotext direto do PDF da ata)')
        if ref not in VISTOS: i0 = t.find('contou com a presença'); print('  CABECALHO:', t[i0 - 120:i0 + 520]); VISTOS.add(ref)
        if k == 'blocao_decisao':
            proc = r['processo'].replace('.', '').replace('/', '').replace('-', '')
            m = re.search(r'(?<![\d])' + re.escape(r['processo']), t)
            if not m: m = re.search(r'\d{5}\.\d{6}/\d{4}-\s?\d{2}'.replace('\\d{5}', r['processo'][:5]), t)
            j = m.start() if m else -1
            print('  DECISAO NA ATA (600 chars antes do numero do processo):', t[max(0, j - 600):j + 40])
        elif k == 'blocao_agregado':
            a = t.find('Circuito Deliberativo'); print('  INICIO DO BLOCAO:', t[a:a + 500]); print('  FIM:', t[t.find('Feitas essas') - 400:t.find('Feitas essas')])
            print('  conferir: n decisoes =', len(re.findall(r'(?:Aprovad[oa]s? por unanimidade|Item retirado de pauta|Apreciação do voto)', t[a:])), '| processos distintos no AEP =', len(set(re.sub(r'\D', '', p) for p in re.findall(r'\d{5}\.\d{6}/\d{4}-\s?\d{2}', t[a:]))))
        else:
            if x['processo'].startswith(('ATA ', 'DICOL')) or x['tipo_item'] in ('Informe', 'Aprovação de ata'):
                key = x['assunto'][:60]; j = t.find(re.sub(r'\s+', ' ', key)[:50])
            elif x['secao'].startswith('Blocão'):
                j = -1; m = re.search(re.escape(x['processo']), t); j = m.start() - 700 if m else -1
            else:
                m = re.search(r'Processo: ?' + re.escape(x['processo']), t); j = m.start() if m else t.find(x['processo'])
            print('  ITEM NA ATA:', t[max(0, j):j + 1500] if j >= 0 else '(nao localizado pelo processo; ler a ata)')
        print('--- JSON')
        if k == 'blocao_decisao': print('  decisao individual:', {a: (b if a != 'resumo' else b[:300]) for a, b in r.items()})
        else:
            print(' ', {a: x[a] for a in ('data', 'processo', 'tipo_item', 'relator', 'secao', 'resultado') if a in x}, '| impedidos:', x.get('impedidos'), '| relator_prov:', x.get('relator_proveniencia'), '| partes:', [(p['modo']) for p in x['partes']][:6])
            if k == 'blocao_agregado': print('  n_decisoes_ata', x['n_decisoes_ata'], 'n_processos_ata', x['n_processos_ata'], 'classes', x['classes'], 'subsecoes', x['subsecoes'])
            print('  votos:', [(v['diretor'].split()[0], v['voto'][:40], v['proveniencia']) for v in vb[(x['reuniao'], x['processo'], x['deliberacao'])]])
    sys.exit(0)
# escopo legado (reunioes sem ata: 641-644, extras 9-12): usa scripts/ans_auditoria_legado.py (cartoes pauta/pagina/extrato da fase 11)
print('escopo legado: rode python3 -I scripts/ans_auditoria_legado.py ans.json [N] [semente]')
