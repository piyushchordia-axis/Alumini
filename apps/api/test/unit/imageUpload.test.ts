import { IMAGE_TYPE_PROBLEM, MAX_IMAGE_SIDE, MAX_UPLOAD_BYTES, UPLOAD_JPEG_QUALITY, imageFileProblem } from "@illuminize/shared";
import { PHOTO_UPLOAD_MAX_SIDE, fitWithin, photoUploadPlan, prepareImageFile } from "@illuminize/shared/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const KB = 1024;
const MB = 1024 * KB;

describe("fitWithin", () => {
  it("scales the longest side down to the limit, keeping the shape", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
    // Rounded as the server rounds it (see the uploads integration test).
    expect(fitWithin(3000, 1000, 2048)).toEqual({ width: 2048, height: 683 });
    expect(fitWithin(6000, 6000, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it("never enlarges, and keeps a sliver at least a pixel wide", () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2048, 10, 2048)).toEqual({ width: 2048, height: 10 });
    expect(fitWithin(1, 8000, 1024)).toEqual({ width: 1, height: 1024 });
  });

  it("gives 0 × 0 while a side is unknown", () => {
    expect(fitWithin(0, 3000, 2048)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(4000, Number.NaN, 2048)).toEqual({ width: 0, height: 0 });
  });
});

describe("photoUploadPlan", () => {
  const jpeg = (size: number, width?: number, height?: number) => ({ type: "image/jpeg", size, width, height });

  it("fits a profile photo within 1024 pixels and anything else within the server's 2048", () => {
    expect(PHOTO_UPLOAD_MAX_SIDE).toBe(1024);
    expect(MAX_IMAGE_SIDE).toBe(2048);
    expect(photoUploadPlan(jpeg(3 * MB, 4000, 3000), "avatar")).toMatchObject({ reencode: true, maxSide: 1024, width: 1024, height: 768 });
    expect(photoUploadPlan(jpeg(3 * MB, 4000, 3000), "image")).toMatchObject({ reencode: true, maxSide: 2048, width: 2048, height: 1536 });
  });

  it("leaves a photo the server takes as it is when it is small enough", () => {
    expect(photoUploadPlan(jpeg(300 * KB, 800, 800), "avatar")).toEqual({ reencode: false, maxSide: 1024, width: 800, height: 800, keepsAlpha: false });
    expect(photoUploadPlan(jpeg(3 * MB, 2048, 1536), "image")).toEqual({ reencode: false, maxSide: 2048, width: 2048, height: 1536, keepsAlpha: false });
    // Sides not known yet (a browser's File) don't force it either.
    expect(photoUploadPlan(jpeg(300 * KB), "image")).toEqual({ reencode: false, maxSide: 2048, width: 0, height: 0, keepsAlpha: false });
  });

  it("always saves a type the server refuses again, HEIC and HEIF included", () => {
    for (const type of ["image/heic", "image/heif", "image/gif", "", null, undefined]) {
      expect(photoUploadPlan({ type, size: 100 * KB, width: 100, height: 100 }, "image").reencode, String(type)).toBe(true);
    }
  });

  it("saves again a photo over the upload limit or with a side over the purpose's", () => {
    expect(photoUploadPlan(jpeg(MAX_UPLOAD_BYTES + 1, 1000, 800), "image").reencode).toBe(true);
    expect(photoUploadPlan(jpeg(MAX_UPLOAD_BYTES, 1000, 800), "image").reencode).toBe(false);
    expect(photoUploadPlan(jpeg(100 * KB, 2049, 10), "image").reencode).toBe(true);
    expect(photoUploadPlan(jpeg(100 * KB, 10, 1025), "avatar").reencode).toBe(true);
    expect(photoUploadPlan(jpeg(100 * KB, 10, 1025), "image").reencode).toBe(false);
  });

  it("shrinks a profile photo from 512 KB, as it is only ever shown small", () => {
    expect(photoUploadPlan(jpeg(512 * KB - 1, 800, 800), "avatar").reencode).toBe(false);
    expect(photoUploadPlan(jpeg(512 * KB, 800, 800), "avatar").reencode).toBe(true);
    expect(photoUploadPlan(jpeg(4 * MB, 800, 800), "image").reencode).toBe(false);
  });

  it("saves it again whatever it looks like when asked to (a phone's picker can mislabel HEIF)", () => {
    expect(photoUploadPlan(jpeg(10 * KB, 100, 100), "image", { always: true }).reencode).toBe(true);
    expect(photoUploadPlan(jpeg(10 * KB, 100, 100), "avatar", { always: true })).toMatchObject({ reencode: true, width: 100, height: 100 });
  });

  it("keeps transparency for any source that may have some: all but JPEG and HEIC or HEIF", () => {
    const keepsAlpha = (type: string | null | undefined) => photoUploadPlan({ type, size: 10 * KB, width: 10, height: 10 }, "image").keepsAlpha;
    // A GIF or a type the picker didn't give would otherwise be a JPEG, whose see-through parts a phone makes black.
    for (const type of ["image/png", "image/webp", "image/gif", "image/avif", "", null, undefined]) expect(keepsAlpha(type), String(type)).toBe(true);
    for (const type of ["image/jpeg", "image/jpg", "IMAGE/JPEG", "image/heic", "image/heif"]) expect(keepsAlpha(type), type).toBe(false);
    expect(photoUploadPlan({ type: "image/png", size: 2 * MB, width: 3000, height: 3000 }, "avatar").keepsAlpha).toBe(true);
  });
});

/**
 * A browser as prepareImageFile uses it. `sizes` gives the upright size of each file it can decode, by name; any other
 * fails to decode, as HEIC does outside Safari. `encoded` gives the byte size of what the canvas encodes.
 */
function fakeBrowser({ sizes, encoded }: { sizes: Record<string, { width: number; height: number }>; encoded: (type: string) => number }) {
  const seen = { decoded: 0, closed: 0, canvases: [] as Array<{ width: number; height: number; ops: string[] }> };
  vi.stubGlobal("createImageBitmap", async (file: File, options: { imageOrientation: string }) => {
    seen.decoded++;
    expect(options).toEqual({ imageOrientation: "from-image" });
    const size = sizes[file.name];
    if (!size) throw new DOMException("The source image could not be decoded.", "InvalidStateError");
    return { ...size, close: () => void seen.closed++ };
  });
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("canvas");
      const ops: string[] = [];
      const g = {
        fillStyle: "",
        fillRect: (_x: number, _y: number, w: number, h: number) => void ops.push(`fill ${g.fillStyle} ${w}x${h}`),
        drawImage: (_image: unknown, _x: number, _y: number, w: number, h: number) => void ops.push(`draw ${w}x${h}`),
      };
      const canvas = {
        width: 0,
        height: 0,
        ops,
        getContext: () => g,
        toBlob: (done: (blob: Blob | null) => void, type: string, quality: number) => {
          ops.push(`encode ${type} ${quality}`);
          done(new Blob([new Uint8Array(encoded(type))], { type }));
        },
      };
      seen.canvases.push(canvas);
      return canvas;
    },
  });
  return seen;
}

const photo = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type });
const facts = (file: File) => ({ name: file.name, type: file.type, size: file.size });
const JPEG_AT = `encode image/jpeg ${UPLOAD_JPEG_QUALITY}`;
const PNG_AT = `encode image/png ${UPLOAD_JPEG_QUALITY}`;

describe("prepareImageFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes even a small photo to learn its sides, and sends it as it is when they fit", async () => {
    const seen = fakeBrowser({ sizes: { "small.jpg": { width: 1000, height: 750 } }, encoded: () => 10 * KB });
    const small = photo("small.jpg", "image/jpeg", 500 * KB);
    expect(await prepareImageFile(small)).toBe(small);
    expect(await prepareImageFile(small, { purpose: "avatar" })).toBe(small);
    expect(seen.decoded).toBe(2);
    expect(seen.canvases).toHaveLength(0);
    expect(seen.closed).toBe(2);
  });

  it("makes a 300 KB PNG of 9000 × 6000 pixels (over the server's 40 megapixels) 2048 pixels wide", async () => {
    const seen = fakeBrowser({ sizes: { "banner.png": { width: 9000, height: 6000 }, "me.png": { width: 9000, height: 6000 } }, encoded: () => 200 * KB });
    const banner = await prepareImageFile(photo("banner.png", "image/png", 300 * KB), { purpose: "image" });
    expect(facts(banner)).toMatchObject({ name: "banner.png", type: "image/png", size: 200 * KB });
    expect(seen.canvases[0]).toMatchObject({ width: 2048, height: 1365, ops: ["draw 2048x1365", PNG_AT] });
    const avatar = await prepareImageFile(photo("me.png", "image/png", 300 * KB), { purpose: "avatar" });
    expect(facts(avatar)).toMatchObject({ name: "me.jpg", type: "image/jpeg" });
    expect(seen.canvases[1]).toMatchObject({ width: 1024, height: 683 });
  });

  it("makes a PNG of a GIF, keeping its transparency", async () => {
    const seen = fakeBrowser({ sizes: { "logo.gif": { width: 400, height: 400 } }, encoded: () => 40 * KB });
    const prepared = await prepareImageFile(photo("logo.gif", "image/gif", 30 * KB));
    expect(facts(prepared)).toMatchObject({ name: "logo.png", type: "image/png", size: 40 * KB });
    expect(imageFileProblem(prepared)).toBeNull();
    expect(seen.canvases[0]!.ops).toEqual(["draw 400x400", PNG_AT]);
  });

  it("makes a 6 MB 4000×3000 camera photo a 2048×1536 JPEG", async () => {
    const seen = fakeBrowser({ sizes: { "IMG_0001.jpg": { width: 4000, height: 3000 } }, encoded: () => 600 * KB });
    const camera = photo("IMG_0001.jpg", "image/jpeg", 6 * MB);
    expect(imageFileProblem(camera)).not.toBeNull();
    const prepared = await prepareImageFile(camera, { purpose: "image" });
    expect(facts(prepared)).toMatchObject({ name: "IMG_0001.jpg", type: "image/jpeg", size: 600 * KB });
    expect(imageFileProblem(prepared)).toBeNull();
    expect(seen.canvases).toMatchObject([{ width: 2048, height: 1536, ops: ["fill #ffffff 2048x1536", "draw 2048x1536", JPEG_AT] }]);
    expect(seen.closed).toBe(1);
  });

  it("makes a JPEG of a HEIC photo the browser can decode, however small", async () => {
    const seen = fakeBrowser({ sizes: { "IMG_0002.HEIC": { width: 4032, height: 3024 } }, encoded: () => 700 * KB });
    const prepared = await prepareImageFile(photo("IMG_0002.HEIC", "image/heic", 300 * KB));
    // Bigger than the HEIC, but the HEIC couldn't go at all.
    expect(facts(prepared)).toMatchObject({ name: "IMG_0002.jpg", type: "image/jpeg", size: 700 * KB });
    expect(imageFileProblem(prepared)).toBeNull();
    expect(seen.canvases[0]).toMatchObject({ width: 2048, height: 1536 });
  });

  it("gives back a HEIC photo the browser can't decode, which the apps then refuse in the usual words", async () => {
    const seen = fakeBrowser({ sizes: {}, encoded: () => 10 * KB });
    const heic = photo("IMG_0003.HEIC", "image/heic", 2 * MB);
    const prepared = await prepareImageFile(heic);
    expect(prepared).toBe(heic);
    expect(seen.decoded).toBe(1);
    expect(imageFileProblem(prepared)).toBe(IMAGE_TYPE_PROBLEM);
  });

  it("keeps a large PNG a PNG, with nothing painted under its transparency", async () => {
    const seen = fakeBrowser({ sizes: { "logo.png": { width: 3000, height: 2000 } }, encoded: () => 2 * MB });
    const prepared = await prepareImageFile(photo("logo.png", "image/png", 3 * MB), { purpose: "image" });
    expect(facts(prepared)).toMatchObject({ name: "logo.png", type: "image/png", size: 2 * MB });
    expect(seen.canvases).toMatchObject([{ width: 2048, height: 1365, ops: ["draw 2048x1365", PNG_AT] }]);
  });

  it("makes a JPEG on white after all when the PNG would be over the upload limit", async () => {
    const seen = fakeBrowser({ sizes: { "photo.webp": { width: 4000, height: 3000 } }, encoded: (type) => (type === "image/png" ? 6 * MB : 900 * KB) });
    const prepared = await prepareImageFile(photo("photo.webp", "image/webp", 4 * MB));
    expect(facts(prepared)).toMatchObject({ name: "photo.jpg", type: "image/jpeg", size: 900 * KB });
    expect(seen.canvases[0]!.ops).toEqual(["draw 2048x1536", PNG_AT, "fill #ffffff 2048x1536", "draw 2048x1536", JPEG_AT]);
  });

  it("makes a profile photo of 512 KB or more a JPEG on white of at most 1024 pixels, a PNG included", async () => {
    const seen = fakeBrowser({ sizes: { "me.png": { width: 3000, height: 3000 }, "me.jpg": { width: 800, height: 600 } }, encoded: () => 200 * KB });
    const fromPng = await prepareImageFile(photo("me.png", "image/png", 2 * MB), { purpose: "avatar" });
    expect(facts(fromPng)).toMatchObject({ name: "me.jpg", type: "image/jpeg", size: 200 * KB });
    expect(seen.canvases[0]).toMatchObject({ width: 1024, height: 1024, ops: ["fill #ffffff 1024x1024", "draw 1024x1024", JPEG_AT] });
    // Within the side already, but over 512 KB: saved again at its own size.
    const fromJpeg = await prepareImageFile(photo("me.jpg", "image/jpeg", 600 * KB), { purpose: "avatar" });
    expect(facts(fromJpeg)).toMatchObject({ type: "image/jpeg", size: 200 * KB });
    expect(seen.canvases[1]).toMatchObject({ width: 800, height: 600 });
  });

  it("keeps the original when it needs nothing or saving it again gains nothing", async () => {
    const seen = fakeBrowser({ sizes: { "fits.jpg": { width: 1600, height: 1200 }, "me.jpg": { width: 800, height: 800 } }, encoded: () => 700 * KB });
    // Decoded to learn its size, which already fits: never encoded.
    const fits = photo("fits.jpg", "image/jpeg", 1 * MB);
    expect(await prepareImageFile(fits)).toBe(fits);
    expect(seen.canvases).toHaveLength(0);
    // A profile photo that would come out bigger.
    const me = photo("me.jpg", "image/jpeg", 600 * KB);
    expect(await prepareImageFile(me, { purpose: "avatar" })).toBe(me);
    expect(seen.canvases).toHaveLength(1);
    expect(seen.closed).toBe(2);
  });

  it("sends the smaller version even if it is bigger in bytes when the original's sides are over the limit", async () => {
    fakeBrowser({ sizes: { "flat.png": { width: 8000, height: 6000 } }, encoded: () => 1.5 * MB });
    const prepared = await prepareImageFile(photo("flat.png", "image/png", 1 * MB));
    expect(facts(prepared)).toMatchObject({ name: "flat.png", type: "image/png", size: 1.5 * MB });
  });

  it("gives back the file where the browser can't prepare it", async () => {
    const big = photo("IMG_0004.jpg", "image/jpeg", 6 * MB);
    expect(await prepareImageFile(big)).toBe(big);
  });
});
