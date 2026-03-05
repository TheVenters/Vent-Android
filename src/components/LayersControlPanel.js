import React, { useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  Switch,
  ActivityIndicator,
} from "react-native";
import { SIZES } from "../constants/theme";
import { useAppTheme } from "../context/ThemeContext";
import {
  formatLayerDisplayName,
  getPinLayerKeyFromLayer,
  isNamedUserPostsLayer,
} from "../utils/layers";

const OWNER_LABELS = {
  system: "System",
  community: "Community",
  user: "User",
};

const getBadgeStyles = (ownerType, palette) => {
  if (ownerType === "community") {
    return {
      backgroundColor: "rgba(250, 204, 21, 0.18)",
      color: "#a16207",
    };
  }

  if (ownerType === "user") {
    return {
      backgroundColor: "rgba(16, 185, 129, 0.18)",
      color: "#047857",
    };
  }

  return {
    backgroundColor: "rgba(99, 102, 241, 0.18)",
    color: palette.primary,
  };
};

const LayersControlPanel = ({
  visible,
  onClose,
  layers,
  sectionMode = "all",
  selectedLayerId,
  isLoading,
  onSelectLayer,
  onOpenLayerPosts,
  onToggleLayer,
  onMoveLayer,
  onRefresh,
  onRemoveLayer,
}) => {
  const { palette, isDark } = useAppTheme();
  const styles = createStyles(palette, isDark);
  const manageableLayers = Array.isArray(layers)
    ? layers.filter((layer) => layer?.viewerCanManage !== false)
    : [];
  const isFriendSpecificLayer = (layer) => {
    const pinKey = getPinLayerKeyFromLayer(layer);
    if (pinKey !== "friends") return false;
    if (!isNamedUserPostsLayer(layer)) return false;
    return !layer?.isOwnUserPostsLayer;
  };
  const myCollectionLayers = manageableLayers.filter(
    (layer) => !isFriendSpecificLayer(layer),
  );
  const friendLayers = manageableLayers.filter((layer) =>
    isFriendSpecificLayer(layer),
  );
  const isFriendsSystemLayer = (layer) => {
    const pinKey = getPinLayerKeyFromLayer(layer);
    return pinKey === "friends" && !isNamedUserPostsLayer(layer);
  };
  const [showFriendLayersList, setShowFriendLayersList] = useState(false);
  const showFriendsOnly = sectionMode === "friends";
  const panelTitle = showFriendsOnly ? "Friends Layers" : "Layers";

  useEffect(() => {
    if (!visible) {
      setShowFriendLayersList(false);
      return;
    }
    const selectedIsFriendSpecific = friendLayers.some(
      (layer) => layer.id === selectedLayerId,
    );
    if (selectedIsFriendSpecific) {
      setShowFriendLayersList(true);
    }
  }, [friendLayers, selectedLayerId, visible]);

  const renderLayerRows = (layerRows) =>
    layerRows.map((layer) => {
      const badge = getBadgeStyles(layer.owner_type, palette);
      const isSelected = selectedLayerId === layer.id;
      const isFriendsRootLayer = isFriendsSystemLayer(layer);
      const pinLayerKey = getPinLayerKeyFromLayer(layer);
      const globalIndex = manageableLayers.findIndex(
        (candidate) => candidate.id === layer.id,
      );
      const isFirst = globalIndex <= 0;
      const isLast = globalIndex >= manageableLayers.length - 1;

      return (
        <TouchableOpacity
          key={layer.id}
          style={[
            styles.layerRow,
            isSelected && styles.layerRowSelected,
            !layer.isEnabled && styles.layerRowMuted,
          ]}
          onPress={() => {
            if (!layer.isEnabled) {
              onToggleLayer(layer.id, true, {
                selectAfterToggle: true,
              });
              return;
            }
            onSelectLayer(layer.id);
            if (isFriendsRootLayer && !showFriendsOnly) {
              setShowFriendLayersList((previous) => !previous);
              return;
            }
            if (onOpenLayerPosts) {
              onOpenLayerPosts(layer);
            }
          }}
          activeOpacity={0.9}
        >
          <View style={styles.rowLeft}>
            <Text style={styles.layerName}>
              {formatLayerDisplayName(layer)}
            </Text>
            <View style={styles.rowMeta}>
              <View
                style={[
                  styles.ownerBadge,
                  { backgroundColor: badge.backgroundColor },
                ]}
              >
                <Text
                  style={[
                    styles.ownerBadgeText,
                    { color: badge.color },
                  ]}
                >
                  {OWNER_LABELS[layer.owner_type] || "System"}
                </Text>
              </View>

              {layer.ownerCommunityName ? (
                <Text style={styles.communityText}>
                  {layer.ownerCommunityName}
                </Text>
              ) : null}
              <Text style={styles.pinKeyText}>
                Posts as {pinLayerKey}
              </Text>
            </View>
          </View>

          <View style={styles.rowRight}>
            {layer.owner_type === "community" &&
            !layer.isForcedEnabled ? (
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={(event) => {
                  event?.stopPropagation?.();
                  onRemoveLayer && onRemoveLayer(layer);
                }}
              >
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.reorderButtons}>
              <TouchableOpacity
                style={[
                  styles.reorderBtn,
                  isFirst && styles.reorderBtnDisabled,
                ]}
                disabled={isFirst}
                onPress={(event) => {
                  event?.stopPropagation?.();
                  onMoveLayer && onMoveLayer(layer.id, -1);
                }}
              >
                <Text style={styles.reorderBtnText}>↑</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.reorderBtn,
                  isLast && styles.reorderBtnDisabled,
                ]}
                disabled={isLast}
                onPress={(event) => {
                  event?.stopPropagation?.();
                  onMoveLayer && onMoveLayer(layer.id, 1);
                }}
              >
                <Text style={styles.reorderBtnText}>↓</Text>
              </TouchableOpacity>
            </View>
            {layer.isForcedEnabled ? (
              <Text style={styles.selectedPill}>Pinned</Text>
            ) : null}
            {isSelected && layer.isEnabled && !layer.isForcedEnabled ? (
              <Text style={styles.selectedPill}>Selected</Text>
            ) : null}

            <Switch
              value={layer.isEnabled}
              disabled={Boolean(layer.isForcedEnabled)}
              trackColor={{
                false: palette.border,
                true: palette.primary,
              }}
              thumbColor={palette.onPrimary}
              onValueChange={(nextValue) =>
                onToggleLayer(layer.id, nextValue)
              }
            />
          </View>
        </TouchableOpacity>
      );
    });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <Text style={styles.title}>{panelTitle}</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.actionBtn} onPress={onRefresh}>
                <Text style={styles.actionBtnText}>Refresh</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={onClose}>
                <Text style={styles.actionBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>

          {isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={palette.primary} />
              <Text style={styles.loadingText}>Loading layers...</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
            >
              {showFriendsOnly ? (
                <>
                  <Text style={styles.sectionTitle}>Friends Tab Layers</Text>
                  {friendLayers.length === 0 ? (
                    <Text style={styles.emptyText}>
                      No friend-specific layers are available right now.
                    </Text>
                  ) : (
                    renderLayerRows(friendLayers)
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.sectionTitle}>My Layer Collection</Text>
                  {myCollectionLayers.length === 0 ? (
                    <Text style={styles.emptyText}>
                      No layers available to manage right now. Join a community to
                      manage its layers.
                    </Text>
                  ) : (
                    renderLayerRows(myCollectionLayers)
                  )}
                  {friendLayers.length > 0 && showFriendLayersList ? (
                    <>
                      <Text style={styles.sectionTitle}>Friends Tab Layers</Text>
                      {renderLayerRows(friendLayers)}
                    </>
                  ) : null}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (palette, isDark) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.35)",
    },
    sheet: {
      backgroundColor: palette.surface,
      borderTopLeftRadius: SIZES.radiusXl,
      borderTopRightRadius: SIZES.radiusXl,
      maxHeight: "84%",
      paddingBottom: 18,
      borderTopWidth: 1,
      borderColor: palette.border,
    },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 999,
      backgroundColor: palette.border,
      marginTop: 10,
      marginBottom: 8,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      gap: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: "800",
      color: palette.text,
    },
    headerActions: {
      flexDirection: "row",
      gap: 8,
    },
    actionBtn: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: SIZES.radius,
      backgroundColor: palette.mutedSurface,
    },
    actionBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.text,
    },
    loadingWrap: {
      paddingVertical: 24,
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    loadingText: {
      color: palette.subtext,
      fontSize: 13,
      fontWeight: "600",
    },
    body: {
      paddingHorizontal: 16,
    },
    bodyContent: {
      paddingBottom: 16,
    },
    sectionTitle: {
      marginTop: 16,
      marginBottom: 8,
      fontSize: 15,
      fontWeight: "800",
      color: palette.text,
    },
    emptyText: {
      fontSize: 13,
      color: palette.subtext,
      marginBottom: 8,
      lineHeight: 18,
    },
    layerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: isDark ? "#202632" : "#f9fbff",
      borderRadius: SIZES.radiusLg,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 8,
      gap: 10,
    },
    layerRowSelected: {
      borderColor: palette.primary,
    },
    layerRowMuted: {
      opacity: 0.6,
    },
    rowLeft: {
      flex: 1,
    },
    rowRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    reorderButtons: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    reorderBtn: {
      width: 26,
      height: 26,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.mutedSurface,
      alignItems: "center",
      justifyContent: "center",
    },
    reorderBtnDisabled: {
      opacity: 0.35,
    },
    reorderBtnText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
      lineHeight: 14,
    },
    removeBtn: {
      borderRadius: SIZES.radius,
      paddingVertical: 5,
      paddingHorizontal: 10,
      backgroundColor: "rgba(239, 68, 68, 0.15)",
      borderWidth: 1,
      borderColor: "rgba(239, 68, 68, 0.35)",
    },
    removeBtnText: {
      fontSize: 11,
      fontWeight: "800",
      color: "#ef4444",
    },
    layerName: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.text,
      marginBottom: 6,
    },
    rowMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    ownerBadge: {
      alignSelf: "flex-start",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    ownerBadgeText: {
      fontSize: 11,
      fontWeight: "700",
    },
    communityText: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.subtext,
    },
    pinKeyText: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.primary,
      textTransform: "capitalize",
    },
    selectedPill: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.primary,
      backgroundColor: "rgba(99, 102, 241, 0.12)",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      overflow: "hidden",
    },
  });

export default LayersControlPanel;
