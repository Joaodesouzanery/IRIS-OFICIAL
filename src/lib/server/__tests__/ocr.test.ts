import { describe, it, expect, afterEach } from "vitest";
import { isOcrConfigured, extractTextViaOcr } from "@/lib/server/ocr";

const original = process.env.OCR_SPACE_API_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.OCR_SPACE_API_KEY;
  else process.env.OCR_SPACE_API_KEY = original;
});

describe("ocr — degradação segura quando não configurado", () => {
  it("isOcrConfigured=false sem OCR_SPACE_API_KEY", () => {
    delete process.env.OCR_SPACE_API_KEY;
    expect(isOcrConfigured()).toBe(false);
  });
  it("extractTextViaOcr retorna null sem chave (não chama rede)", async () => {
    delete process.env.OCR_SPACE_API_KEY;
    await expect(extractTextViaOcr(Buffer.from("%PDF-1.4 fake"))).resolves.toBeNull();
  });
  it("isOcrConfigured=true quando a chave existe", () => {
    process.env.OCR_SPACE_API_KEY = "test-key";
    expect(isOcrConfigured()).toBe(true);
  });
});
