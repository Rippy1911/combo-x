declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export function getDocument(src: unknown): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getTextContent(): Promise<{ items: unknown[] }>;
      }>;
    }>;
  };
}
