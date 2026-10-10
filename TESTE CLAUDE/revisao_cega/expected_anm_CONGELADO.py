# ESPERADO escrito a partir da ata (texto/*.txt) ANTES de abrir os votos/relator/resultado do anm.json.
# codigos de voto: A=favoravel/acompanhou(inclui relator), D=divergiu(vencido), V=pedido de vista, S=sem voto (retirado/sobrestado sem voto), AUS=ausente, IMP=impedido
M,T,R,C,L,F,J='Mauro','Tasso','Roger','Caio','Luiz','Fabio','JoseFernando'
P1=[M,T,R,C]; P2=[M,T,R,J]; P3=[M,L,F,J]
def v(pres,**kw):
    d={p:'A' for p in pres}; d.update(kw); return d
E={
('REP31','1.1.1'):dict(rel=M,res='UNAN',venc=[],vista=[],imp=[],votes={M:'A',T:'A',R:'A',C:'A'}),
('REP31','3.1.1'):dict(rel=M,res='MAIORIA',venc=[R],vista=[],imp=[],votes={M:'A',T:'A',R:'D',C:'A'}),
('REP32','#1'):dict(rel=None,res='ATA',venc=[],vista=[],imp=[],votes={M:'A',T:'A',R:'A',C:'A',L:'AUS'}),
('REP32','#53'):dict(rel=L,res='RETIRADO',venc=[],vista=[],imp=[],votes={M:'S',T:'S',R:'S',C:'S',L:'AUS'}),
('REP32','2.1.1'):dict(rel=T,res='UNAN',venc=[],vista=[],imp=[],votes={M:'A',T:'A',R:'A',C:'A',L:'AUS'}),
('REP32','3.3.1'):dict(rel=R,res='SOBRESTADO',venc=[],vista=[T],imp=[],votes={R:'A',T:'V',C:'A',M:'S',L:'AUS'}),
('REP32','4.1.6'):dict(rel=T,res='SOBRESTADO',venc=[],vista=[M],imp=[],votes={T:'A',C:'D',M:'V',R:'S',L:'AUS'}),
('REP32','4.3.1'):dict(rel='Guilherme(ex-membro)',res='UNAN',venc=[],vista=[],imp=[],votes={M:'A',T:'A',R:'A',C:'A',L:'AUS'}),
('REP32','4.4.1'):dict(rel=M,res='MAIORIA',venc=[M],vista=[],imp=[],votes={M:'D',T:'A',R:'A',C:'A',L:'AUS'}),
('REP32','5.1.1'):dict(rel=L,res='UNAN',venc=[],vista=[],imp=[],votes={M:'A',T:'A',R:'A',C:'A',L:'AUS'}),
('REP32','5.1.2'):dict(rel=L,res='UNAN',venc=[],vista=[],imp=[],votes={M:'A',T:'A',R:'A',C:'A',L:'AUS'}),
('REP32','5.8.1'):dict(rel=L,res='RETIRADO',venc=[],vista=[],imp=[],votes={M:'S',T:'S',R:'S',C:'S',L:'AUS'}),
('REP33','2.1.8'):dict(rel=T,res='RETIRADO',venc=[],vista=[],imp=[],votes={M:'S',T:'S',R:'S',J:'S'}),
('REP33','3.4.1'):dict(rel=M,res='SOBRESTADO',venc=[],vista=[T],imp=[],votes={M:'A',R:'A',T:'V',J:'S'}),
('REP33','3.5.1'):dict(rel=R,res='RETIRADO',venc=[],vista=[],imp=[],votes={M:'S',T:'S',R:'S',J:'S'}),
('REP34','2.5.7'):dict(rel=T,res='UNAN',venc=[],vista=[],imp=[],votes=v(P2)),
('ROP81','1.1.2'):dict(rel=M,res='RETIRADO',venc=[],vista=[],imp=[],votes={p:'S' for p in P3}),
('ROP82','1.4.5'):dict(rel=M,res='RETIRADO',venc=[],vista=[],imp=[],votes={p:'S' for p in P3}),
('ROP82','3.4.1'):dict(rel=F,res='UNAN',venc=[],vista=[],imp=[],votes=v(P3)),
('ROP83','#1'):dict(rel=None,res='ATA',venc=[],vista=[],imp=[],votes=v(P3)),
('ROP83','1.4.1'):dict(rel=M,res='UNAN',venc=[],vista=[],imp=[],votes=v(P3)),
('ROP83','1.6.4'):dict(rel=M,res='RETIRADO',venc=[],vista=[],imp=[],votes={p:'S' for p in P3}),
('ROP83','2.7.2'):dict(rel='Caio(original,ex-membro)/Luiz(revisor vencedor)',res='MAIORIA',venc=[],vista=[],imp=[J],votes={M:'A',L:'A',F:'A',J:'IMP'}),
('ROP84','2.1.2'):dict(rel='Guilherme(ex-membro)',res='UNAN',venc=[],vista=[],imp=[J],votes={M:'A',L:'A',F:'A',J:'IMP'}),
('ROP84','4.1.1'):dict(rel=J,res='SOBRESTADO',venc=[],vista=[M],imp=[],votes={J:'A',F:'A',L:'A',M:'V'}),
('ROP85','2.3.1'):dict(rel=L,res='RETIRADO',venc=[],vista=[],imp=[],votes={p:'S' for p in P3}),
('ROP85','3.5.1'):dict(rel=F,res='UNAN',venc=[],vista=[],imp=[],votes=v(P3)),
('ROP85','4.1.3'):dict(rel=J,res='SOBRESTADO',venc=[],vista=[M],imp=[],votes={J:'A',F:'A',L:'A',M:'V'}),
('ROP86','2.2.15'):dict(rel=F,res='UNAN',venc=[],vista=[],imp=[],votes=v(P3)),
('ROP86','3.3.1'):dict(rel=L,res='SOBRESTADO',venc=[],vista=[M],imp=[],votes={L:'A',J:'A',F:'A',M:'V'}),
('ROP87','#1'):dict(rel=None,res='ATA',venc=[],vista=[],imp=[],votes=v(P3)),
('ROP87','2.4.4'):dict(rel=F,res='UNAN',venc=[],vista=[],imp=[],votes=v(P3)),
('ROP87','4.5.1'):dict(rel=J,res='UNAN',venc=[],vista=[],imp=[],votes=v(P3)),
('ROP88','1.7.1'):dict(rel=M,res='RETIRADO',venc=[],vista=[],imp=[],votes={p:'S' for p in P3}),
('ROP88','2.3.1'):dict(rel=F,res='SOBRESTADO',venc=[],vista=[M],imp=[],votes={F:'A',M:'V',L:'S',J:'S'}),
('ROP88','4.3.1'):dict(rel=J,res='UNAN',venc=[],vista=[],imp=[],votes=v(P3)),
}
