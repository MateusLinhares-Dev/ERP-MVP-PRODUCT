const MAX_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITY = 0.82;
const BASE64_CHUNK = 0x8000;

export interface PreparedFile {
  nome: string;
  tipo: string;
  blob: Blob;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não consegui abrir esta foto. Tente tirar de novo.'));
    };
    image.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_BYTES) throw new Error(`O PDF "${file.name}" passa de 3 MB.`);
    return { nome: file.name, tipo: 'application/pdf', blob: file };
  }
  if (!String(file.type).startsWith('image/')) throw new Error('Envie foto ou PDF.');
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToJpeg(canvas);
  if (!blob) throw new Error('Não consegui preparar a foto.');
  if (blob.size > MAX_BYTES) throw new Error('A foto ficou grande demais.');
  return { nome: `${(file.name || 'foto').replace(/\.[^.]+$/, '')}.jpg`, tipo: 'image/jpeg', blob };
}

export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}
