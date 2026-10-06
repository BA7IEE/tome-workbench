/** One source for the transitional DOM theme and the AntD provider. */
export const designTokens = {
  canvas: "#F6F3ED",
  surface: "#FFFDFA",
  text: "#292622",
  textSecondary: "#625A51",
  primary: "#765844",
  border: "#CFC7BD",
  selected: "#EDE3D7",
  successText: "#24543B",
  successBg: "#ECF4EE",
  warningText: "#704917",
  warningBg: "#FBF0D9",
  errorText: "#922F2B",
  errorBg: "#FCEDEA",
  infoText: "#31546A",
  infoBg: "#EDF3F6",
} as const;

/** Shared seed used by every Foundation React root. */
export const antDesignTokenSeed = {
  colorPrimary: designTokens.primary,
  colorBgLayout: designTokens.canvas,
  colorBgContainer: designTokens.surface,
  colorText: designTokens.text,
  colorTextSecondary: designTokens.textSecondary,
  colorBorder: designTokens.border,
  colorSuccess: designTokens.successText,
  colorWarning: designTokens.warningText,
  colorError: designTokens.errorText,
  colorInfo: designTokens.infoText,
  borderRadius: 6,
  fontSize: 14,
} as const;

export function applyDesignTokens() {
  for (const [name, value] of Object.entries(designTokens)) {
    document.documentElement.style.setProperty(`--tome-${name}`, value);
    // Older native controls consume RGB triplets; derive them from the same seed.
    const rgb = value
      .slice(1)
      .match(/.{2}/g)!
      .map((part) => parseInt(part, 16))
      .join(", ");
    document.documentElement.style.setProperty(`--tome-${name}-rgb`, rgb);
  }
}
