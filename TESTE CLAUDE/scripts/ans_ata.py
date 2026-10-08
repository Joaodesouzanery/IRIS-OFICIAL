"""ANS (DICOL) 2026: leitura das ATAS oficiais (PDF do modulo com_dicol do site legado www.ans.gov.br).
Modulo importado por ans_parse.py (nao tem CLI). Funcoes puras: texto da ata -> dict(cabecalho, itens).
Estrutura da ata (igual em todas as 17 atas de 2026):
  cabecalho: 'presidida pelo Diretor-Presidente X e contou com a presenca da Diretora A, do Diretor B ... [Ausente o Diretor J, em periodo de ferias]'
  secoes 'A) Informe', 'B) Apreciacoes', 'C) Deliberacoes', 'D) Deliberacoes - Extrapauta', '... - Sessao Reservada', 'H) Circuito Deliberativo/AEP' (blocao)
  item de secao: 'N. Processo: P / Assunto: ... / Area Responsavel: A / Decisao: ...'   (Processo pode faltar: ata/informe)
  item do blocao (AEP), subsecoes 'H.1) Processos Sancionadores' ...: 'N . Aprovado por unanimidade [, impedida de votar a Diretora X por ...] o voto condutor da DIxx ... Processo: P'
A ata NAO usa a palavra 'relator'; o voto individual so aparece como: 'por unanimidade', 'impedido(a) de votar', 'Item retirado de pauta pelo(a) Diretor(a) X',
'suspensa pelo pedido de vistas do Diretor X', 'ressalvas' de diretores. Tudo o mais e inferencia declarada por quem chama."""
import re

FOOT = re.compile(r'Ata de Reunião - DICOL.*?/ pg\. \d+')
SEC = re.compile(r'(?:(?<=\s)|^)([A-Z])\)\s+((?:Informe|Apreciaç|Deliberaç|Circuito)[^:]{0,120}?):', re.I)
SUB = re.compile(r'(?:(?<=\s)|^)([A-Z])\.(\d+)\)\s+([^:]{3,120}?):')
PROC = r'\d{5}\.\d{6}/\d{4}-\s?\d{2}'


def limpa(t):
    t = t.replace('\u200b', '').replace('\xa0', ' ')
    t = FOOT.sub(' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    # rotulos com letras espacadas pelo PDF ('D e c i s ã o :')
    for rot, esp in (('Decisão:', r'D\s?e\s?c\s?i\s?s\s?ã\s?o\s?:'), ('Assunto:', r'A\s?s\s?s\s?u\s?n\s?t\s?o\s?:'), ('Processo:', r'P\s?r\s?o\s?c\s?e\s?s\s?s\s?o\s?:'),
                     ('Área Responsável:', r'Á\s?r\s?e\s?a\s+R\s?e\s?s\s?p\s?o\s?n\s?s\s?á\s?v\s?e\s?l\s?:')):
        t = re.sub(esp, rot, t)
    return t


def corta_corpo(t):
    i = t.find('youtube/ansreguladoraoficial')
    i = t.find('.', i) + 1 if i >= 0 else 0
    j = t.find('Feitas essas deliberações')
    if j < 0: j = t.find('Feitas essas')
    if j < 0: j = len(t)
    return t[:i], t[i:j], t[j:]


def sequencia(txt, rx, inicio=1, tol=2):
    """Divide txt nos marcadores rx (grupo 1 = numero, digitos podem vir espacados) aceitando a numeracao sequencial; tolera salto de ate `tol` numeros
    (a ata da ANS pula numeros ocasionalmente) e devolve (n, texto, saltou)."""
    pos = []; esp = inicio
    for m in rx.finditer(txt):
        n = int(re.sub(r'\s', '', m[1]))
        if esp <= n <= esp + tol: pos.append((m.start(), m.end(), n, n != esp)); esp = n + 1
    out = []
    for k, (a, b, n, salto) in enumerate(pos):
        out.append((n, txt[b:(pos[k + 1][0] if k + 1 < len(pos) else len(txt))].strip(), salto))
    return out


def secoes(corpo):
    """[(letra, titulo, sub_letra_num|None, sub_titulo|None, texto)] na ordem do documento."""
    marcas = []
    for m in SEC.finditer(corpo): marcas.append((m.start(), m.end(), 'S', m[1], m[2].strip(), None))
    for m in SUB.finditer(corpo): marcas.append((m.start(), m.end(), 'U', m[1], m[3].strip(), m[2]))
    marcas.sort()
    out = []; cur_s = (None, None)
    for k, (a, b, tp, letra, tit, num) in enumerate(marcas):
        fim = marcas[k + 1][0] if k + 1 < len(marcas) else len(corpo)
        if tp == 'S': cur_s = (letra, tit)
        out.append(dict(tipo=tp, letra=letra, titulo=tit if tp == 'S' else cur_s[1], sub=(f'{letra}.{num}' if tp == 'U' else None), sub_titulo=tit if tp == 'U' else None,
                        texto=corpo[b:fim].strip(), secao_letra=cur_s[0]))
    return out


IT_RX = re.compile(r'(?:(?<=\s)|^)(\d+)\s?\.\s+(?=(?:Processo|Assunto)\s?:)')
AEP_RX = re.compile(r'(?:(?<=\s)|^)(\d(?:\s?\d){0,3})\s?\.\s*(?=[A-ZÁÉÍÓÚ][a-zçãé]{3,}\s)')   # o PDF espaca digitos ('1 4 4 .')


def item_normal(n, tx):
    m = re.match(r'(?:Processo:\s*(\S+?)\s+(?:(.*?)\s+)?)?Assunto:\s*(.*?)\s*Área Responsável:\s*(.*?)\s*Decisão:\s*(.*)$', tx)
    if not m: return dict(n=n, erro='formato', texto=tx)
    proc = (m[1] or '').rstrip('.,;')
    r = dict(n=n, processo=proc, assunto=m[3].strip(), area=m[4].strip(), decisao=m[5].strip())
    if m[2]: r['complemento_assunto'] = m[2].strip()   # texto solto entre 'Processo:' e 'Assunto:' (quebra de pagina do PDF)
    return r


def item_aep(n, tx):
    procs = [re.sub(r'\s', '', x) for x in re.findall(PROC, tx)]
    return dict(n=n, processo=procs[-1] if procs else '', processos=procs, decisao=tx.strip())


TERM = re.compile(r'Processo\s*(?:n[ºo°.]{0,2}\s*)?:?\s*(' + PROC + r')\s*[.;,]?', re.I)
NUM = re.compile(r'^\s*(\d(?:\s?\d){0,3})\s?\.\s*')


def itens_aep(txt):
    """Itens do blocao (AEP). Cada item termina em 'Processo: NNNNN.NNNNNN/AAAA-DD'; o numero inicial vem as vezes com digitos espacados ('1 4 4 .') e a ata pula numeros
    ou cola dois itens (primeiro sem 'Processo:'): corta por terminador, depois re-corta por numero inicial n+1 DENTRO do trecho. Devolve lista de dict(n, texto, anomalia)."""
    segs = []; p = 0
    for m in TERM.finditer(txt): segs.append(txt[p:m.end()]); p = m.end()
    if txt[p:].strip(): segs.append(txt[p:])
    out = []; ult = 0
    for sg in segs:
        sg = re.sub(r'^\s*(?:\d+\s*)?[–-]\s*PAUTADO\s+SDCOL\s*', '', sg)   # rotulo solto que o PDF antepoe a alguns itens
        m = NUM.match(sg); n = int(re.sub(r'\s', '', m[1])) if m else None
        corpo = sg[m.end():] if m else sg.strip()
        if m is None and out:   # continuacao do item anterior (a ata repete 'Processo: P' no meio do texto)
            out[-1]['texto'] += ' ' + corpo; continue
        parts = [(n, corpo)]
        # trecho com mais de um item colado: procura o marcador n+1 dentro do trecho
        while n is not None:
            nxt = None
            for mm in AEP_RX.finditer(parts[-1][1]):
                if int(re.sub(r'\s', '', mm[1])) == parts[-1][0] + 1: nxt = mm; break
            if not nxt: break
            a, b = parts[-1]
            parts[-1] = (a, b[:nxt.start()].strip()); parts.append((a + 1, b[nxt.end():].strip()))
        for n_, c in parts:
            an = []
            if n_ is None: an.append('sem numero inicial (item continua o anterior ou numeracao ilegivel)'); n_ = ult + 1
            elif n_ != ult + 1: an.append(f'salto de numeracao na ata ({ult} -> {n_})')
            ult = n_
            out.append(dict(n=n_, texto=c.strip(), anomalia='; '.join(an)))
    return out


def parse_ata(texto):
    t = limpa(texto)
    cab, corpo, fim = corta_corpo(t)
    out = dict(cabecalho=cab, itens=[], aep=[], rodape=fim[:300])
    for s in secoes(corpo):
        if s['sub'] or 'Circuito' in (s['titulo'] or ''):
            if not s['sub']: continue   # linha-mãe do AEP: sem itens proprios
            for x in itens_aep(s['texto']):
                it = item_aep(x['n'], x['texto']); it['anomalia'] = x['anomalia']; it.update(secao=s['sub'] + ') ' + s['sub_titulo'], secao_letra=s['secao_letra'], titulo_secao=s['titulo']); out['aep'].append(it)
        else:
            for n, tx, salto in sequencia(s['texto'], IT_RX):
                it = item_normal(n, tx); it.update(secao=s['letra'] + ') ' + s['titulo'], secao_letra=s['letra']); out['itens'].append(it)
            if not sequencia(s['texto'], IT_RX):
                # secao sem numeracao ('Assunto:' direto: informe unico)
                m = re.match(r'Assunto:', s['texto'])
                if m:
                    it = item_normal(1, s['texto']); it.update(secao=s['letra'] + ') ' + s['titulo'], secao_letra=s['letra']); out['itens'].append(it)
    return out
