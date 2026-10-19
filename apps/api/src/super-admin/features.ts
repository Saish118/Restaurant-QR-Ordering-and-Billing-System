export const FEATURES = [
  {
    key: "waiter_portal",
    name: "Waiter portal",
    available: false,
    note: "Access enforced for waiter accounts. The dedicated staff portal is not built yet.",
  },
  {
    key: "kitchen_portal",
    name: "Kitchen portal",
    available: false,
    note: "Access enforced for chef accounts. The dedicated kitchen screen is not built yet.",
  },
  {
    key: "online_payments",
    name: "Online payments",
    available: false,
    note: "Reserved access flag. No payment gateway is connected.",
  },
  {
    key: "gst_billing",
    name: "GST billing",
    available: false,
    note: "Reserved access flag. Invoice automation is not built.",
  },
  {
    key: "whatsapp_sms",
    name: "WhatsApp / SMS",
    available: false,
    note: "Reserved access flag. No messages are sent.",
  },
  {
    key: "advanced_reports",
    name: "Advanced reports",
    available: false,
    note: "Reserved access flag. Advanced restaurant reports are not built.",
  },
] as const;
export function featureKeysValid(flags: Record<string, boolean>) {
  return Object.keys(flags).every(
    (key) =>
      FEATURES.some((f) => f.key === key) ||
      /^premium_[a-z0-9_]{1,48}$/.test(key),
  );
}
