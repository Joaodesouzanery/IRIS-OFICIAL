# ESPERADO ARTESP derivado da ata (inventario proprio + leitura manual) ANTES de abrir artesp_final.json
import json
am=json.load(open('/tmp/claude-0/-home-user-IRIS-OFICIAL/b552e84e-1331-5c1e-aae9-26b309e73eaa/scratchpad/artesp_amostra.json'))
P=json.load(open('/tmp/claude-0/-home-user-IRIS-OFICIAL/b552e84e-1331-5c1e-aae9-26b309e73eaa/scratchpad/artesp_pres.json'))
ALL=['André','Diego','Fernanda','Raquel']
MANUAL={('ORD1186','172'):'CANCEL',('ORD1203','504'):'UNAN',('S230_242','537'):'UNAN'}   # lidos manualmente
E={}
for r,seq,num,proc,ty in am:
    k=(r,num)
    res=MANUAL.get(k) or {'unan':'UNAN','cancelada':'CANCEL','retirada':'CANCEL'}[ty]
    pres,aus,_=P[r]
    aus=set(aus)   # ORD1206: Constituicao lista Diego mas 'Ausencia Justificada: Diego' + assinaturas sem Diego => AUS
    votes={}
    for d in ALL:
        if d in aus: votes[d]='AUS'
        elif d not in pres: votes[d]='AUS'
        else: votes[d]='S' if res=='CANCEL' else 'A'
    E[k]=dict(res=res,votes=votes,seq=seq)
