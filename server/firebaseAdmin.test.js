import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("firebase-admin/app", () => ({
  applicationDefault: vi.fn(() => ({ type: "application-default" })),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: "[DEFAULT]" })),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({ id: "firestore-db" })),
}));

describe("Firebase Admin initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("initializes Firebase Admin once and reuses the Firestore instance", async () => {
    const adminApp = await import("firebase-admin/app");
    const firestore = await import("firebase-admin/firestore");
    const { getFirebaseDb } = await import("./firebaseAdmin.js");

    const first = getFirebaseDb({ FIREBASE_PROJECT_ID: "cpjs-prod" });
    const second = getFirebaseDb({ FIREBASE_PROJECT_ID: "cpjs-prod" });

    expect(first).toBe(second);
    expect(adminApp.initializeApp).toHaveBeenCalledTimes(1);
    expect(adminApp.applicationDefault).toHaveBeenCalledTimes(1);
    expect(firestore.getFirestore).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing Firebase Admin app", async () => {
    const existingApp = { name: "[DEFAULT]" };
    const adminApp = await import("firebase-admin/app");
    vi.mocked(adminApp.getApps).mockReturnValue([existingApp]);

    const { getFirebaseAdminApp } = await import("./firebaseAdmin.js");

    expect(getFirebaseAdminApp({ FIREBASE_PROJECT_ID: "cpjs-prod" })).toBe(existingApp);
    expect(adminApp.initializeApp).not.toHaveBeenCalled();
  });
});
