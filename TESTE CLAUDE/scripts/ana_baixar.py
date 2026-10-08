"""ANA: tenta baixar os PDFs (ata/pauta) de cada reuniao 2026 do ana_inventario.json e grava manifesto_ana.json (sha256 de cada listagem coletada
e de cada PDF; PDF nao baixado fica com ok=false e o motivo). Nunca contorna bloqueio. Uso: python3 -I scripts/ana_baixar.py ana_inventario.json manifesto_ana.json fonte/ana"""
import sys, os, json, subprocess, hashlib, time
inv, man_f, dest = sys.argv[1:4]; I = json.load(open(inv)); os.makedirs(f'{dest}/pdf', exist_ok=True)
M = json.load(open(man_f)) if os.path.exists(man_f) else {}
sh = lambda f: hashlib.sha256(open(f, 'rb').read()).hexdigest()
for k, s in I['sondas'].items():
    if s.get('arquivo') and os.path.exists(s['arquivo']): M[f'web:{k}'] = {'tipo': 'listagem/pagina', 'url': s['url'], 'arquivo': s['arquivo'], 'http': s['http'], 'bytes': os.path.getsize(s['arquivo']), 'sha256': sh(s['arquivo']), 'ok': s['http'] == '200'}
def baixar(u, f):
    ult = ''
    for i in range(3):
        p = subprocess.run(['curl', '-sS', '-L', '-m', '60', '-o', f, '-w', '%{http_code}', u], capture_output=True)
        if p.returncode == 0: return p.stdout.decode(), ''
        ult = p.stderr.decode().strip()[:160]; time.sleep(2)
    return '000', ult
for r in I['reunioes_2026']:
    for t in ('ata', 'pauta'):
        if t not in r: continue
        u = r[t]['url_pdf']; f = f'{dest}/pdf/{t}_{r["numero"]}.pdf'; cod, err = baixar(u, f)
        ok = cod == '200' and os.path.exists(f) and open(f, 'rb').read(5) == b'%PDF-'
        if not ok and os.path.exists(f): os.remove(f)
        M[f'pdf:{t}:{r["numero"]}'] = {'tipo': t, 'reuniao': r['numero'], 'url': u, 'arquivo': f if ok else None, 'http': cod, 'ok': ok, 'sha256': sh(f) if ok else None,
            'motivo': '' if ok else 'bloqueado pela fonte/egress: ' + (err or f'HTTP {cod}')}
        print(t, r['numero'], 'OK' if ok else 'FALHOU ' + (err or cod))
json.dump(M, open(man_f, 'w'), ensure_ascii=False, indent=1)
print('PDFs ok:', sum(1 for v in M.values() if v['tipo'] in ('ata', 'pauta') and v['ok']), 'de', sum(1 for v in M.values() if v['tipo'] in ('ata', 'pauta')))
