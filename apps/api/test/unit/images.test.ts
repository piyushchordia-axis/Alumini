import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors";
import { MAX_DECODED_BYTES, concurrencyLimit, decodedImageBytes, processImage } from "../../src/lib/images";

const strip = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#336699" } }).png().toBuffer();

/** Random pixels: nothing to compress, so the encoded size is predictable. */
const noise = (side: number) =>
  sharp(randomBytes(side * side * 3), { raw: { width: side, height: side, channels: 3 } })
    .png()
    .toBuffer();

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe("processImage", () => {
  it("makes an avatar of a tiny, very narrow image quickly, cropping before it enlarges", async () => {
    // Enlarged whole, 1×8000 would become 512×4,096,000 pixels for the attention crop to read: seconds of every core.
    for (const [width, height] of [
      [1, 8000],
      [8000, 1],
      [4000, 2],
      [2, 4000],
    ] as const) {
      const started = performance.now();
      const out = await processImage(await strip(width, height), "image/png", "avatar");
      expect(performance.now() - started, `${width}×${height}`).toBeLessThan(1500);
      expect(out).toMatchObject({ mime: "image/jpeg", width: 512, height: 512 });
      expect(await sharp(out.buffer).metadata()).toMatchObject({ format: "jpeg", width: 512, height: 512 });
    }
  });

  it("crops a large avatar straight down to the square", async () => {
    const out = await processImage(await strip(1600, 900), "image/png", "avatar");
    expect(out).toMatchObject({ mime: "image/jpeg", width: 512, height: 512 });
  });

  it("makes a background a JPEG on white of at most 1600 pixels, upright, never enlarged", async () => {
    const seeThrough = await sharp({ create: { width: 3200, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const wide = await processImage(seeThrough, "image/png", "backdrop");
    expect(wide).toMatchObject({ mime: "image/jpeg", width: 1600, height: 500 });
    expect(await sharp(wide.buffer).metadata()).toMatchObject({ format: "jpeg", width: 1600, height: 500, hasAlpha: false });
    // Its see-through pixels are white, not black.
    const { data } = await sharp(wide.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(data[0]!, data[1]!, data[2]!)).toBeGreaterThan(240);

    const small = await processImage(await strip(400, 300), "image/png", "backdrop");
    expect(small).toMatchObject({ mime: "image/jpeg", width: 400, height: 300 });

    // A camera photo stored on its side comes out upright: 40 wide by 80 high.
    const turned = await sharp({ create: { width: 80, height: 40, channels: 3, background: "#cc2828" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect(await processImage(turned, "image/jpeg", "backdrop")).toMatchObject({ mime: "image/jpeg", width: 40, height: 80 });
  });

  it("saves a background that is over the size limit at its lower quality, and refuses one that still doesn't fit", async () => {
    const input = await noise(600);
    const full = await processImage(input, "image/png", "backdrop");
    const smaller = await processImage(input, "image/png", "backdrop", { maxBytes: full.buffer.length - 1 });
    expect(smaller).toMatchObject({ mime: "image/jpeg", width: 600, height: 600 });
    expect(smaller.buffer.length).toBeLessThan(full.buffer.length);
    const refused = await refusal(processImage(input, "image/png", "backdrop", { maxBytes: 5_000 }));
    expect(refused).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("re-encodes a PNG that comes out over the size limit as a palette PNG, and refuses one that still doesn't fit", async () => {
    const input = await noise(200);
    const full = await processImage(input, "image/png", "image");
    expect(full.buffer.length).toBeGreaterThan(100_000);

    const palette = await processImage(input, "image/png", "image", { maxBytes: 60_000 });
    expect(palette.mime).toBe("image/png");
    expect(palette.buffer.length).toBeLessThanOrEqual(60_000);
    expect(await sharp(palette.buffer).metadata()).toMatchObject({ format: "png", width: 200, height: 200, isPalette: true });

    const refused = await refusal(processImage(input, "image/png", "image", { maxBytes: 5_000 }));
    expect(refused).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("counts the memory a decoded image needs, not only its pixels", () => {
    const pixels = 25_000_000;
    // Within the pixel limit at 8 bits per channel; twice the memory, and over the limit, at 16.
    expect(decodedImageBytes({ width: 5000, height: pixels / 5000, channels: 4, depth: "uchar" })).toBeLessThanOrEqual(MAX_DECODED_BYTES);
    expect(decodedImageBytes({ width: 5000, height: pixels / 5000, channels: 4, depth: "ushort" })).toBeGreaterThan(MAX_DECODED_BYTES);
    expect(decodedImageBytes({ width: 100, height: 100, channels: 3, depth: "uchar" })).toBe(30_000);
  });

  it("refuses a 16-bit image whose decoded size is over the limit, from its header", async () => {
    // 4,500 × 4,500 RGBA at 16 bits: 20 megapixels (within the pixel limit), 162 MB decoded.
    const deep = await sharp({ create: { width: 4500, height: 4500, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } })
      .toColourspace("rgb16")
      .png({ compressionLevel: 1 })
      .toBuffer();
    expect((await sharp(deep).metadata()).depth).toBe("ushort");
    const refused = await refusal(processImage(deep, "image/png", "image"));
    expect(refused).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });
});

describe("concurrencyLimit", () => {
  it("runs at most the limit at once and lets the rest through in order", async () => {
    const limit = concurrencyLimit(2);
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const task = (n: number) =>
      limit(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 10));
        order.push(n);
        running--;
        if (n === 2) throw new Error("fails");
        return n;
      });
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(task));
    expect(most).toBe(2);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled", "fulfilled"]);
    expect(order.slice(2).sort()).toEqual([3, 4, 5]);
    // A failure frees its slot like a success.
    expect(await limit(async () => "after")).toBe("after");
  });
});
