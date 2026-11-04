import { UPLOAD_TIMEOUT_MESSAGE, isUploadCancelled, startUpload } from "@illuminize/shared/client";
import { describe, expect, it } from "vitest";

/** An upload that ends only when its signal aborts, as fetch does. */
const hanging = (signal: AbortSignal) =>
  new Promise<string>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });

/** Both apps upload photos through startUpload, so a slow upload can be abandoned and a stalled one ends. */
describe("startUpload", () => {
  it("passes a finished upload's result and a failure's error through", async () => {
    await expect(startUpload(async () => "https://files/1.jpg").promise).resolves.toBe("https://files/1.jpg");
    await expect(
      startUpload(async () => {
        throw new Error("Server said no");
      }).promise,
    ).rejects.toThrow("Server said no");
  });

  it("rejects a cancelled upload with a marker the apps show nothing for", async () => {
    const upload = startUpload(hanging);
    upload.cancel();
    const err = await upload.promise.catch((e: unknown) => e);
    expect(isUploadCancelled(err)).toBe(true);
  });

  it("gives up on an upload that takes too long, saying so", async () => {
    const err = await startUpload(hanging, 20).promise.catch((e: unknown) => e);
    expect(isUploadCancelled(err)).toBe(false);
    expect((err as Error).message).toBe(UPLOAD_TIMEOUT_MESSAGE);
  });
});
