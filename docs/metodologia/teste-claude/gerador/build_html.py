import os
HERE=os.path.dirname(os.path.abspath(__file__))
OUTDIR=os.path.dirname(HERE)
import json
from model import *
dims,crits,conds=load()
data=dict(dims=[dict(id=d['id'],nome=d['nome'],peso=d['peso']) for d in dims],
 crits=[{k:c[k] for k in('codigo','nome','dim','peso','keywords','onde','base')} for c in crits],
 conds=[{k:c[k] for k in('id','crit','dim','nivel','ordem','texto','pergunta','verif','tipo')} for c in conds],
 ag=[dict(sigla=s,nome=n,setor=st,lei=lei,url=f'https://www.gov.br/{slug}/pt-br',slug=slug) for s,n,st,lei,slug in AG],
 reg=json.load(open(os.path.join(OUTDIR,'fontes-monitoramento.json'),encoding='utf-8')),
 niv=dict(inicial=.35,gerenciado=.7,melhoria_continua=1.0))
html=open(os.path.join(HERE,'tpl.html'),encoding='utf-8').read().replace('__DATA__',json.dumps(data,ensure_ascii=False))
open(os.path.join(OUTDIR,'IMQN_agencias_prototipo.html'),'w',encoding='utf-8').write(html)
print(len(html))
