import os
HERE=os.path.dirname(os.path.abspath(__file__))
OUTDIR=os.path.dirname(HERE)
"""Modelo próprio: enriquece a matriz extraída (matriz.json) e define as 12 agências."""
import json, re
NIV=[('inicial','Inicial','INI'),('gerenciado','Gerenciado','GER'),('melhoria_continua','Melhoria Contínua','MC')]
NIVLBL={k:l for k,l,_ in NIV}; NIVABR={k:a for k,_,a in NIV}
BASE={ 'AIR':'Lei 13.848/2019, art. 6º; Lei 13.874/2019, art. 5º; Decreto 10.411/2020',
 'PS':'Lei 13.848/2019, arts. 9º a 11; Lei 13.874/2019; Decreto 10.411/2020',
 'EST':'Decreto 10.139/2019, art. 19 (citado na planilha rev2022) — segundo páginas da Anatel e da ANAC, SUBSTITUÍDO pelo Decreto 12.002/2024; conferir artigo equivalente. Lei 13.874/2019',
 'AGE':'Lei 13.848/2019, art. 21 (agenda); arts. 17–20 (plano estratégico e PGA)',
 'PRO':'Lei 13.848/2019; Decreto 10.411/2020',
 'ARR':'Decreto 10.411/2020 (ARR) — artigo a conferir'}
KW={'AIR_CAP':('capacitação AIR; curso análise de impacto regulatório; plano de capacitação','Dado interno: relatório de gestão, plano de desenvolvimento de pessoas, listas de certificados (agregadas, sem identificar servidores)'),
'AIR_MET':('manual de AIR; análise de impacto regulatório metodologia; portaria AIR','Portal > Institucional / Acesso à informação > legislação interna; Boletim de Serviço'),
'AIR_PRO':('relatório de AIR; AIR dispensa; nota técnica AIR','Portal > Regulação / Participação social > consultas públicas (anexos de AIR)'),
'PS':('consulta pública; audiência pública; tomada de subsídios; Participa + Brasil; relatório ouvidoria; consumidor.gov.br','Portal > Participação social; plataforma Participa + Brasil; relatório anual da Ouvidoria'),
'EST':('acervo normativo; consolidação normativa; estoque regulatório; fardo regulatório; revisão de normas','Portal > Legislação / Normas; relatórios de revisão do estoque'),
'AGE':('agenda regulatória; relatório de acompanhamento da agenda; ciclo bienal','Portal > Regulação > Agenda regulatória; relatório anual'),
'PRO':('processo normativo; fluxo de elaboração de normas; indicadores processo normativo; manual de elaboração de atos normativos','Portal > Institucional > processos; Boletim de Serviço; relatório de gestão'),
'ARR_CAP':('capacitação ARR; análise de resultado regulatório curso','Dado interno: relatório de gestão, plano de desenvolvimento de pessoas'),
'ARR_MET':('agenda de ARR; manual ARR; análise de resultado regulatório metodologia','Portal > Regulação > Agenda de ARR; Boletim de Serviço'),
'ARR_PRO':('relatório de ARR; análise de resultado regulatório publicada','Portal > Regulação > ARR; consultas públicas de ARR')}
def classif(crit,texto):
    if crit.endswith('_CAP'):
        return 'interna','Indicador numérico' if '%' in texto or 'servidores' in texto else 'Dado interno','Capacitação é dado de RH do órgão; não há documento público que a comprove por si.'
    if re.search(r'public|divulg|acess[ií]ve|portal|internet|site',texto,re.I):
        return 'pública','Documento público',''
    if re.search(r'manual|ato normativo|institucionaliz|formaliz|norma|metodologia|agenda|publicad',texto,re.I):
        return 'pública','Documento público (ato/manual publicável)','Depende de o ato estar publicado; se não estiver, só dado interno.'
    return 'interna','Dado interno','Prática de gestão sem documento público típico (ex.: monitoramento, integração ao planejamento).'
def load():
    dims=json.load(open(os.path.join(HERE,'matriz.json'),encoding='utf-8'))
    conds=[]; crits=[]
    for d in dims:
        for c in d['criterios']:
            crit=dict(codigo=c['codigo'],nome=c['nome'],dim=d['id'],peso=c['peso'],keywords=KW[c['codigo']][0],onde=KW[c['codigo']][1],base=BASE[c['codigo'].split('_')[0]])
            crits.append(crit)
            cnt={}
            for x in c['conds']:
                cnt[x['nivel']]=cnt.get(x['nivel'],0)+1
                v,tipo,mot=classif(c['codigo'],x['texto'])
                t=x['texto']; q='Há evidência de que '+t[0].lower()+t[1:].rstrip('.;')+'?'
                conds.append(dict(id=f"{c['codigo']}.{NIVABR[x['nivel']]}.{x['ordem']}",crit=c['codigo'],dim=d['id'],nivel=x['nivel'],ordem=x['ordem'],texto=t,original=x['original'],celula=x['celula'],pergunta=q,verif=v,tipo=tipo,motivo=mot,base=crit['base']))
    return dims,crits,conds
AG=[('ANATEL','Agência Nacional de Telecomunicações','Telecomunicações','Lei 9.472/1997','anatel'),
('ANVISA','Agência Nacional de Vigilância Sanitária','Vigilância sanitária','Lei 9.782/1999','anvisa'),
('ANEEL','Agência Nacional de Energia Elétrica','Energia elétrica','Lei 9.427/1996','aneel'),
('ANTT','Agência Nacional de Transportes Terrestres','Transporte terrestre','Lei 10.233/2001','antt'),
('ANAC','Agência Nacional de Aviação Civil','Aviação civil','Lei 11.182/2005','anac'),
('ANTAQ','Agência Nacional de Transportes Aquaviários','Transporte aquaviário','Lei 10.233/2001','antaq'),
('ANP','Agência Nacional do Petróleo, Gás Natural e Biocombustíveis','Petróleo, gás e biocombustíveis','Lei 9.478/1997','anp'),
('ANA','Agência Nacional de Águas e Saneamento Básico','Recursos hídricos e saneamento','Lei 9.984/2000','ana'),
('ANS','Agência Nacional de Saúde Suplementar','Saúde suplementar','Lei 9.961/2000','ans'),
('ANM','Agência Nacional de Mineração','Mineração','Lei 13.575/2017','anm'),
('ANCINE','Agência Nacional do Cinema','Audiovisual','MP 2.228-1/2001','ancine'),
('ANPD','Autoridade Nacional de Proteção de Dados','Proteção de dados pessoais','Lei 13.709/2018 (LGPD), art. 55-A','anpd')]
# acesso HTTP medido em 2026-10-09 neste ambiente (HEAD no portal raiz); 403/000 = bloqueio do ambiente, não prova de indisponibilidade
ACESSO={'anatel':200,'anvisa':200,'aneel':403,'antt':403,'anac':0,'antaq':403,'anp':403,'ana':403,'ans':403,'anm':403,'ancine':200,'anpd':200}
