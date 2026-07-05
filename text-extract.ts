/**
 * Extracción de texto de un documento de la Unidad de Red.
 *
 * v0.1: SOLO capa de texto de PDFs (sin OCR). Si el PDF no tiene texto
 * (escaneo), `needsOcr=true` → Document AI queda para v0.2. Ver
 * `mycolegal-platform/PLAN_TECNICO_MYCOBOT_TOOLS.md` §5.1.
 *
 * Usa `unpdf` (pdfjs empaquetado, JS puro, apto serverless/Cloud Run — sin deps
 * nativas ni el landmine de import de `pdf-parse`).
 */

export type ExtractMethod = 'text-layer' | 'ocr-documentai' | 'empty';

export interface ExtractResult {
  texto: string;
  chars: number; // nº de caracteres NO-espacio (heurística de "tiene texto")
  metodo: ExtractMethod;
  needsOcr: boolean;
}

const MIN_CHARS = 40; // por debajo → se considera escaneo sin capa de texto

/** Extrae el texto de un PDF (capa de texto). No hace OCR (v0.1). */
export async function extractPdfText(buffer: Uint8Array): Promise<ExtractResult> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const texto = (typeof text === 'string' ? text : (text as string[]).join('\n')).trim();
  const chars = texto.replace(/\s/g, '').length;
  const needsOcr = chars < MIN_CHARS;
  return { texto, chars, metodo: needsOcr ? 'empty' : 'text-layer', needsOcr };
}

/**
 * Extrae texto según el mime. Hoy solo PDF; otros formatos → needsOcr / vacío
 * (se ampliará). El caller decide si cae a Document AI (v0.2) cuando `needsOcr`.
 */
export async function extractText(buffer: Uint8Array, mime?: string | null): Promise<ExtractResult> {
  if (!mime || mime.includes('pdf')) {
    try {
      return await extractPdfText(buffer);
    } catch {
      return { texto: '', chars: 0, metodo: 'empty', needsOcr: true };
    }
  }
  // Formatos no-PDF: pendiente (imágenes → Document AI en v0.2).
  return { texto: '', chars: 0, metodo: 'empty', needsOcr: true };
}
