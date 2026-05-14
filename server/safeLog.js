export function maskSensitive(value) {
  if (typeof value === "string") {
    return value
      .replace(/([a-zA-Z0-9._-]{2})[a-zA-Z0-9._-]*(@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/g, "$1***$2")
      .replace(/(\+?\d{1,3})?\d{3}\d{3}(\d{2})\d{2}/g, "$1******$2")
      .replace(/([smakp]k-[a-zA-Z0-9]{3})[a-zA-Z0-9]+/g, "$1********")
      .replace(/(AIza[a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]+/g, "$1********");
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskSensitive(value.message),
      code: value.code,
    };
  }

  if (Array.isArray(value)) {
    return value.map(maskSensitive);
  }

  if (value && typeof value === "object") {
    const masked = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/token|secret|password|key|authorization|cookie/i.test(key)) {
        masked[key] = "********";
      } else {
        masked[key] = maskSensitive(entry);
      }
    }
    return masked;
  }

  return value;
}

export function safeLog(severity, event, data = {}) {
  console.log(JSON.stringify({
    severity,
    event,
    component: "app-hosting-api",
    timestamp: new Date().toISOString(),
    ...maskSensitive(data),
  }));
}
