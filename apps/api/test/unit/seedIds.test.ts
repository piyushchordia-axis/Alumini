import { avatarTone, uuidSchema } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import { seededMembershipId } from "../../src/db/seedIds";

const tonesOf = (slug: string, phones: string[]) => new Set(phones.map((phone) => avatarTone(seededMembershipId(slug, phone)).name));

describe("seededMembershipId", () => {
  it("gives a seed member the same id every time, a UUID the API accepts, and another at another institution or number", () => {
    const id = seededMembershipId("demo-university", "+919100000001");
    expect(seededMembershipId("demo-university", "+919100000001")).toBe(id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidSchema.safeParse(id).success).toBe(true);
    expect(seededMembershipId("demo-college", "+919100000001")).not.toBe(id);
    expect(seededMembershipId("demo-university", "+919100000002")).not.toBe(id);
  });

  it("gives members side by side in the demo initials of different colours", () => {
    // Demo University's admin, whose posts are pinned, and its best-known members: Ananya Rao, Rahul Mehta, Priya Nair.
    expect(tonesOf("demo-university", ["+919000000001", "+919100000001", "+919100000002"]).size).toBe(3);
    // The Samaj's Jignesh Patel, Hetal Shah and Bhavin Trivedi, whose initials show if their portraits don't load.
    expect(tonesOf("shri-gujarati-samaj", ["+919000000004", "+919100000031", "+919100000035"]).size).toBe(3);
  });
});
