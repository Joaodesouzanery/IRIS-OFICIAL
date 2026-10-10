# ESPERADO ANVISA escrito ANTES de abrir relator/resultado/votos do anvisa_final.json
# SAF Safatle, DAN Daniel Meirelles, DLA Daniela, THI Thiago, MAR Marcelo(substituto)
# R relator, A acompanhou, D divergiu(NAO), V vista, X ausente, I impedido, -- sem voto
U=lambda rel,**k:dict(rel=rel,**k)
ALL5=dict(SAF='A',DAN='A',DLA='A',THI='A',MAR='A')
def allA(rel,**ov):
    v=dict(ALL5); v[rel]='R'; v.update(ov); return v
EXP={
('REP1','4.1.2.1'):U('SAF',res='unanimidade; efeito suspensivo parcial',v=allA('SAF',MAR='X'),nota='MAR nao presente; 3 diretores proferiram voto proprio mas unanime'),
('ROP1','3.5.3.2'):U('MAR',res='unanimidade conhecer e negar',v=allA('MAR'),nota='CD 53 todos SIM'),
('ROP10','4.1.2.2'):U('SAF',res='unanimidade retirar efeito suspensivo',v=allA('SAF'),nota='CD 565'),
('ROP12','2.11'):U('THI',res='maioria aprovar; vencido DAN',v=allA('THI',DAN='D'),venc=['DAN']),
('ROP13','3.4.2.1'):U('THI',res='unanimidade conhecer e dar parcial provimento',v=allA('THI',MAR='I'),nota='CD 729; reuniao so com THI,DAN,MAR presentes mas votos do CD: SAF,DAN,DLA,THI SIM; MAR IMPEDIDO'),
('ROP2','3.2.2.4'):U('DAN',res='unanimidade',v=allA('DAN'),nota='CD 107'),
('ROP3','4.4.2.1'):U('THI',res='unanimidade retirar efeito suspensivo',v=allA('THI'),nota='CD 182'),
('ROP4','3.5.2.1'):U('MAR',res='unanimidade',v=allA('MAR'),nota='CD 247'),
('ROP5','2.8'):U('THI',res='unanimidade aprovar RDC',v=allA('THI',DAN='X'),nota='DAN ausente da votacao (registrado)'),
('ROP6','2.3'):U('DLA',res='unanimidade',v=allA('DLA')),
('ROP7','3.5.2.3'):U('MAR',res='maioria; relator vencido; voto SAF prevalece',v=dict(SAF='D',DAN='D',DLA='D',THI='D',MAR='R'),venc=['MAR'],nota='CD 431: 4 NAO, relator SIM'),
('ROP8','2.1'):U('DAN',res='unanimidade',v=allA('DAN',MAR='X'),nota='MAR nao presente'),
('ROP9','2.3'):U('MAR',res='unanimidade',v=allA('MAR',DAN='X'),nota='DAN nao presente'),
('ROP2','4.5.2.1'):U('MAR',res='vista',vista=['DLA'],v=dict(MAR='R',DLA='V'),nota='CD 122 sem extrato'),
('ROP3','3.2.2.1'):U('DAN',res='vista',vista=['DLA'],v=dict(DAN='R',MAR='votou',THI='votou',DLA='V',SAF='--'),nota='CD 168 sigilo sem extrato'),
('ROP2','3.5.7.2'):U('MAR',res='vista',vista=['DAN'],v=dict(MAR='R',THI='votou',DAN='V',SAF='--',DLA='--')),
('ROP13','3.5.1.1'):U('MAR',res='vista',vista=['THI','DAN'],v=dict(MAR='R(nao proferiu voto)',THI='V',DAN='V'),nota='presentes THI,DAN,MAR'),
('ROP9','4.3.2.3'):U('DLA',res='retirada',v={}),
('ROP1','3.5.3.7'):U('MAR',res='retirada (prorrogacao do prazo de vista THI)',v={}),
('ROP7','4.3.2.1'):U('DLA',res='retirada',v={}),
('ROP4','3.2.10.1'):U('DAN',res='unanimidade',v=allA('DAN',MAR='I'),nota='CD 236'),
('ROP2','3.4.2.1'):U('THI',res='unanimidade',v=allA('THI',DAN='X',MAR='I'),nota='CD 114'),
('ROP1','3.3.2.4'):U('DLA',res='unanimidade',v=allA('DLA',MAR='I'),nota='CD 43'),
('ROP1','3.5.3.6'):U('MAR',res='maioria; converter em diligencia; vencidos MAR e DAN',v=dict(SAF='D',DAN='A',DLA='D',THI='D',MAR='R'),venc=['MAR','DAN'],nota='CD 57'),
('ROP4','3.3.3.1'):U('DLA',res='maioria; vencido THI',v=allA('DLA',THI='D'),venc=['THI'],nota='CD 241'),
('CD 95/2026',):U('SAF',res='unanimidade referendar',v=allA('SAF')),
('CD 210/2026',):U('DAN',res='unanimidade',v=allA('DAN')),
('CD 337/2026',):U('SAF',res='unanimidade referendar',v=allA('SAF')),
('CD 370/2026',):U('DAN',res='unanimidade',v=allA('DAN')),
('CD 504/2026',):U('THI',res='unanimidade',v=allA('THI')),
('CD 581/2026',):U('DAN',res='unanimidade, composta I/II',v=allA('DAN')),
('CD 774/2026',):U('DAN',res='unanimidade NAO AUTORIZAR',v=allA('DAN')),
('CD 837/2026',):U('DAN',res='unanimidade',v=allA('DAN')),
('CD 925/2026',):U('SAF',res='unanimidade',v=allA('SAF')),
('CD 1013/2026',):U('SAF',res='unanimidade',v=allA('SAF')),
('CD 985/2026',):U('SAF',res='unanimidade (votantes)',v=allA('SAF',MAR='I')),
('CD 150/2026',):U('SAF',res='maioria vencido THI',v=allA('SAF',THI='D'),venc=['THI']),
('CD 811/2026',):U('DLA',res='maioria vencido THI',v=allA('DLA',THI='D'),venc=['THI']),
('CD 908/2026',):U('SAF',res='unanimidade',v=allA('SAF',MAR='X'),nota='FERIAS'),
('CD 620/2026',):U('SAF',res='unanimidade aprovar ata ROP8',v=dict(SAF='R',DAN='A',DLA='A',THI='A'),nota='MAR fora da tabela'),
}
