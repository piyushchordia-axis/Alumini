import sharp from "sharp";

/*
 * Real images for upload tests, made with sharp when the tests run. Every upload is decoded and re-encoded, so a buffer
 * that only starts with an image's magic bytes is refused.
 */

/** A PNG with see-through pixels, so an avatar's white background shows. */
export function testPng(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 0.5 } } })
    .png()
    .toBuffer();
}

/** Written into the camera photo's GPS block, so a test can see the block is gone. */
export const GPS_MARKER = "WGS-84";
export const CAMERA_MAKE = "SmokeCam";

/**
 * A photo as a phone camera saves it: stored 80 wide by 40 high with EXIF orientation 6 (shown turned a quarter clockwise,
 * so 40 by 80), the camera's make and a GPS position.
 */
export function cameraJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 80, height: 40, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .withExif({
      IFD0: { Make: CAMERA_MAKE },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 4/1 30/1", GPSLongitudeRef: "E", GPSLongitude: "72/1 52/1 0/1", GPSMapDatum: GPS_MARKER },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

/** PNG magic bytes followed by noise: passes the type check, fails to decode. */
export const CORRUPT_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
