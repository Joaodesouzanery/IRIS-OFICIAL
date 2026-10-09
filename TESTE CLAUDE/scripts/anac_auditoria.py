"""ANAC: auditoria independente por amostragem (semente fixa). NAO importa o parser. Para cada item sorteado imprime primeiro o TEXTO DA FONTE
(relido do HTML salvo em fonte/anac/reu) e depois o que o anac.json diz; o veredito do cartão vem de regras próprias. O JSON-resumo vem por último.
Limite declarado: a presença (quem estava na reunião) NÃO tem fonte independente enquanto a ata (SEI) estiver bloqueada: verifica-se só a coerência com o colegiado em exercício.
uso: python3 -I scripts/anac_auditoria.py anac.json [N=44] [semente=2026] [fonte/anac]"""
import sys, json, random, re, html, os, unicodedata
J = json.load(open(sys.argv[1])); N = int(sys.argv[2]) if len(sys.argv) > 2 else 44; S = int(sys.argv[3]) if len(sys.argv) > 3 else 2026; DIR = sys.argv[4] if len(sys.argv) > 4 else 'fonte/anac'
def limpa(x): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', x))).replace('\xa0', ' ').strip()
def nz(s): return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')
SOBRE = {'faierstein': 'Tiago Faierstein', 'mesquita': 'Rui Mesquita', 'moreira': 'Antônio Mathias Moreira', 'honorato': 'Roberto Honorato', 'ianelli': 'Cláudio Ianelli', 'nascimento': 'Luiz Ricardo Nascimento', 'altoe': 'Mariana Altoé'}
JAN = {'Tiago Faierstein': ('2026-01-01', '2026-12-31'), 'Rui Mesquita': ('2026-01-01', '2026-12-31'), 'Antônio Mathias Moreira': ('2026-01-01', '2026-12-31'), 'Luiz Ricardo Nascimento': ('2026-01-01', '2026-03-22'),
       'Mariana Altoé': ('2026-03-03', '2026-04-24'), 'Roberto Honorato': ('2026-03-23', '2026-12-31'), 'Cláudio Ianelli': ('2026-04-25', '2026-12-31')}
def fonte_item(id_apex, n):
    h = open(os.path.join(DIR, 'reu', id_apex + '.html'), errors='replace').read()
    for blk in re.split(r'(?=<table\s+class="c">)', h)[1:]:
        blk = blk.split('</table>')[0]
        if '<strong>Processo:' not in blk: continue
        mn = re.search(r'<strong>\s*(\d+)\)', blk)
        if not mn or mn.group(1) != n: continue
        g = lambda lab: (lambda mm: limpa(mm.group(1)) if mm else '')(re.search(r'<strong>\s*' + lab + r':(?:&nbsp;?)*\s*</strong>.*?<p[^>]*>(.*?)</p>', blk, flags=re.S))
        return {'proc': g('Processo'), 'assunto': g('Assunto'), 'relator': g('Relator'), 'delib': g('Deliberação'), 'docs': re.findall(r'>([^<]{3,60})</a>', blk.split('Documentos')[-1]) if 'Documentos' in blk else []}
    return None
V = {}
for v in J['votos']: V.setdefault((v['reuniao'], v['processo'], v['deliberacao']), []).append(v)
R = {r['reuniao']: r for r in J['reunioes']}
random.seed(S); am = random.sample(J['deliberacoes'], min(N, len(J['deliberacoes'])))
cartoes = []
for i, d in enumerate(am, 1):
    f = fonte_item(d['id_apex'], d['item_n']); vs = V.get((d['reuniao'], d['processo'], d['deliberacao']), [])
    print(f"CARTAO {i}: {d['reuniao']} item {d['item_n']} (página APEX id {d['id_apex']})")
    print(f"  FONTE: processo={f and f['proc']!r} | relator={f and f['relator']!r} | deliberação={f and f['delib']!r} | docs={f and f['docs'][:4]}")
    print(f"  JSON : processo={d['processo']!r} | relator={d['relator']!r} | resultado={d['resultado'][:80]!r} | tipo={d['tipo_item']} | votos={[(v['diretor'].split()[0], v['voto'][:14], v['proveniencia'][:3]) for v in vs]}")
    ok = []; why = []
    def c(cond, nome):
        ok.append(bool(cond))
        if not cond: why.append(nome)
    c(f is not None, 'item achado na página')
    if f:
        lo = f['delib'].lower(); rel = SOBRE.get(nz(f['relator'].split()[-1])) if f['relator'] else None
        c(re.search(r'\d{5}\.\d{6}/\d{4}-\d{2}', f['proc']) and re.search(r'\d{5}\.\d{6}/\d{4}-\d{2}', f['proc']).group(0) == d['processo'], 'processo')
        c(rel == d['relator'], 'relator'); c(f['assunto'] == d['assunto'], 'assunto')
        c((f['delib'] and d['resultado'].startswith(f['delib'])) or (not f['delib'] and d['resultado'].startswith(('RESULTADO NÃO PUBLICADO', 'REUNIÃO AINDA NÃO'))), 'resultado')
        tp = 'Vista' if 'vista' in lo else ('Retirada de pauta' if 'retirad' in lo else 'Deliberação'); c(d['tipo_item'] == tp, 'tipo_item')
        if f['delib']:
            pres = R[d['reuniao']]['presentes']; ds = R[d['reuniao']]['datas']
            esp = {n for n, (a, b) in JAN.items() if any(a <= x <= b for x in ds)} | ({rel} if rel else set())
            c(set(v['diretor'] for v in vs) == esp == set(pres), 'votantes = presentes = colegiado em exercício')
            c(len(vs) == len({v['diretor'] for v in vs}), 'sem duplicata')
            c(all(v['voto'].startswith('RELATOR') for v in vs if v['diretor'] == rel) and sum(v['voto'].startswith('RELATOR') for v in vs) == (1 if rel else 0), 'relator = RELATOR (único)')
            if 'unanimidade' in lo and tp == 'Deliberação': c(all(v['voto'].startswith('ACOMPANHOU') and v['proveniencia'] == 'inferido' for v in vs if v['diretor'] != rel), 'unanimidade => ACOMPANHOU inferido nos demais')
            if 'maioria' in lo and not re.search(r'venc|contr', lo): c(all(v['proveniencia'] in ('REVISAR', 'nominal') for v in vs if v['diretor'] != rel) and any(v['proveniencia'] == 'REVISAR' for v in vs), 'maioria sem nomes => REVISAR')
            if tp == 'Retirada de pauta': c(all(v['voto'].startswith(('RELATOR', 'SEM VOTO')) for v in vs), 'retirada => sem voto de mérito')
            if tp == 'Vista': c(all(v['voto'].startswith(('RELATOR', 'SEM VOTO', 'PEDIU VISTA')) for v in vs), 'vista => sem voto de mérito')
            c(all(v['motivo'] for v in vs if v['proveniencia'] == 'REVISAR'), 'REVISAR com motivo')
        else: c(not vs, 'item sem desfecho não tem voto')
    res = all(ok); cartoes.append(res)
    print(f"  VEREDITO: {'CORRETO' if res else 'ERRO ' + str(why)}")
n = len(cartoes); a = sum(cartoes)
print(json.dumps({'amostra_itens': n, 'semente': S, 'corretos': a, 'acerto_pct': round(100 * a / n, 1) if n else None, 'votos_dos_itens_sorteados': sum(len(V.get((d['reuniao'], d['processo'], d['deliberacao']), [])) for d in am),
                  'limite': 'presença não verificável por fonte independente (ata SEI bloqueada); verificada só a coerência com o colegiado em exercício'}, ensure_ascii=False))
sys.exit(0 if n and a / n >= 0.95 else 1)
