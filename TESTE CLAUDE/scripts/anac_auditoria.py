"""ANAC: auditoria independente por amostragem (semente fixa). NAO importa o parser nem a varredura. Para cada item sorteado imprime PRIMEIRO o TEXTO DA FONTE
(preâmbulo da ata com a presença, o trecho do item na ata, a deliberação da certidão e o texto da página APEX, relidos de texto_anac/ e fonte/anac/reu) e
DEPOIS o que o anac.json diz; o veredito do cartão vem de regras próprias (esperado calculado só do texto). O JSON-resumo vem por último.
Limite declarado: reuniões sem ata publicada (RD5, RD6, REX2, RE30): presença só verificável contra a janela de exercício (inferida); voto individual em
decisão unânime é inferido (a ata nunca lista voto a voto).
uso: python3 -I scripts/anac_auditoria.py anac.json [N=50] [semente=20261009] [fonte/anac] [manifesto_anac.json]"""
import sys, json, random, re, html, os, unicodedata
J = json.load(open(sys.argv[1])); N = int(sys.argv[2]) if len(sys.argv) > 2 else 50; S = int(sys.argv[3]) if len(sys.argv) > 3 else 20261009
DIR = sys.argv[4] if len(sys.argv) > 4 else 'fonte/anac'; MAN = json.load(open(sys.argv[5] if len(sys.argv) > 5 else 'manifesto_anac.json'))
def limpa(x): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', x))).replace('\xa0', ' ').strip()
def nz(s): return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')
SOBRE = {'faierstein': 'Tiago Faierstein', 'mesquita': 'Rui Mesquita', 'moreira': 'Antônio Mathias Moreira', 'honorato': 'Roberto Honorato', 'ianelli': 'Cláudio Ianelli', 'nascimento': 'Luiz Ricardo Nascimento', 'altoe': 'Mariana Altoé', 'pereira': 'Tiago Sousa Pereira'}
JAN = {'Tiago Faierstein': ('2026-01-01', '2026-12-31'), 'Rui Mesquita': ('2026-01-01', '2026-12-31'), 'Antônio Mathias Moreira': ('2026-01-01', '2026-12-31'), 'Luiz Ricardo Nascimento': ('2026-01-01', '2026-03-22'),
       'Mariana Altoé': ('2026-02-12', '2026-04-24'), 'Roberto Honorato': ('2026-03-23', '2026-12-31'), 'Cláudio Ianelli': ('2026-04-25', '2026-12-31')}
def quem(nome): return SOBRE.get(nz(nome.split()[-1])) if nome and nome.strip() else None
def sobs(t): n = nz(t); return {v for k, v in SOBRE.items() if re.search(r'\b' + k + r'\b', n)}
def tx(e):
    f = os.path.join('texto_anac', str(e['id']) + '.txt'); return re.sub(r'\s+', ' ', open(f, errors='replace').read()).replace('V erificado', 'Verificado') if e.get('texto') and os.path.exists(f) else ''
ATAS = {e['reuniao']: tx(e) for e in MAN if e['tipo'] == 'documento (Ata)' and e.get('texto')}
DOC = {e['url']: e for e in MAN if e['tipo'].startswith('documento')}
def fonte_item(id_apex, n):
    h = open(os.path.join(DIR, 'reu', id_apex + '.html'), errors='replace').read()
    for blk in re.split(r'(?=<table\s+class="c">)', h)[1:]:
        blk = blk.split('</table>')[0]
        if '<strong>Processo:' not in blk: continue
        mn = re.search(r'<strong>\s*(\d+)\)', blk)
        if not mn or mn.group(1) != n: continue
        g = lambda lab: (lambda mm: limpa(mm.group(1)) if mm else '')(re.search(r'<strong>\s*' + lab + r':(?:&nbsp;?)*\s*</strong>.*?<p[^>]*>(.*?)</p>', blk, flags=re.S))
        return {'proc': g('Processo'), 'assunto': g('Assunto'), 'relator': g('Relator'), 'delib': g('Deliberação')}
    return None
V = {}
for v in J['votos']: V.setdefault((v['reuniao'], v['processo'], v['deliberacao']), []).append(v)
R = {r['reuniao']: r for r in J['reunioes']}
random.seed(S); am = random.sample(J['deliberacoes'], min(N, len(J['deliberacoes'])))
cartoes = []; nvotos = nvotos_ok = 0; erros = []
for i, d in enumerate(am, 1):
    f = fonte_item(d['id_apex'], d['item_n']); vs = V.get((d['reuniao'], d['processo'], d['deliberacao']), []); rid = d['reuniao']; ata = ATAS.get(rid, '')
    pre = ''; ch = ''; ant = ''
    if ata:
        a0 = ata.find('teve início'); a1 = ata.find('Verificado', a0); pre = ata[a0:a1]
        k = ata.find('Processo: ' + d['processo'])
        if k >= 0:
            ant = ata[max(0, k - 160):k]; rest = ata[k:]; fim = re.search(r'\s\d+\s?\)\s*Processo:|Relatoria d[oa]|Em \d+ de \w+ de \d{4}, foi submetido|Na sequência|A reunião encerrou-se|Nada mais havendo', rest[20:]); ch = rest[:(fim.start() + 20) if fim else len(rest)]
    cert = ''
    for x in d['documentos']:
        if x['rotulo'] == 'Certidão de deliberação' and x['url'] in DOC and DOC[x['url']].get('texto'):
            c = tx(DOC[x['url']]); m = re.search(r'Deliberação (.*?)(?: Ato decorrente| À | Documento assinado)', c) or re.search(r'Certifico que (.*?)(?: À | Documento assinado)', c)
            mr = re.search(r'na (\d+)ª Reunião Deliberativa( Eletrônica)?', c)
            if mr and (mr.group(1) != re.sub(r'\D', '', rid) or bool(mr.group(2)) != rid.startswith('RE')): cert = '(certidão ligada na página é de OUTRA reunião: ' + mr.group(0) + ')'
            else: cert = (m.group(1) if m else c[:300])[:400]
            break
    print(f"CARTAO {i}: {rid} item {d['item_n']} proc. {d['processo']} (página APEX id {d['id_apex']})")
    print(f"  FONTE página : relator={f and f['relator']!r} | deliberação={f and f['delib']!r}")
    if ata: print(f"  FONTE ata    : presença={pre[:430]!r}"); print(f"  FONTE ata    : item={ch[:520]!r} | antes={ant[-110:]!r}")
    else: print(f"  FONTE ata    : (ata não publicada para {rid})")
    print(f"  FONTE certid.: {cert!r}")
    print(f"  JSON         : relator={d['relator']!r} | tipo={d['tipo_item']} | presença={R[rid]['presenca']} | votos={[(v['diretor'].split()[0], v['voto'][:22], v['proveniencia'][:3]) for v in vs]}")
    ok = []; why = []
    def c(cond, nome):
        ok.append(bool(cond))
        if not cond: why.append(nome)
    c(f is not None, 'item achado na página')
    if f:
        lo = f['delib'].lower(); rel = quem(f['relator']); c(rel == d['relator'], 'relator'); c((f['delib'] and d['resultado'].startswith(f['delib'])) or (not f['delib'] and d['resultado'].startswith(('RESULTADO NÃO PUBLICADO', 'REUNIÃO AINDA NÃO'))), 'resultado')
        if not f['delib']: c(not vs, 'sem desfecho => sem voto')
        else:
            T = (lo + ' ' + ch.lower() + ' ' + cert.lower())
            # presença esperada
            if ata:
                m_aus = re.search(r'ausentes?\s+justificadamente\s+(?:o|a|os|as)\s+Diretor\w*\s+([^.]+?)\s*\.', pre); aus = sobs(m_aus.group(1)) if m_aus else set()
                pres = sobs(pre[:m_aus.start()] if m_aus else pre) - aus
            else:
                ds = R[rid]['datas']; pres = {n for n, (a, b) in JAN.items() if any(a <= x <= b for x in ds)} | ({rel} if rel else set()); aus = set()
            c({v['diretor'] for v in vs} == pres | aus | ({rel} if rel else set()), 'votantes = presentes (ata/janela) + ausentes')
            c(set(R[rid]['presentes']) == pres | ({rel} if rel and not ata else set()) and set(R[rid]['ausentes']) == aus, 'presença da reunião')
            vp = re.search(r'pedido de vista formulado pel[oa] diretor[a]? ([^.;]+)', ch, flags=re.I); vista = quem(vp.group(1)) if vp else None
            imp = {quem(m.group(1)) for m in re.finditer(r'diretor[a]? ([\wÀ-ÿ ]+?) declarou-se imped', ch, flags=re.I)}
            venc_rel = 'vencido o relator' in T; vvm = re.search(r'Voto-Vista do Diretor[a]? ([\wÀ-ÿ ]+?):', ant + ' ' + ch); vv = quem(vvm.group(1)) if vvm else None
            tipo = 'Vista' if 'vista' in lo else ('Retirada de pauta' if 'retirad' in lo else 'Deliberação'); c(d['tipo_item'] == tipo, 'tipo_item')
            for v in vs:
                dn = v['diretor']; L_ = v['voto']; pv = v['proveniencia']; nvotos += 1; antes = len(why)
                if dn in aus: c(L_.startswith('AUSENTE') and pv == 'nominal', f'{dn}: AUSENTE nominal')
                elif dn in imp: c(L_.startswith('IMPEDIDO') and pv == 'nominal', f'{dn}: IMPEDIDO nominal')
                elif dn == vista: c(L_.startswith('PEDIU VISTA') and pv == 'nominal', f'{dn}: PEDIU VISTA nominal')
                elif tipo == 'Vista': c(L_.startswith('RELATOR') if dn == rel else L_.startswith('SEM VOTO'), f'{dn}: vista')
                elif dn == rel and venc_rel: c(L_.startswith('DIVERGIU') and pv == 'nominal', f'{dn}: relator vencido')
                elif vv and dn == vv and venc_rel: c(L_.startswith('VOTOU') and pv == 'nominal', f'{dn}: voto-vista')
                elif dn == rel: c(L_.startswith('RELATOR') and pv == 'nominal', f'{dn}: RELATOR')
                elif tipo == 'Retirada de pauta': c(L_.startswith('SEM VOTO'), f'{dn}: retirada')
                elif 'unanimidade' in T or venc_rel: c(L_.startswith('ACOMPANHOU') and pv in ('inferido', 'nominal'), f'{dn}: ACOMPANHOU')
                else: c(False, f'{dn}: modo de votação desconhecido')
                nvotos_ok += (len(why) == antes)
            c(all(v['motivo'] for v in vs), 'todo voto com motivo'); c(all(v['proveniencia'] != 'REVISAR' for v in vs), 'sem REVISAR')
            if cert and 'OUTRA' not in cert:
                mc = 'unanimidade' if 'unanimidade' in cert.lower() else ('maioria' if 'maioria' in cert.lower() else ''); mp = 'unanimidade' if 'unanimidade' in lo else ('maioria' if 'maioria' in lo else '')
                c(not (mc and mp) or mc == mp, 'modo certidão = página')
    res = all(ok); cartoes.append(res)
    if not res: erros.append(f'{rid}#{d["item_n"]}: {why}')
    print(f"  VEREDITO: {'CORRETO' if res else 'ERRO ' + str(why)}")
n = len(cartoes); a = sum(cartoes)
print(json.dumps({'amostra_itens': n, 'semente': S, 'corretos': a, 'acerto_pct': round(100 * a / n, 1) if n else None, 'votos_dos_itens_sorteados': sum(len(V.get((d['reuniao'], d['processo'], d['deliberacao']), [])) for d in am),
                  'votos_conferidos': nvotos, 'votos_corretos': nvotos_ok, 'itens_com_erro': erros,
                  'limite': 'reuniões sem ata (RD5, RD6, REX2, RE30): presença só contra a janela de exercício; voto em unanimidade é inferido (a ata não lista voto a voto)'}, ensure_ascii=False))
sys.exit(0 if n and a / n >= 0.95 else 1)
