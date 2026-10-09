#!/usr/bin/env python3
"""ANTT, etapa final: aplica a revisão curada (antt_revisao.json), cruza a relatoria com os PDFs de voto (antt_votos_pdf.json: texto + OCR),
grava o que a fonte NÃO publica em 'pendencias' (com URL), 'nao_feito', 'qualidade' e 'antes_depois' no próprio antt.json.
Uso: python3 -I scripts/antt_finalizar.py antt.json manifesto_antt.json antt_inventario.json antt_votos_pdf.json antt_revisao.json [antt_sem_ata.json]
Ordem do pipeline: antt_inventario -> antt_baixar -> antt_extrair -> OCR (ocr_lote) -> antt_parse -> antt_votos_pdf -> antt_finalizar.
Idempotente: relê antt.json cru do antt_parse (rode antt_parse antes). Não toca build_xlsx.py: o build só lê reunioes/deliberacoes/votos; as chaves novas são aditivas."""
import re, sys, json, datetime, collections, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from antt_parse import ORDEM, PREFIXO, norm

def main(a_json, man_json, inv_json, vp_json, rev_json, sa_json=None):
    A = json.load(open(a_json)); M = {r['tag']: r for r in json.load(open(man_json))}; INV = {c['url']: c for c in json.load(open(inv_json))}
    VP = json.load(open(vp_json)); REV = json.load(open(rev_json))
    D = {(d['reuniao'], d['processo']): d for d in A['deliberacoes']}
    V = collections.defaultdict(dict)
    for v in A['votos']: V[(v['reuniao'], v['processo'])][v['diretor']] = v
    antes = collections.Counter(v['proveniencia'] for v in A['votos'])
    log = []
    # 1. revisão curada
    for e in REV:
        k = (e['reuniao'], e['processo'])
        if k not in D: log.append(('SEM ITEM', k)); continue
        if e.get('relator'): D[k]['relator'] = e['relator']
        for dire, (voto, prov, ev) in e['votos'].items():
            v = V[k].get(dire)
            if v is None: log.append(('FORA DA PRESENCA', k, dire)); continue
            v['voto'], v['proveniencia'], v['evidencia'] = voto, prov, ev
        if e.get('fonte'): D[k]['fonte_revisao'] = e['fonte']
    # 2. relatoria da ata x RELATORIA do PDF do voto (texto ou OCR)
    pdf_voto = {}
    for i in VP:
        if i['tipo'] == 'voto' and i.get('prefixo'): pdf_voto.setdefault((i['prefixo'], i.get('numero_rotulo'), i.get('ano_rotulo')), []).append(i)
    cruz = {'cab_diferente': [], 'conferem': 0, 'divergem': [], 'sem_pdf': [], 'sem_voto_na_ata': 0, 'pdf_sem_texto': []}
    for d in A['deliberacoes']:
        m = re.match(r'([A-Z]+) (\d+)/(\d{4})', d.get('voto_doc') or '')
        if not m: cruz['sem_voto_na_ata'] += 1; continue
        ps = pdf_voto.get((m[1], int(m[2]), int(m[3])))
        if not ps: cruz['sem_pdf'].append((d['reuniao'], d['processo'], d['voto_doc'])); continue
        rels = {p.get('relatoria') for p in ps if p.get('relatoria')}
        procs = {x for p in ps for x in p.get('processos', [])}; corpo = {x for p in ps for x in p.get('processos_corpo', [])}
        d['voto_pdf'] = {'arquivo': ps[0]['rotulo'], 'via': ps[0]['via'], 'sha256': ps[0]['sha256'], 'url': ps[0]['url'], 'relatoria_pdf': sorted(rels), 'processo_confere': d['processo'] in procs or d['processo'] in corpo}
        if not rels: cruz['pdf_sem_texto'].append((d['reuniao'], d['processo'], d['voto_doc']))
        elif d['relator'] in rels and d['processo'] in procs: cruz['conferem'] += 1
        elif d['relator'] in rels and d['processo'] in corpo: cruz['conferem'] += 1; cruz['cab_diferente'].append((d['reuniao'], d['processo'], d['voto_doc'], sorted(procs)))
        else: cruz['divergem'].append((d['reuniao'], d['processo'], d['voto_doc'], d['relator'], sorted(rels), sorted(procs)))
    # 3. fonte da evidência por voto
    for v in A['votos']:
        v.setdefault('fonte', 'ata')
        if v.get('evidencia', '').find('PDF (OCR)') >= 0: v['fonte'] = 'ata + voto vista (OCR)'
        elif v.get('evidencia', '').find('PDF') >= 0: v['fonte'] = 'ata + PDF de voto (texto)'
    # 4. pendências (formato do build: agência, item, data, situação, existe, motivo, como resolver, URL)
    hoje = datetime.date.today(); P = []
    URL_LIST = 'https://portal.antt.gov.br/web/guest/reunioes-da-diretoria'
    for r in A['reunioes']:
        if not r.get('obs'): continue
        m = M.get(r['reuniao'], {}); docs = m.get('docs', []); url = m.get('url') or URL_LIST
        dd = datetime.date.fromisoformat(r['data']); existe = ', '.join(f'{n} {t}' for t, n in collections.Counter(d['tipo'] for d in docs).items())
        votos_pub = [d['rotulo'] for d in docs if d['tipo'] == 'voto']
        if dd > hoje: P.append(['ANTT', r['reuniao'], r['data'], 'Futura (só pauta)', existe, 'Ainda não ocorreu', 'Nada a fazer: rodar após a data', url])
        else:
            dias = (hoje - dd).days
            P.append(['ANTT', r['reuniao'], r['data'], 'Lacuna antiga (>30 dias sem ata)' if dias > 30 else 'Realizada, ata aguardando publicação', existe,
                      f'{dias} dias desde a reunião; votos escritos publicados: {len(votos_pub)} ({"relator" if votos_pub else "nenhum"}); a ata traria resultado e presença', 'Rodar antt_rodar.sh; perguntar à ANTT se passar de 30 dias', url])
    for (r_, pr_, cod) in cruz['sem_pdf']:
        m = M.get(r_, {}); P.append(['ANTT', f'{r_} · {pr_}', D[(r_, pr_)]['data'], 'Voto escrito citado na ata e não publicado', f'ata cita Voto {cod}; a página da reunião não o lista', 'A página publica só parte dos votos; sem o PDF não confirmamos a relatoria nem a proposta',
                  'Pedir à ANTT o PDF do Voto ' + cod + '; rodar antt_rodar.sh quando publicarem', m.get('url') or URL_LIST])
    for (r_, pr_, cod, rel_, rels_, procs_) in cruz['divergem']:
        P.append(['ANTT', f'{r_} · {pr_}', D[(r_, pr_)]['data'], 'Erro da fonte: ata cita Voto ' + cod + ' de outro processo', f'PDF do Voto {cod} é do processo {", ".join(procs_)}; o voto do processo {pr_} publicado na reunião tem outro código',
                  'Citação errada na ata; relatoria resolvida pelo PDF do voto do processo (revisão curada)', 'Pedir à ANTT a retificação da ata', M[r_].get('url') or URL_LIST])
    for (r_, pr_, cod, hdr) in cruz['cab_diferente']:
        P.append(['ANTT', f'{r_} · {pr_}', D[(r_, pr_)]['data'], 'Erro da fonte: cabeçalho do Voto ' + cod + ' com nº de outro processo (sem efeito)', f'PDF do Voto {cod}: campo PROCESSO(S) = {", ".join(hdr)}; o processo da ata ({pr_}) consta no corpo do voto',
                  'Erro de digitação/modelo na fonte; relatoria e proposta conferem', 'Nenhuma (já reconciliado pelo corpo do voto)', M[r_].get('url') or URL_LIST])
    for k, e in {(e['reuniao'], e['processo']): e for e in REV}.items():
        if k == ('RDE268', '50500.047133/2025-43'):
            P.append(['ANTT', f'{k[0]} · {k[1]}', D[k]['data'], 'Dado não publicado na ata (LIMITE DA FONTE)', 'ata RDE268 item 1.1.2: "por maioria", sem nomear quem divergiu', '2 votos (Guilherme e Alex) ficam REVISAR: Felipe ausente (férias) e Severino considerado ausente',
                      'Depende da ANTT publicar o resultado nominal ou o vídeo/ata retificada', M[k[0]].get('url') or URL_LIST])
    P.append(['ANTT', 'ROD1035 · itens 1.2.1 a 2.1.1', '2026-06-18', 'Ata se contradiz (LIMITE DA FONTE)', 'cabeçalho da ata ROD1035: Diretor-Geral ausente "a partir do item 1.2.1"; porém o item 1.2.3 registra que ele pediu vista',
              'Adotado: AUSENTE nos itens 1.2.1, 1.2.2, 1.2.4, 1.3.1 e 2.1.1; PEDIU VISTA no 1.2.3 (nominal em ambos)', 'Pedir à ANTT a retificação da ata da 1.035ª', M['ROD1035'].get('url') or URL_LIST])
    P.append(['ANTT', 'Todas as reuniões · votos em unanimidade', '', 'Dado não publicado na ata (LIMITE DA FONTE)', 'a ata registra "por unanimidade" sem listar o voto de cada diretor; o voto escrito publicado é só o do relator (proposta) e, quando há vista, o do revisor',
              f'{sum(1 for v in A["votos"] if v["proveniencia"] == "inferido")} votos individuais seguem inferidos (ACOMPANHOU); só o vídeo da sessão (aba Vídeo da página de cada reunião) mostra cada voto', 'Fora de escopo (vídeo); não resolvível por texto', URL_LIST])
    # reuniões realizadas SEM ata: o voto escrito do relator (proposta, sem resultado) é o que a fonte publica -> antt_sem_ata.json (mesmo formato de antt_rde270.json + reuniao/data/voto_doc)
    SA = []
    for r in A['reunioes']:
        if not r.get('obs') or datetime.date.fromisoformat(r['data']) > hoje: continue
        vistos = set()
        for i in VP:
            if i['reuniao'] != r['reuniao'] or i['tipo'] != 'voto' or not i.get('processos') or not i.get('relatoria'): continue
            ch = (i['prefixo'], i['numero_rotulo']);
            if ch in vistos: continue
            vistos.add(ch)
            SA.append({'reuniao': r['reuniao'], 'data': r['data'], 'arquivo': i['rotulo'], 'voto_doc': f"{i['prefixo']} {i['numero_rotulo']}/{i['ano_rotulo']}", 'relator': i['relatoria'], 'processo': i['processos'][0],
                       'encaminhamento': i.get('encaminhamento', ''), 'objeto': i.get('objeto', ''), 'via': i['via'], 'sha256': i['sha256'], 'url': i['url']})
    if sa_json: json.dump(SA, open(sa_json, 'w'), ensure_ascii=False, indent=1)
    A['sem_ata'] = {'itens': len(SA), 'reunioes': sorted({x['reuniao'] for x in SA})}
    # 5. números
    depois = collections.Counter(v['proveniencia'] for v in A['votos'])
    A['pendencias'] = P
    A['antes_depois'] = {'antes': dict(antes), 'depois': dict(depois), 'revisao_itens': len(REV), 'log': log}
    A['cruzamento_voto_pdf'] = {'conferem': cruz['conferem'], 'divergem': cruz['divergem'], 'sem_pdf': cruz['sem_pdf'], 'sem_voto_na_ata': cruz['sem_voto_na_ata'], 'pdf_sem_texto': cruz['pdf_sem_texto'], 'cab_diferente': cruz['cab_diferente']}
    json.dump(A, open(a_json, 'w'), ensure_ascii=False, indent=1)
    print('votos', len(A['votos']), 'antes', dict(antes), 'depois', dict(depois)); print('log', log); print('cruzamento', {k: (len(v) if isinstance(v, list) else v) for k, v in cruz.items()})
    for x in cruz['divergem']: print('  DIVERGE', x)
    print('pendencias', len(P))

if __name__ == '__main__': main(*sys.argv[1:])
