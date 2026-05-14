import { describe, expect, it, vi } from "vitest";
import { createDeliveryServices, DeliveryError } from "./delivery.js";

describe("production delivery services", () => {
  const env = {
    SENDGRID_API_KEY: "SG.secret-value",
    SENDGRID_FROM_EMAIL: "noreply@cruzpham.com",
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "twilio-secret-value",
    TWILIO_FROM_NUMBER: "+15550000000",
  };

  it("sends email through SendGrid with server-only credentials", async () => {
    const sgMail = {
      setApiKey: vi.fn(),
      send: vi.fn().mockResolvedValue([{ statusCode: 202, headers: { "x-message-id": "msg-1" } }]),
    };
    const delivery = createDeliveryServices({ env, sgMail, twilioFactory: vi.fn(), log: vi.fn() });

    const result = await delivery.sendEmail("admin@example.com", "Subject", "Body", "corr-1");

    expect(result.status).toBe("SENT");
    expect(sgMail.setApiKey).toHaveBeenCalledWith(env.SENDGRID_API_KEY);
    expect(sgMail.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@example.com",
      from: "noreply@cruzpham.com",
    }));
  });

  it("sends SMS through Twilio with normalized phone numbers", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "SM123" });
    const twilioFactory = vi.fn(() => ({ messages: { create } }));
    const delivery = createDeliveryServices({
      env,
      sgMail: { setApiKey: vi.fn(), send: vi.fn() },
      twilioFactory,
      log: vi.fn(),
    });

    const result = await delivery.sendSms("5551112222", "Hello", "corr-2");

    expect(result.status).toBe("SENT");
    expect(twilioFactory).toHaveBeenCalledWith(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      to: "+15551112222",
      from: "+15550000000",
    }));
  });

  it("returns friendly SMS failures without exposing provider internals", async () => {
    const twilioFactory = vi.fn(() => ({
      messages: { create: vi.fn().mockRejectedValue(new Error("provider blew up with twilio-secret-value")) },
    }));
    const delivery = createDeliveryServices({
      env,
      sgMail: { setApiKey: vi.fn(), send: vi.fn() },
      twilioFactory,
      log: vi.fn(),
    });

    await expect(delivery.sendSms("+15551112222", "Hello", "corr-3"))
      .rejects
      .toMatchObject({ code: "ERR_PROVIDER_DOWN", message: "SMS delivery failed." });
  });

  it("fails safely when email configuration is unavailable", async () => {
    const delivery = createDeliveryServices({
      env: { ...env, SENDGRID_API_KEY: "" },
      sgMail: { setApiKey: vi.fn(), send: vi.fn() },
      twilioFactory: vi.fn(),
      log: vi.fn(),
    });

    await expect(delivery.sendEmail("admin@example.com", "Subject", "Body", "corr-4"))
      .rejects
      .toBeInstanceOf(DeliveryError);
  });
});
