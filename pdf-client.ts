// Cliente del servicio de PDF compartido de platform (`POST /internal/pdf`).
//
// La app compone su HTML (plantilla + macros, que son SUYAS) y delega solo el
// "pintar a PDF" en platform, que aloja Chromium con pool + reintentos para
// toda la flota — así ninguna app embebe Chromium.
//
// Uso (server-side): la app pasa su `PLATFORM_INTERNAL_URL` + `APPS_REGISTER_SECRET`
// (mismos que ya usa para otros inter de platform), y el HTML ya renderizado.

export interface RenderPdfOptions {
  /** Márgenes de página (Puppeteer PDF margin). Default: sin márgenes (los pone el CSS). */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  /** Formato de página. Default 'a4'. */
  format?: string;
}

export interface RenderPdfViaPlatformArgs {
  /** URL interna de platform (p.ej. `PLATFORM_INTERNAL_URL` de la app). */
  platformUrl: string;
  /** Clave de servicio (`APPS_REGISTER_SECRET`), va como `X-Service-Key`. */
  serviceKey: string;
  /** HTML COMPLETO, ya con las macros sustituidas. */
  html: string;
  opts?: RenderPdfOptions;
}

/**
 * Renderiza `html` como PDF (Uint8Array) llamando al servicio de platform.
 * Lanza si el servicio responde con error.
 */
export async function renderPdfViaPlatform(args: RenderPdfViaPlatformArgs): Promise<Uint8Array> {
  const base = args.platformUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/internal/pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Key': args.serviceKey,
    },
    body: JSON.stringify({ html: args.html, opts: args.opts }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Servicio PDF de platform devolvió ${res.status}: ${text.slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
