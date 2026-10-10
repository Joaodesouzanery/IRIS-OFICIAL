# ESPERADO ANTT escrito a partir das atas ANTES de abrir antt.json (votos/relator/resultado).
# A=favor/acompanhou, D=divergiu, V=vista, S=sem voto (retirado/sobrestado), AUS=ausente, REV=indeterminado (ata nao diz)
G,F,L,X,Al,Sev,Mar='Guilherme','Felipe','Lucas','Alex','Alessandro','Severino','Marcelo'
def a(pres,aus=(),**kw):
    d={p:'A' for p in pres}; d.update({p:'AUS' for p in aus}); d.update(kw); return d
def s(pres,aus=()):
    d={p:'S' for p in pres}; d.update({p:'AUS' for p in aus}); return d
P5=[G,F,L,X,Al]
E={
('RDE266','1.3.1'):dict(rel=Sev,res='SOBRESTADO',venc=[],vista=[X],votes={Sev:'A',X:'V',G:'S',L:'S',F:'AUS'}),
('RDE268','1.1.2'):dict(rel=L,res='MAIORIA',venc=['?G ou Alex'],vista=[],votes={L:'A',G:'REV',X:'REV',Sev:'AUS',F:'AUS'}),
('RDE269','1.1.1'):dict(rel=F,res='RETIRADO',venc=[],vista=[],votes=s(P5)),
('RDE273','1.1.1'):dict(rel=G,res='UNAN',venc=[],vista=[],votes=a(P5)),
('RDE276','1.3.1'):dict(rel=Al,res='UNAN',venc=[],vista=[],votes=a(P5)),
('RDE280','1.1.4'):dict(rel=F,res='UNAN',venc=[],vista=[],votes=a([F,L,X,Al],[G])),
('RDE280','1.2.1'):dict(rel=L,res='UNAN',venc=[],vista=[],votes=a([F,L,X,Al],[G])),
('RDE281','1.3.1'):dict(rel=Al,res='UNAN',venc=[],vista=[],votes=a(P5)),
('RDE285','1.2.1'):dict(rel=X,res='UNAN',venc=[],vista=[],votes=a([G,F,X,Al],[L])),
('RDE286','1.2.1'):dict(rel=F,res='RETIRADO',venc=[],vista=[],votes=s([G,F,X,Al],[L])),
('RDE291','1.2.1'):dict(rel=Al,res='UNAN',venc=[],vista=[],votes=a(P5)),
('RDE293','1.1.2'):dict(rel=F,res='UNAN',venc=[],vista=[],votes=a(P5)),
('RDE295','1.4.1'):dict(rel=X,res='UNAN',venc=[],vista=[],votes=a([G,F,L,X,Mar])),
('RDE296','1.2.3'):dict(rel=F,res='UNAN',venc=[],vista=[],votes=a([F,L,X,Mar],[G])),
('RDE296','1.3.1'):dict(rel=X,res='UNAN',venc=[],vista=[],votes=a([F,L,X,Mar],[G])),
('RDE297','2.1.1'):dict(rel=X,res='UNAN',venc=[],vista=[],votes=a([G,F,L,X],[Mar])),
('REX100','1.1.1'):dict(rel=F,res='RETIRADO',venc=[],vista=[],votes=s([F,L,Al],[G,X])),
('ROD1024','1.2.1'):dict(rel=L,res='UNAN',venc=[],vista=[],votes=a([G,F,L,X,Sev])),
('ROD1024','1.2.3'):dict(rel=L,res='UNAN',venc=[],vista=[],votes=a([G,F,L,X,Sev])),
('ROD1024','1.2.5'):dict(rel=L,res='RETIRADO',venc=[],vista=[],votes=s([G,F,L,X,Sev])),
('ROD1025','1.3.2'):dict(rel=L,res='UNAN',venc=[],vista=[],votes=a([G,F,L,X,Sev])),
('ROD1025','1.3.3'):dict(rel=L,res='MAIORIA',venc=[X],vista=[],votes=a([G,F,L,Sev],[],**{X:'D'})),
('ROD1027','1.4.4'):dict(rel=X,res='UNAN',venc=[],vista=[],votes=a(P5)),
('ROD1029','2.1.1'):dict(rel=G,res='UNAN',venc=[],vista=[],votes=a(P5)),
('ROD1031','1.2.4'):dict(rel=L,res='UNAN',venc=[],vista=[],votes=a(P5)),
('ROD1031','1.4.2'):dict(rel=Al,res='RETIRADO',venc=[],vista=[],votes=s(P5)),
('ROD1034','1.2.2'):dict(rel=F,res='UNAN',venc=[],vista=[],votes=a(P5)),
('ROD1035','1.1.1'):dict(rel=F,res='UNAN',venc=[],vista=[],votes=a([G,F,X,Al],[L])),
('ROD1035','1.1.2'):dict(rel=Al,res='UNAN',venc=[],vista=[],votes=a([G,F,X,Al],[L])),   # vista previa de Felipe (279a RDE) acompanhou o relator
('ROD1035','1.2.3'):dict(rel=X,res='SOBRESTADO',venc=[],vista=[G],votes={X:'A',G:'V',F:'S',Al:'S',L:'AUS'}),
('ROD1035','1.2.4'):dict(rel=X,res='UNAN',venc=[],vista=[],votes=a([F,X,Al],[G,L])),  # G saiu a partir do item 1.2.1 (pauta invertida: 1.2.3 foi primeiro)
('ROD1036','1.3.1'):dict(rel=Al,res='RETIRADO',venc=[],vista=[],votes=s([G,F,Al],[L,X])),
('ROD1036','2.1.2'):dict(rel=F,res='UNAN',venc=[],vista=[],votes=a([G,F,Al],[L,X])),
('ROD1037','1.1.2'):dict(rel=G,res='RETIRADO',venc=[],vista=[],votes=s([G,L,X,Al],[F])),
('ROD1037','1.4.1'):dict(rel=Al,res='RETIRADO',venc=[],vista=[],votes=s([G,L,X,Al],[F])),
('ROD1038','1.1.1'):dict(rel=G,res='RETIRADO',venc=[],vista=[],votes=s(P5)),
('ROD1038','1.3.1'):dict(rel=Al,res='UNAN',venc=[],vista=[],votes=a(P5)),
('ROD1039','1.1.2'):dict(rel=X,res='UNAN',venc=[],vista=[],votes=a(P5)),   # vista previa de G (287a RDE)
('ROD1039','1.2.2'):dict(rel=F,res='UNAN',venc=[],vista=[],votes=a(P5)),
('ROD1039','1.5.2'):dict(rel=F,res='UNAN',venc=[],vista=[],votes=a(P5)),   # vista previa de Alessandro
('ROD1040','1.1.2'):dict(rel=G,res='RETIRADO',venc=[],vista=[],votes=s([F,L,X,Mar],[G])),
('ROD1040','1.1.3'):dict(rel=G,res='RETIRADO',venc=[],vista=[],votes=s([F,L,X,Mar],[G])),
('ROD1041','1.3.1'):dict(rel=X,res='UNAN',venc=[],vista=[],votes=a([G,F,L,X],[Mar])),
}
