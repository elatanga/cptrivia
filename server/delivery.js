import sgMailDefault from "@sendgrid/mail";
import twilioDefault from "twilio";
import { safeLog } from "./safeLog.js";

export class DeliveryError extends Error {
  constructor(message, code = "ERR_PROVIDER_DOWN") {
    super(message);
    this.name = "DeliveryError";
    this.code = code;
  }
}

export function validateAndNormalizePhone(phone) {
  let cleaned = String(phone || "").replace(/[\s\-().]/g, "");

  if (/^[2-9]\d{9}$/.test(cleaned)) {
    cleaned = `+1${cleaned}`;
  } else if (/^1[2-9]\d{9}$/.test(cleaned)) {
    cleaned = `+${cleaned}`;
  } else if (!cleaned.startsWith("+")) {
    cleaned = `+${cleaned}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    throw new DeliveryError("Please enter a valid phone number.", "ERR_VALIDATION");
  }

  return cleaned;
}

export function validateEmail(email) {
  const value = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new DeliveryError("Please enter a valid email address.", "ERR_VALIDATION");
  }
  return value;
}

export function createDeliveryServices({
  env = process.env,
  sgMail = sgMailDefault,
  twilioFactory = twilioDefault,
  log = safeLog,
} = {}) {
  let sendGridConfigured = false;
  let twilioClient;

  const ensureSendGrid = () => {
    if (!env.SENDGRID_API_KEY) {
      log("ERROR", "emailConfigMissing");
      throw new DeliveryError("Email service is unavailable.");
    }
    if (!sendGridConfigured) {
      sgMail.setApiKey(env.SENDGRID_API_KEY);
      sendGridConfigured = true;
    }
  };

  const ensureTwilio = () => {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
      log("ERROR", "smsConfigMissing");
      throw new DeliveryError("SMS service is unavailable.");
    }
    if (!twilioClient) {
      twilioClient = twilioFactory(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    }
    return twilioClient;
  };

  const sendEmail = async (to, subject, text, correlationId) => {
    const recipients = Array.isArray(to) ? to.map(validateEmail) : validateEmail(to);
    ensureSendGrid();

    try {
      const [response] = await sgMail.send({
        to: recipients,
        from: env.SENDGRID_FROM_EMAIL || "noreply@cruzpham.com",
        subject: String(subject || "").slice(0, 200),
        text: String(text || ""),
      });
      log("INFO", "emailSendSuccess", { correlationId, statusCode: response?.statusCode });
      return {
        id: response?.headers?.["x-message-id"],
        provider: "sendgrid",
        status: "SENT",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      log("ERROR", "emailSendFailed", { correlationId, error });
      throw new DeliveryError("Email delivery failed.");
    }
  };

  const sendSms = async (to, body, correlationId) => {
    const normalizedTo = validateAndNormalizePhone(to);
    const client = ensureTwilio();

    try {
      const message = await client.messages.create({
        to: normalizedTo,
        from: env.TWILIO_FROM_NUMBER,
        body: String(body || "").slice(0, 1500),
      });
      log("INFO", "smsSendSuccess", { correlationId, providerId: message?.sid });
      return {
        id: message?.sid,
        provider: "twilio",
        status: "SENT",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      log("ERROR", "smsSendFailed", { correlationId, error });
      throw new DeliveryError("SMS delivery failed.");
    }
  };

  return { sendEmail, sendSms };
}
