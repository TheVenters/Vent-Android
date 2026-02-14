#!/usr/bin/env bash
set -euo pipefail

SIM_NAME="iPhone 16 Pro Max"

# Find a matching available simulator UDID (prefer the first available one).
UDID="$(xcrun simctl list devices available | grep -F "$SIM_NAME (" | head -n 1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/')"

if [[ -z "${UDID}" ]]; then
  echo "No available simulator named '${SIM_NAME}' was found."
  echo "Create it in Xcode > Settings > Components/Platforms, then try again."
  exit 1
fi

# Boot/select the target simulator before launching Expo.
open -a Simulator --args -CurrentDeviceUDID "$UDID"
xcrun simctl boot "$UDID" >/dev/null 2>&1 || true

exec npx expo start --ios
