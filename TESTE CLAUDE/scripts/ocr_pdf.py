#!/usr/bin/env python3
"""OCR (RapidOCR) para PDF-imagem. Uso: python3 -I ocr_pdf.py entrada.pdf saida.txt"""
import sys, pymupdf, numpy as np
from rapidocr_onnxruntime import RapidOCR
ocr = RapidOCR(); doc = pymupdf.open(sys.argv[1]); out = []
for i, pg in enumerate(doc):
    pix = pg.get_pixmap(dpi=200); img = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3]
    res, _ = ocr(img); lines = {}
    for box, txt, conf in (res or []):
        y = round(box[0][1] / 18); lines.setdefault(y, []).append((box[0][0], txt))
    out.append('\n'.join(' '.join(t for _, t in sorted(v)) for _, v in sorted(lines.items())) + f'\n[pg {i+1}]\n')
open(sys.argv[2], 'w', encoding='utf8').write('\n'.join(out))
