import { decodeExcelBuffer } from "./excel-reader";

self.onmessage = async ({ data }: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ workbook: await decodeExcelBuffer(data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Не удалось прочитать Excel." });
  }
};
