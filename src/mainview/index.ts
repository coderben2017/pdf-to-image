import JSZip from "jszip";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { applyTranslations, getLocale, setLocale, t } from "./i18n";
import "./styles.css";

GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const PREVIEW_DPI = 120;

const byId = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少页面元素：${id}`);
  return element as T;
};

const elements = {
  localeButton: byId<HTMLButtonElement>("locale-btn"),
  uploadSection: byId<HTMLElement>("upload-section"),
  fileInput: byId<HTMLInputElement>("file-input"),
  dropZone: byId<HTMLButtonElement>("drop-zone"),
  workspace: byId<HTMLElement>("workspace"),
  fileName: byId<HTMLElement>("file-name"),
  fileMeta: byId<HTMLElement>("file-meta"),
  replaceButton: byId<HTMLButtonElement>("replace-btn"),
  resetButton: byId<HTMLButtonElement>("reset-btn"),
  watermarkText: byId<HTMLInputElement>("watermark-text"),
  dpiSelect: byId<HTMLSelectElement>("dpi-select"),
  formatSelect: byId<HTMLSelectElement>("format-select"),
  opacityRange: byId<HTMLInputElement>("opacity-range"),
  opacityValue: byId<HTMLOutputElement>("opacity-value"),
  angleSelect: byId<HTMLSelectElement>("angle-select"),
  densitySelect: byId<HTMLSelectElement>("density-select"),
  fontSizeRange: byId<HTMLInputElement>("font-size-range"),
  fontSizeValue: byId<HTMLOutputElement>("font-size-value"),
  exportButton: byId<HTMLButtonElement>("export-btn"),
  exportLabel: byId<HTMLElement>("export-label"),
  exportHint: byId<HTMLElement>("export-hint"),
  progressWrap: byId<HTMLElement>("progress-wrap"),
  progressText: byId<HTMLElement>("progress-text"),
  progressValue: byId<HTMLElement>("progress-value"),
  progressBar: byId<HTMLElement>("progress-bar"),
  previewStatus: byId<HTMLElement>("preview-status"),
  previewLoader: byId<HTMLElement>("preview-loader"),
  previewCanvas: byId<HTMLCanvasElement>("preview-canvas"),
  toast: byId<HTMLElement>("toast"),
};

let pdfDocument: PDFDocumentProxy | null = null;
let selectedFile: File | null = null;
let previewRevision = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const sanitizeFileName = (name: string) => name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "-");

const showToast = (message: string, isError = false) => {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2800);
};

const getSettings = () => ({
  text: elements.watermarkText.value.trim(),
  dpi: Number(elements.dpiSelect.value),
  format: elements.formatSelect.value as "png" | "jpeg",
  opacity: Number(elements.opacityRange.value) / 100,
  angle: Number(elements.angleSelect.value),
  density: Number(elements.densitySelect.value),
  fontSize: Number(elements.fontSizeRange.value),
});

const applyWatermark = (context: CanvasRenderingContext2D, width: number, height: number, dpi: number) => {
  const settings = getSettings();
  if (!settings.text) return;

  const pixelRatio = dpi / 72;
  const fontSize = settings.fontSize * pixelRatio;
  const horizontalGap = (310 * pixelRatio) / settings.density;
  const verticalGap = (155 * pixelRatio) / settings.density;
  const coverage = Math.hypot(width, height);

  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((settings.angle * Math.PI) / 180);
  context.globalAlpha = settings.opacity;
  context.fillStyle = "#405848";
  context.font = `650 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  let row = 0;
  for (let y = -coverage; y <= coverage; y += verticalGap) {
    const offset = row % 2 === 0 ? 0 : horizontalGap / 2;
    for (let x = -coverage; x <= coverage; x += horizontalGap) {
      context.fillText(settings.text, x + offset, y);
    }
    row += 1;
  }
  context.restore();
};

const renderPage = async (page: PDFPageProxy, dpi: number, canvas: HTMLCanvasElement) => {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法创建 Canvas 绘图上下文");

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
  applyWatermark(context, canvas.width, canvas.height, dpi);
};

const renderPreview = async () => {
  if (!pdfDocument) return;
  const revision = ++previewRevision;
  elements.previewLoader.hidden = false;
  elements.previewStatus.style.opacity = "0.45";

  try {
    const page = await pdfDocument.getPage(1);
    if (revision !== previewRevision) return;
    await renderPage(page, PREVIEW_DPI, elements.previewCanvas);
    if (revision !== previewRevision) return;
    elements.previewLoader.hidden = true;
    elements.previewStatus.style.opacity = "1";
  } catch {
    if (revision === previewRevision) showToast(t("loadFailed"), true);
  }
};

const schedulePreview = () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void renderPreview(), 180);
};

const updateLabels = () => {
  elements.opacityValue.textContent = `${elements.opacityRange.value}%`;
  elements.fontSizeValue.textContent = `${elements.fontSizeRange.value} pt`;

  const { dpi, format } = getSettings();
  const isMultiplePages = (pdfDocument?.numPages ?? 1) > 1;
  if (isMultiplePages) {
    elements.exportLabel.textContent = t("exportZip");
  } else {
    elements.exportLabel.textContent = t(format === "png" ? "exportPng" : "exportJpeg");
  }
  elements.exportHint.textContent = dpi === 300
    ? t("exportHint")
    : "A4 ≈ 4961 × 7016 px";
};

const updateFileMeta = () => {
  if (!selectedFile || !pdfDocument) return;
  elements.fileMeta.textContent = t("filePages", {
    pages: pdfDocument.numPages,
    size: formatBytes(selectedFile.size),
  });
};

const loadFile = async (file: File) => {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast(t("invalidFile"), true);
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showToast(t("fileTooLarge"), true);
    return;
  }

  elements.dropZone.disabled = true;
  try {
    await pdfDocument?.destroy();
    const data = await file.arrayBuffer();
    const nextDocument = await getDocument({ data }).promise;
    selectedFile = file;
    pdfDocument = nextDocument;
    elements.fileName.textContent = file.name;
    updateFileMeta();
    updateLabels();
    elements.uploadSection.hidden = true;
    elements.workspace.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    await renderPreview();
  } catch {
    pdfDocument = null;
    selectedFile = null;
    showToast(t("loadFailed"), true);
  } finally {
    elements.dropZone.disabled = false;
    elements.fileInput.value = "";
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement, format: "png" | "jpeg") => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("图片编码失败")),
    `image/${format}`,
    format === "jpeg" ? 0.96 : undefined,
  );
});

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const setProgress = (current: number, total: number) => {
  const percentage = Math.round((current / total) * 100);
  elements.progressText.textContent = t("exportProgress", { current, total });
  elements.progressValue.textContent = `${percentage}%`;
  elements.progressBar.style.width = `${percentage}%`;
};

const exportImages = async () => {
  if (!pdfDocument || !selectedFile) return;
  const settings = getSettings();
  const baseName = sanitizeFileName(selectedFile.name);
  const canvas = document.createElement("canvas");
  const zip = pdfDocument.numPages > 1 ? new JSZip() : null;

  elements.exportButton.disabled = true;
  elements.progressWrap.hidden = false;
  setProgress(0, pdfDocument.numPages);

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      await renderPage(page, settings.dpi, canvas);
      const blob = await canvasToBlob(canvas, settings.format);
      const suffix = pdfDocument.numPages > 1 ? `-${String(pageNumber).padStart(2, "0")}` : "";
      const fileName = `${baseName}-watermarked${suffix}.${settings.format === "jpeg" ? "jpg" : "png"}`;

      if (zip) {
        zip.file(fileName, blob);
      } else {
        downloadBlob(blob, fileName);
      }
      setProgress(pageNumber, pdfDocument.numPages);
      page.cleanup();
    }

    if (zip) {
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      downloadBlob(zipBlob, `${baseName}-watermarked.zip`);
    }
    showToast(t("complete"));
  } catch {
    showToast(t("exportFailed"), true);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    elements.exportButton.disabled = false;
    setTimeout(() => {
      elements.progressWrap.hidden = true;
      elements.progressBar.style.width = "0";
    }, 800);
  }
};

const resetSettings = () => {
  elements.watermarkText.value = t("watermarkPlaceholder");
  elements.dpiSelect.value = "300";
  elements.formatSelect.value = "png";
  elements.opacityRange.value = "15";
  elements.angleSelect.value = "-30";
  elements.densitySelect.value = "1.35";
  elements.fontSizeRange.value = "36";
  updateLabels();
  schedulePreview();
};

const bindEvents = () => {
  elements.dropZone.addEventListener("click", () => elements.fileInput.click());
  elements.replaceButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => {
    const file = elements.fileInput.files?.[0];
    if (file) void loadFile(file);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  });
  elements.dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files[0];
    if (file) void loadFile(file);
  });

  const previewInputs = [
    elements.watermarkText,
    elements.opacityRange,
    elements.angleSelect,
    elements.densitySelect,
    elements.fontSizeRange,
  ];
  previewInputs.forEach((input) => input.addEventListener("input", () => {
    updateLabels();
    schedulePreview();
  }));
  elements.dpiSelect.addEventListener("change", updateLabels);
  elements.formatSelect.addEventListener("change", updateLabels);
  elements.resetButton.addEventListener("click", resetSettings);
  elements.exportButton.addEventListener("click", () => void exportImages());
  elements.localeButton.addEventListener("click", () => {
    setLocale(getLocale() === "zh" ? "en" : "zh");
    applyTranslations();
    elements.localeButton.textContent = getLocale() === "zh" ? "EN" : "中";
    updateFileMeta();
    updateLabels();
  });
};

applyTranslations();
elements.localeButton.textContent = getLocale() === "zh" ? "EN" : "中";
bindEvents();
updateLabels();
