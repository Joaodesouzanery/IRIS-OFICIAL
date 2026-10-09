#!/usr/bin/env python3
"""OCR (RapidOCR, dpi configurável) de PDF-imagem do ANTT. Uso: python3 -I antt_ocr.py entrada.pdf saida.txt [dpi=150]
Igual a ocr_pdf.py (200 dpi), com dpi menor para caber no orçamento de CPU do ambiente; o texto de cada página termina em [pg N]."""
import sys, pymupdf, numpy as np
from rapidocr_onnxruntime import RapidOCR
dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 150
ocr = RapidOCR(); doc = pymupdf.open(sys.argv[1]); out = []
for i, pg in enumerate(doc):
    pix = pg.get_pixmap(dpi=dpi); img = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3]
    res, _ = ocr(img); lines = {}
    for box, txt, conf in (res or []):
        y = round(box[0][1] / (18 * dpi / 200)); lines.setdefault(y, []).append((box[0][0], txt))
    out.append('\n'.join(' '.join(t for _, t in sorted(v)) for _, v in sorted(lines.items())) + f'\n[pg {i+1}]\n')
open(sys.argv[2], 'w', encoding='utf8').write('\n'.join(out))
