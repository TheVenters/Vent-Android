const ICON_DELIMITER = "::";

export const parseLayerKindMetadata = (kindValue) => {
  const rawKind = typeof kindValue === "string" ? kindValue : "";
  if (!rawKind) {
    return { baseKind: "", layerIcon: null };
  }

  const delimiterIndex = rawKind.indexOf(ICON_DELIMITER);
  if (delimiterIndex < 0) {
    return { baseKind: rawKind, layerIcon: null };
  }

  const baseKind = rawKind.slice(0, delimiterIndex).trim();
  const layerIcon = rawKind
    .slice(delimiterIndex + ICON_DELIMITER.length)
    .trim();
  return { baseKind: baseKind || rawKind, layerIcon: layerIcon || null };
};

export const encodeLayerKindWithIcon = (baseKindValue, layerIconValue) => {
  const baseKind = String(baseKindValue || "").trim();
  const layerIcon = String(layerIconValue || "").trim();
  if (!baseKind) return "";
  if (!layerIcon) return baseKind;
  return `${baseKind}${ICON_DELIMITER}${layerIcon}`;
};
