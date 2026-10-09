"""ANCINE: amostra estratificada (semente fixa) de ancine.json com o TEXTO-FONTE ANTES do JSON, para auditoria manual campo a campo.
Uso: python3 -I scripts/ancine_auditoria.py ancine.json [N=44] [semente=2026]   (o veredito humano vai em ancine_auditoria.json)
Cada cartao: 1) texto cru do SEI (DDC: DECISAO/AUSENCIAS/assinantes; ata: linhas do item; circuito: tabela de votos) 2) so depois o JSON gerado.
Nao importa o parser: relê manifesto_ancine.json e os textos baixados."""
import sys, json, random, re, collections
d = json.load(open(sys.argv[1])); N = int(sys.argv[2]) if len(sys.argv) > 2 else 44; SEM = int(sys.argv[3]) if len(sys.argv) > 3 else 2026
man = {m['ref']: m for m in json.load(open('manifesto_ancine.json'))}; inv = json.load(open('ancine_inventario.json'))
D = d['deliberacoes']; vb = collections.defaultdict(list)
for v in d['votos']: vb[(v['reuniao'], v['processo'], v['deliberacao'])].append(v)
doc_ddc = {int(re.search(r'DDC (\d+)', x['descricao'])[1]): x['id_documento'] for x in inv['series']['307']['itens']}
doc_ata = {int(re.search(r'(\d{3}) - ', x['descricao'])[1]): x['id_documento'] for x in inv['series']['298']['itens']}
def txt(i): m = man.get(i); return open(m['texto'], encoding='utf8').read().replace('​', '') if m and m['ok'] else ''
def estrato(x):
    if x['reuniao'].startswith('CD'): return 'circuito'
    modos = {p['modo'] for p in x['partes']}
    if not x['ddc_publicada']: return 'reservada_sem_ddc'
    if x['manifestacao']: return 'manifestacao'
    if any(p['vencidos'] or p['abstencoes'] or p['impedidos'] for p in x['partes']): return 'maioria_nominal'
    if x['ausencias_txt'] and not x['ausencias_txt'].startswith('Não houve'): return 'ausencia'
    if len(x['partes']) > 1: return 'partes'
    if 'sem modo declarado' in modos: return 'tomou_conhecimento'
    if x['tipo_item'] == 'Retirada de pauta': return 'retirada'
    if x['ad_referendum']: return 'ratificacao_dar'
    return 'unanimidade'
PESO = {'unanimidade': 10, 'ratificacao_dar': 4, 'maioria_nominal': 8, 'ausencia': 4, 'partes': 4, 'tomou_conhecimento': 3, 'retirada': 3, 'reservada_sem_ddc': 3, 'manifestacao': 2, 'circuito': 6}
random.seed(SEM); g = collections.defaultdict(list)
for x in D: g[estrato(x)].append(x)
am = []
for k, n in PESO.items():
    L = sorted(g[k], key=lambda x: (x['reuniao'], x['item_n'])); random.shuffle(L); am += [(k, x) for x in L[:n]]
am = am[:N]
def fonte(x):
    out = []
    if x['reuniao'].startswith('RD'):
        nm = int(x['reuniao'][2:]); ata = txt(doc_ata[nm]); n = x['item_n']
        i = [m.start() for m in re.finditer(r'(?m)^' + re.escape(n) + r'\) Processo', ata)]
        # item da ata: o bloco cujo processo bate (item_n repete entre sessoes)
        for st in i:
            blk = re.split(r'\n\d+\) Processo|\n\|', ata[st + 3:st + 2500])[0]; blk = ata[st:st + 3] + blk
            if x['processo'] in blk.split('\n')[0]: out.append('[ATA ' + x['reuniao'] + ' item ' + n + '] ' + re.sub(r'\s*\n\s*', ' // ', blk)[:900]); break
        if x['ddc_publicada']:
            t = txt(doc_ddc[x['ddc']]); a = t.find('DELIBERAÇÃO DE DIRETORIA'); b = t.find('A autenticidade')
            ass = re.findall(r'assinado eletronicamente por (.*?),\s*(.*?),\s*em (\d\d/\d\d/\d{4})', t)
            corpo = re.sub(r'\s*\n\s*', ' // ', t[a:t.find('Documento assinado')])
            out.append(f'[DDC {x["ddc"]}] ' + corpo[:1700] + ' || ASSINANTES: ' + '; '.join(f'{n_} ({c})' for n_, c, _ in ass))
        else: out.append('[DDC não publicada na série 307]')
    else:
        n = int(re.search(r'CD(\d+)-E', x['reuniao'])[1])
        for it in inv['series']['518']['itens'] + inv['series']['703']['itens'] + inv['series']['702']['itens']:
            t = txt(it['id_documento'])
            if re.search(r'(?:Circuito Deliberativo|CIRCUITO DELIBERATIVO)[^\n]{0,40}?\b' + str(n) + r'\s?-E', t[:600]):
                out.append(f'[{it["descricao"][:40]}] ' + re.sub(r'\s*\n\s*', ' // ', t[t.find('Boletim') + 40:t.find('Documento assinado')])[:1500])
    return out
for i, (k, x) in enumerate(am, 1):
    print('=' * 110); print(f"#{i} estrato={k} {x['reuniao']} {x['deliberacao']} proc {x['processo']}")
    print('--- TEXTO-FONTE'); [print(' ', s) for s in fonte(x)]
    print('--- JSON'); vs = vb[(x['reuniao'], x['processo'], x['deliberacao'])]
    print(' ', {k_: x[k_] for k_ in ('data', 'tipo_item', 'relator', 'secao', 'resultado')}, '| partes:', [(p['modo'], p['vencidos'], p['abstencoes'], p['impedidos']) for p in x['partes']])
    print('  votos:', [(v['diretor'].split()[0], v['voto'], v['proveniencia'], v['voto_por_parte']) for v in vs])
