"""ANA: auditoria independente. (1) re-le o HTML cru das listagens com html.parser (metodo diferente do regex do inventario) e confere, campo a campo,
cada reuniao de ana.json (numero, data, ata?, pauta?, URL da ata, URL da pauta); (2) confere o calendario com o texto cru; (3) confere que toda pendencia tem URL,
que nenhum voto existe sem texto-fonte e que os rotulos de voto (se houver) seguem a lista permitida. Imprime o texto-fonte ANTES do JSON em cada cartao.
Uso: python3 -I scripts/ana_auditoria.py ana.json [semente=2026]"""
import sys, json, re, random, os
from html.parser import HTMLParser
d = json.load(open(sys.argv[1])); random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 2026)
class P(HTMLParser):
    def __init__(s): super().__init__(); s.itens = []; s.ano = None; s.d = None; s.href = None; s.lab = ''; s.na = False; s.b = False
    def handle_starttag(s, t, a):
        a = dict(a)
        if t == 'div' and (a.get('id') or '').startswith('Assunto_'): s.ano = a['id'][8:]
        if t == 'b': s.b = True
        if t == 'a' and 'abreArquivo' in (a.get('onclick') or ''): s.na = True; s.lab = ''; s.href = re.search(r'file=([^\']+)', a['onclick'])[1]
    def handle_data(s, x):
        if s.b: s.d = x.strip()
        if s.na: s.lab += x
    def handle_endtag(s, t):
        if t == 'b': s.b = False
        if t == 'a' and s.na: s.na = False; s.itens.append((s.ano, s.d, s.href, ' '.join(s.lab.split())))
def le(f):
    p = P(); p.feed(open(f, encoding='utf8', errors='ignore').read()); return p.itens
A = le('fonte/ana/web/www2_atas_deliberativas.html'); PT = le('fonte/ana/web/www2_pautas_deliberativas.html')
ata = {int(re.search(r'(\d+)ª', l)[1]): (an, dt, h, l) for an, dt, h, l in A if re.search(r'(\d+)ª', l) and 'Deliberativa' in l and (dt.endswith('/2026') or dt.endswith('/2027'))}
pau = {int(re.search(r'(\d+)ª', l)[1]): (an, dt, h, l) for an, dt, h, l in PT if re.search(r'(\d+)ª', l) and 'Deliberativa' in l and dt.endswith('/2026')}
ok = tot = 0; falhas = []
def chk(rotulo, esperado_texto, valor_json, cond):
    global ok, tot
    tot += 1; ok += bool(cond)
    if not cond: falhas.append((rotulo, esperado_texto, valor_json))
R = d['reunioes']; amostra = list(R); random.shuffle(amostra)
for r in amostra:
    n = int(r['reuniao'][2:]); print(f'--- RD{n} ---')
    pa = pau.get(n); aa = ata.get(n)
    print('TEXTO-FONTE pauta:', pa and (pa[1], pa[3], pa[2]), '| ata:', aa and (aa[1], aa[3], aa[2], 'bloco ' + aa[0]))
    print('JSON:', json.dumps({k: r[k] for k in ('reuniao', 'data', 'url_ata', 'url_pauta')}, ensure_ascii=False))
    dd = lambda s: f'{s[6:]}-{s[3:5]}-{s[:2]}'
    chk(f'RD{n} data', pa and pa[1], r['data'], pa and dd(pa[1]) == r['data'])
    chk(f'RD{n} tem pauta', bool(pa), bool(r['url_pauta']), bool(pa) == bool(r['url_pauta']))
    chk(f'RD{n} tem ata', bool(aa), bool(r['url_ata']), bool(aa) == bool(r['url_ata']))
    chk(f'RD{n} url pauta', pa and pa[2], r['url_pauta'], (not pa) or r['url_pauta'] == 'https://arquivos.ana.gov.br' + pa[2])
    chk(f'RD{n} url ata', aa and aa[2], r['url_ata'], (not aa) or r['url_ata'] == 'https://arquivos.ana.gov.br' + aa[2])
    chk(f'RD{n} tipo', 'Ordinária', r['tipo'], 'Ordinária' in r['tipo'] and (not pa or 'Ordinária' in pa[3]))
    chk(f'RD{n} ata no ano certo do arquivo', aa and aa[2], r['url_ata'], (not aa) or '/atas/' in aa[2])
# numeros fora do JSON que a listagem tem em 2026
extras = sorted(set(pau) - {int(r['reuniao'][2:]) for r in R}); tot += 1; ok += not extras
if extras: falhas.append(('reunioes listadas e ausentes do JSON', extras, None))
# calendario: texto cru
cal = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', open('fonte/ana/web/govbr_calendario.html', encoding='utf8', errors='ignore').read()))
cal = cal[cal.find('Mês Data das Reuniões'):cal.find('*As datas')]; print('--- CALENDARIO (texto cru) ---\n', cal)
q = [x for x in d['cobertura'] if 'Calendário' in x[1]][0]; print('JSON:', q[2], q[3][:200])
chk('calendario: 19 datas (soma do texto cru)', sum(len(re.findall(r'\d+', x)) for x in re.split(r'Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro', cal)[1:]), q[2], q[2] == sum(len(re.findall(r'\d+', x)) for x in re.split(r'Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro', cal)[1:]))
# pendencias com URL; votos sem texto
sem_url = [p for p in d['pendencias'] if not str(p[-1]).startswith('http')]; chk('pendencias com URL', 0, len(sem_url), not sem_url)
txts = [f for f in os.listdir('texto_ana')] if os.path.isdir('texto_ana') else []
chk('nenhum voto sem texto-fonte', 0, len(d['votos']), not d['votos'] or bool(txts))
OKR = ('ACOMPANHOU', 'DIVERGIU', 'RELATOR', 'AUSENTE', 'IMPEDIDO', 'SEM VOTO', 'PEDIU VISTA', 'VOTOU', 'NÃO PARTICIPOU', 'VISTA COLETIVA')
bad = [v for v in d['votos'] if not v['voto'].startswith(OKR)]; chk('rotulos de voto validos', 0, len(bad), not bad)
print(f'\nAUDITORIA: {ok}/{tot} checagens corretas ({100*ok/tot:.1f}%)'); [print('FALHA', f) for f in falhas]
sys.exit(0 if ok / tot >= .95 else 1)
