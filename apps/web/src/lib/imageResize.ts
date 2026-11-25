export interface ResizedImageResult {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  originalSize: number;
  resizedSize: number;
}

interface LoadedImageSource {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, targetWidth: number, targetHeight: number) => void;
  cleanup: () => void;
}

function loadImageElement(file: File): Promise<LoadedImageSource> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, targetWidth, targetHeight) => {
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        },
        cleanup: () => {
          URL.revokeObjectURL(objectUrl);
        },
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error('Unable to decode the selected image. Please try a JPEG, PNG, or WebP photo.'),
      );
    };

    img.src = objectUrl;
  });
}

async function loadImageSource(file: File): Promise<LoadedImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, targetWidth, targetHeight) => {
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
        },
        cleanup: () => {
          bitmap.close();
        },
      };
    } catch {
      // Fallback to HTMLImageElement + object URL when createImageBitmap is unsupported for this image
    }
  }

  return loadImageElement(file);
}

function buildJpegFilename(originalName: string): string {
  const baseName = originalName.replace(/\.[^.]+$/, '').trim();
  const safeName = baseName.length > 0 ? baseName : 'meal-photo';
  return `${safeName}.jpg`;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode image as JPEG.'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Resizes an uploaded image via HTML5 canvas so its longest edge is <= maxDimension,
 * encodes it as JPEG at the requested quality, and returns a clean File + object URL preview.
 */
export async function resizeImageForUpload(
  file: File,
  maxDimension = 1024,
  quality = 0.8,
): Promise<ResizedImageResult> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (JPEG, PNG, or WebP).');
  }

  const source = await loadImageSource(file);

  try {
    if (source.width <= 0 || source.height <= 0) {
      throw new Error('Selected image has invalid dimensions.');
    }

    const longestSide = Math.max(source.width, source.height);
    const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is not available.');
    }

    // Paint a solid background before JPEG encoding so transparent PNG/WebP areas stay clean
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    source.draw(ctx, width, height);

    const blob = await canvasToJpegBlob(canvas, quality);
    const resizedFile = new File([blob], buildJpegFilename(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
    const previewUrl = URL.createObjectURL(resizedFile);

    return {
      file: resizedFile,
      previewUrl,
      width,
      height,
      originalSize: file.size,
      resizedSize: resizedFile.size,
    };
  } finally {
    source.cleanup();
  }
}
