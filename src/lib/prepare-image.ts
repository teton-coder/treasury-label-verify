import { MAX_IMAGE_EDGE_PX, MAX_UPLOAD_BYTES } from "./constants";

/**
 * Downscale and re-encode an image in the browser before upload.
 * Phone photos are often 5-12 MB; sending a 2000px JPEG instead cuts upload
 * time and model latency substantially and keeps us under the 4.5 MB body cap.
 * Also applies EXIF orientation (createImageBitmap does this by default).
 */
export async function prepareImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Browser couldn't decode it; send as-is and let the server validate.
    return file;
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_UPLOAD_BYTES && file.type === "image/jpeg") {
    bitmap.close();
    return file;
  }
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.fillStyle = "#fff"; // flatten transparent PNGs
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  for (const quality of [0.9, 0.8, 0.65]) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) {
      return new File([blob], file.name, { type: "image/jpeg" });
    }
  }
  return file;
}
