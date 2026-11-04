import { MAX_UPLOAD_BYTES, imageFileProblem } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** Both apps check a picked file with this before uploading it, so a wrong one fails at once and in the same words. */
describe("imageFileProblem", () => {
  it("lets a JPEG, PNG or WebP within the size limit through, and one of unknown size", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) expect(imageFileProblem({ type, size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(imageFileProblem({ type: "image/jpeg" })).toBeNull();
    expect(imageFileProblem({ type: "image/png", size: null })).toBeNull();
  });

  it("refuses another kind of file, or one without a type", () => {
    for (const type of ["image/heic", "image/gif", "text/plain", "application/pdf", "", null, undefined]) {
      expect(imageFileProblem({ type, size: 10 }), String(type)).toBe("Choose a JPEG, PNG or WebP image.");
    }
  });

  it("refuses a file over the upload limit, naming the limit", () => {
    expect(imageFileProblem({ type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 })).toBe("Choose an image under 5 MB.");
  });
});
