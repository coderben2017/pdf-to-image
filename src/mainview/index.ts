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
  uploadLoader: byId<HTMLElement>("upload-loader"),
  workspace: byId<HTMLElement>("workspace"),
  fileName: byId<HTMLElement>("file-name"),
  fileMeta: byId<HTMLElement>("file-meta"),
  replaceButton: byId<HTMLButtonElement>("replace-btn"),
  resetButton: byId<HTMLButtonElement>("reset-btn"),
  textContent: byId<HTMLTextAreaElement>("text-content"),
  dpiSelect: byId<HTMLSelectElement>("dpi-select"),
  formatSelect: byId<HTMLSelectElement>("format-select"),
  opacityRange: byId<HTMLInputElement>("opacity-range"),
  opacityValue: byId<HTMLOutputElement>("opacity-value"),
  angleSelect: byId<HTMLSelectElement>("angle-select"),
  textColor: byId<HTMLInputElement>("text-color"),
  textColorValue: byId<HTMLOutputElement>("text-color-value"),
  fontSizeRange: byId<HTMLInputElement>("font-size-range"),
  fontSizeValue: byId<HTMLOutputElement>("font-size-value"),
  positionXRange: byId<HTMLInputElement>("position-x-range"),
  positionXValue: byId<HTMLOutputElement>("position-x-value"),
  positionYRange: byId<HTMLInputElement>("position-y-range"),
  positionYValue: byId<HTMLOutputElement>("position-y-value"),
  exportButton: byId<HTMLButtonElement>("export-btn"),
  exportLabel: byId<HTMLElement>("export-label"),
  exportHint: byId<HTMLElement>("export-hint"),
  progressWrap: byId<HTMLElement>("progress-wrap"),
  progressText: byId<HTMLElement>("progress-text"),
  progressValue: byId<HTMLElement>("progress-value"),
  progressBar: byId<HTMLElement>("progress-bar"),
  previewStatus: byId<HTMLElement>("preview-status"),
  previewStage: byId<HTMLElement>("preview-stage"),
  previewLoader: byId<HTMLElement>("preview-loader"),
  previewPage: byId<HTMLElement>("preview-page"),
  previewCanvas: byId<HTMLCanvasElement>("preview-canvas"),
  previewTextAnchor: byId<HTMLElement>("preview-text-anchor"),
  previewText: byId<HTMLElement>("preview-text"),
  zoomOutButton: byId<HTMLButtonElement>("zoom-out-btn"),
  zoomInButton: byId<HTMLButtonElement>("zoom-in-btn"),
  zoomValue: byId<HTMLOutputElement>("zoom-value"),
  toast: byId<HTMLElement>("toast"),
};

let pdfDocument: PDFDocumentProxy | null = null;
let selectedFile: File | null = null;
let previewRevision = 0;
let previewZoom = 1;
let panStartX = 0;
let panStartY = 0;
let panStartScrollLeft = 0;
let panStartScrollTop = 0;
let textDragOffsetX = 0;
let textDragOffsetY = 0;

let isPositioningText = false;
let isPanningPreview = false;

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
  text: elements.textContent.value.trim(),
  dpi: Number(elements.dpiSelect.value),
  format: elements.formatSelect.value as "png" | "jpeg",
  opacity: Number(elements.opacityRange.value) / 100,
  angle: Number(elements.angleSelect.value),
  color: elements.textColor.value,
  fontSize: Number(elements.fontSizeRange.value),
  positionX: Number(elements.positionXRange.value) / 100,
  positionY: Number(elements.positionYRange.value) / 100,
});

const applyPlacedText = (context: CanvasRenderingContext2D, width: number, height: number, dpi: number) => {
  const settings = getSettings();
  if (!settings.text) return;

  const pixelRatio = dpi / 72;
  const fontSize = settings.fontSize * pixelRatio;
  const positionX = width * settings.positionX;
  const positionY = height * settings.positionY;
  const lines = settings.text.split(/\r?\n/);
  const lineHeight = fontSize * 1.35;

  context.save();
  context.translate(positionX, positionY);
  context.rotate((settings.angle * Math.PI) / 180);
  context.globalAlpha = settings.opacity;
  context.fillStyle = settings.color;
  context.font = `650 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "bottom";
  lines.forEach((line, index) => {
    const offsetY = (index - lines.length + 1) * lineHeight;
    context.fillText(line, 0, offsetY);
  });
  context.restore();
};

const renderPage = async (
  page: PDFPageProxy,
  dpi: number,
  canvas: HTMLCanvasElement,
  includePlacedText = true,
) => {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法创建 Canvas 绘图上下文");

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
  if (includePlacedText) applyPlacedText(context, canvas.width, canvas.height, dpi);
};

const updatePreviewText = () => {
  const settings = getSettings();
  const displayScale = elements.previewCanvas.width === 0
    ? 0
    : elements.previewPage.clientWidth / elements.previewCanvas.width;
  const fontSize = settings.fontSize * (PREVIEW_DPI / 72) * displayScale;

  elements.previewTextAnchor.hidden = !settings.text;
  elements.previewTextAnchor.style.left = `${settings.positionX * 100}%`;
  elements.previewTextAnchor.style.top = `${settings.positionY * 100}%`;
  elements.previewTextAnchor.style.transform = `rotate(${settings.angle}deg)`;
  elements.previewText.textContent = settings.text;
  elements.previewText.style.color = settings.color;
  elements.previewText.style.fontSize = `${fontSize}px`;
  elements.previewText.style.opacity = String(settings.opacity);
};

const updatePreviewSize = () => {
  if (elements.previewCanvas.width === 0 || elements.previewCanvas.height === 0) return;

  const availableWidth = Math.max(240, elements.previewStage.clientWidth - 48);
  const availableHeight = Math.max(300, elements.previewStage.clientHeight - 48);
  const fitScale = Math.min(
    availableWidth / elements.previewCanvas.width,
    availableHeight / elements.previewCanvas.height,
  );
  const displayWidth = Math.round(elements.previewCanvas.width * fitScale * previewZoom);
  const displayHeight = Math.round(elements.previewCanvas.height * fitScale * previewZoom);
  elements.previewPage.style.width = `${displayWidth}px`;
  elements.previewPage.style.height = `${displayHeight}px`;
  elements.zoomValue.textContent = `${Math.round(previewZoom * 100)}%`;
  elements.zoomOutButton.disabled = previewZoom <= 0.5;
  elements.zoomInButton.disabled = previewZoom >= 2;
  updatePreviewText();
};

const setPreviewZoom = (zoom: number) => {
  previewZoom = Math.min(2, Math.max(0.5, zoom));
  updatePreviewSize();
};

const renderPreview = async () => {
  if (!pdfDocument) return;
  const revision = ++previewRevision;
  elements.previewLoader.hidden = false;
  elements.previewStatus.style.opacity = "0.45";

  try {
    const page = await pdfDocument.getPage(1);
    if (revision !== previewRevision) return;
    await renderPage(page, PREVIEW_DPI, elements.previewCanvas, false);
    if (revision !== previewRevision) return;
    updatePreviewSize();
    elements.previewLoader.hidden = true;
    elements.previewStatus.style.opacity = "1";
  } catch {
    if (revision === previewRevision) showToast(t("loadFailed"), true);
  }
};

const updateLabels = () => {
  elements.opacityValue.textContent = `${elements.opacityRange.value}%`;
  elements.textColorValue.textContent = elements.textColor.value.toUpperCase();
  elements.fontSizeValue.textContent = `${elements.fontSizeRange.value} pt`;
  elements.positionXValue.textContent = `${elements.positionXRange.value}%`;
  elements.positionYValue.textContent = `${elements.positionYRange.value}%`;

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
  elements.dropZone.setAttribute("aria-busy", "true");
  elements.dropZone.classList.add("is-loading");
  elements.uploadLoader.hidden = false;
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
    elements.dropZone.setAttribute("aria-busy", "false");
    elements.dropZone.classList.remove("is-loading");
    elements.uploadLoader.hidden = true;
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
      const fileName = `${baseName}-annotated${suffix}.${settings.format === "jpeg" ? "jpg" : "png"}`;

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
      downloadBlob(zipBlob, `${baseName}-annotated.zip`);
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
  elements.textContent.value = t("textPlaceholder");
  elements.dpiSelect.value = "300";
  elements.formatSelect.value = "png";
  elements.opacityRange.value = "100";
  elements.angleSelect.value = "0";
  elements.textColor.value = "#000000";
  elements.fontSizeRange.value = "16";
  elements.positionXRange.value = "10";
  elements.positionYRange.value = "70";
  setPreviewZoom(1);
  updateLabels();
  updatePreviewText();
};

const updatePositionFromPointer = (event: PointerEvent) => {
  const bounds = elements.previewPage.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return;

  const pointerX = ((event.clientX - bounds.left) / bounds.width) * 100;
  const pointerY = ((event.clientY - bounds.top) / bounds.height) * 100;
  const positionX = Math.min(100, Math.max(0, pointerX - textDragOffsetX));
  const positionY = Math.min(100, Math.max(0, pointerY - textDragOffsetY));
  elements.positionXRange.value = String(Math.round(positionX));
  elements.positionYRange.value = String(Math.round(positionY));
  updateLabels();
  updatePreviewText();
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
    elements.textContent,
    elements.opacityRange,
    elements.angleSelect,
    elements.textColor,
    elements.fontSizeRange,
    elements.positionXRange,
    elements.positionYRange,
  ];
  previewInputs.forEach((input) => input.addEventListener("input", () => {
    updateLabels();
    updatePreviewText();
  }));
  elements.dpiSelect.addEventListener("change", updateLabels);
  elements.formatSelect.addEventListener("change", updateLabels);
  elements.resetButton.addEventListener("click", resetSettings);
  elements.exportButton.addEventListener("click", () => void exportImages());
  elements.zoomOutButton.addEventListener("click", () => setPreviewZoom(previewZoom - 0.25));
  elements.zoomInButton.addEventListener("click", () => setPreviewZoom(previewZoom + 0.25));
  elements.previewText.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = elements.previewPage.getBoundingClientRect();
    const settings = getSettings();
    textDragOffsetX = ((event.clientX - bounds.left) / bounds.width) * 100 - settings.positionX * 100;
    textDragOffsetY = ((event.clientY - bounds.top) / bounds.height) * 100 - settings.positionY * 100;
    isPositioningText = true;
    elements.previewText.classList.add("is-positioning");
    elements.previewText.setPointerCapture(event.pointerId);
  });
  elements.previewText.addEventListener("pointermove", (event) => {
    if (isPositioningText) updatePositionFromPointer(event);
  });
  elements.previewText.addEventListener("pointerup", (event) => {
    isPositioningText = false;
    elements.previewText.classList.remove("is-positioning");
    elements.previewText.releasePointerCapture(event.pointerId);
  });
  elements.previewText.addEventListener("pointercancel", () => {
    isPositioningText = false;
    elements.previewText.classList.remove("is-positioning");
  });
  elements.previewStage.addEventListener("pointerdown", (event) => {
    if (!pdfDocument || event.button !== 0) return;
    event.preventDefault();
    isPanningPreview = true;
    panStartX = event.clientX;
    panStartY = event.clientY;
    panStartScrollLeft = elements.previewStage.scrollLeft;
    panStartScrollTop = elements.previewStage.scrollTop;
    elements.previewStage.classList.add("is-panning");
    elements.previewStage.setPointerCapture(event.pointerId);
  });
  elements.previewStage.addEventListener("pointermove", (event) => {
    if (!isPanningPreview) return;
    elements.previewStage.scrollLeft = panStartScrollLeft - (event.clientX - panStartX);
    elements.previewStage.scrollTop = panStartScrollTop - (event.clientY - panStartY);
  });
  elements.previewStage.addEventListener("pointerup", (event) => {
    if (!isPanningPreview) return;
    isPanningPreview = false;
    elements.previewStage.classList.remove("is-panning");
    elements.previewStage.releasePointerCapture(event.pointerId);
  });
  elements.previewStage.addEventListener("pointercancel", () => {
    isPanningPreview = false;
    elements.previewStage.classList.remove("is-panning");
  });
  elements.previewStage.addEventListener("wheel", (event) => {
    if (!pdfDocument) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 0.1 : -0.1;
    setPreviewZoom(Math.round((previewZoom + direction) * 10) / 10);
  }, { passive: false });
  elements.localeButton.addEventListener("click", () => {
    setLocale(getLocale() === "zh" ? "en" : "zh");
    applyTranslations();
    elements.localeButton.textContent = getLocale() === "zh" ? "EN" : "中";
    updateFileMeta();
    updateLabels();
  });
  window.addEventListener("resize", updatePreviewSize);
};

applyTranslations();
elements.localeButton.textContent = getLocale() === "zh" ? "EN" : "中";
bindEvents();
updateLabels();
