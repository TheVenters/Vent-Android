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
const MY_POSTS_AUDIENCE_ORDER = ["private", "public", "friends"];
const MY_POSTS_AUDIENCE_LABELS = {
  private: "Private",
  public: "Public",
  friends: "Friends",
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
  const globalLayerIndexById = new Map(
    manageableLayers.map((layer, index) => [String(layer?.id || ""), index]),
  );
  const sortByGlobalLayerOrder = (rows) =>
    [...rows].sort((left, right) => {
      const leftIdx = globalLayerIndexById.get(String(left?.id || ""));
      const rightIdx = globalLayerIndexById.get(String(right?.id || ""));
      if (Number.isFinite(leftIdx) && Number.isFinite(rightIdx)) {
        return leftIdx - rightIdx;
      }
      if (Number.isFinite(leftIdx)) return -1;
      if (Number.isFinite(rightIdx)) return 1;
      return String(left?.name || "").localeCompare(String(right?.name || ""));
    });
  const isFriendSpecificLayer = (layer) => {
    const pinKey = getPinLayerKeyFromLayer(layer);
    if (pinKey !== "friends") return false;
    if (!isNamedUserPostsLayer(layer)) return false;
    return !layer?.isOwnUserPostsLayer;
  };
  const isCorePostsLayer = (layer) => {
    if (!layer) return false;
    if (isNamedUserPostsLayer(layer)) return true;
    const pinKey = getPinLayerKeyFromLayer(layer);
    const ownerType = String(layer?.owner_type || "system").toLowerCase();
    if (!["system", "user"].includes(ownerType)) return false;
    return ["private", "friends", "public"].includes(pinKey);
  };
  const myCollectionLayers = sortByGlobalLayerOrder(
    manageableLayers.filter((layer) => !isFriendSpecificLayer(layer)),
  );
  const primaryCollectionLayers = myCollectionLayers.filter(
    (layer) => layer?.owner_type !== "community",
  );
  const getAudienceRank = (layer, audienceKey) => {
    const ownerType = String(layer?.owner_type || "system").toLowerCase();
    const pinKey = getPinLayerKeyFromLayer(layer);
    if (layer?.isMyPostsAudienceVirtual) return 0;
    if (ownerType === "user") return 1;
    if (ownerType === "system" && pinKey === audienceKey) return 2;
    return 3;
  };
  const myPostsAudienceLayerByKey = MY_POSTS_AUDIENCE_ORDER.reduce(
    (accumulator, audienceKey) => {
      const candidates = primaryCollectionLayers
        .filter(
          (layer) =>
            getPinLayerKeyFromLayer(layer) === audienceKey &&
            !isFriendSpecificLayer(layer) &&
            layer?.kind !== "user_posts",
        )
        .sort(
          (left, right) =>
            getAudienceRank(left, audienceKey) -
            getAudienceRank(right, audienceKey),
        );
      if (candidates.length > 0) {
        accumulator[audienceKey] = candidates[0];
      }
      return accumulator;
    },
    {},
  );
  const myPostsAudienceRows = MY_POSTS_AUDIENCE_ORDER.map((audienceKey) => {
    const layer = myPostsAudienceLayerByKey[audienceKey];
    if (!layer) return null;
    return {
      ...layer,
      panelDisplayName: MY_POSTS_AUDIENCE_LABELS[audienceKey],
      panelAudienceKey: audienceKey,
    };
  }).filter(Boolean);
  const dedupeRowsByLayerId = (rows) => {
    const byId = new Map();
    rows.forEach((row) => {
      const id = String(row?.id || "");
      if (!id || byId.has(id)) return;
      byId.set(id, row);
    });
    return Array.from(byId.values());
  };
  const myPostsLayers = sortByGlobalLayerOrder(dedupeRowsByLayerId(myPostsAudienceRows));
  const myPostsLayerIdSet = new Set(myPostsLayers.map((layer) => String(layer.id)));
  const friendLayers = sortByGlobalLayerOrder(
    manageableLayers.filter((layer) => isFriendSpecificLayer(layer)),
  );
  const publicCandidates = sortByGlobalLayerOrder(
    primaryCollectionLayers.filter(
      (layer) =>
        getPinLayerKeyFromLayer(layer) === "public" &&
        !isFriendSpecificLayer(layer),
    ),
  );
  const publicLayersWithoutMyPosts = publicCandidates.filter(
    (layer) => !myPostsLayerIdSet.has(String(layer?.id || "")),
  );
  const publicLayers =
    publicLayersWithoutMyPosts.length > 0
      ? publicLayersWithoutMyPosts.filter(
          (layer) => String(layer?.owner_type || "").toLowerCase() === "system",
        ).length > 0
        ? publicLayersWithoutMyPosts.filter(
            (layer) => String(layer?.owner_type || "").toLowerCase() === "system",
          )
        : publicLayersWithoutMyPosts
      : publicCandidates.slice(0, 1);
  const publicLayerIdSet = new Set(publicLayers.map((layer) => String(layer.id)));
  const friendLayerIdSet = new Set(friendLayers.map((layer) => String(layer.id)));
  const otherLayers = sortByGlobalLayerOrder(
    manageableLayers.filter((layer) => {
      const id = String(layer?.id || "");
      if (!id) return false;
      if (myPostsLayerIdSet.has(id)) return false;
      if (friendLayerIdSet.has(id)) return false;
      if (publicLayerIdSet.has(id)) return false;
      if (isCorePostsLayer(layer)) return false;
      return true;
    }),
  );
  const [showFriendLayersList, setShowFriendLayersList] = useState(false);
  const [showMyPostsLayersList, setShowMyPostsLayersList] = useState(true);
  const [showOtherLayersList, setShowOtherLayersList] = useState(false);
  const [groupToggleState, setGroupToggleState] = useState({});
  const showFriendsOnly = sectionMode === "friends";
  const panelTitle = showFriendsOnly ? "Friends Layers" : "Layers";
  const publicPrimaryLayer =
    publicLayers.find(
      (layer) => String(layer?.owner_type || "").toLowerCase() === "system",
    ) || publicLayers[0] || null;

  useEffect(() => {
    if (!visible) {
      setShowFriendLayersList(false);
      setShowMyPostsLayersList(true);
      setShowOtherLayersList(false);
      setGroupToggleState((previous) => {
        if (!previous || Object.keys(previous).length === 0) {
          return previous;
        }
        return {};
      });
      return;
    }
    const selectedIsMyPosts = myPostsLayers.some(
      (layer) => layer.id === selectedLayerId,
    );
    const selectedIsFriendSpecific = friendLayers.some(
      (layer) => layer.id === selectedLayerId,
    );
    const selectedIsOther = otherLayers.some(
      (layer) => layer.id === selectedLayerId,
    );
    if (selectedIsMyPosts) {
      setShowMyPostsLayersList(true);
    }
    if (selectedIsFriendSpecific) {
      setShowFriendLayersList(true);
    }
    if (selectedIsOther) {
      setShowOtherLayersList(true);
    }
  }, [
    friendLayers,
    myPostsLayers,
    otherLayers,
    selectedLayerId,
    visible,
  ]);

  useEffect(() => {
    if (!visible) return;
    if (!showFriendsOnly) return;
    if (friendLayers.length > 0) {
      setShowFriendLayersList(true);
    }
  }, [friendLayers.length, showFriendsOnly, visible]);

  const isGroupEnabled = (layerRows) =>
    (Array.isArray(layerRows) ? layerRows : []).some((layer) =>
      Boolean(layer?.isEnabled),
    );
  const canToggleGroup = (layerRows) =>
    (Array.isArray(layerRows) ? layerRows : []).some(
      (layer) => !layer?.isForcedEnabled,
    );
  const setLayerRowsEnabled = async (layerRows, nextEnabled) => {
    const rows = Array.isArray(layerRows) ? layerRows : [];
    for (const layer of rows) {
      if (!layer?.id || layer?.isForcedEnabled) continue;
      if (Boolean(layer?.isEnabled) === Boolean(nextEnabled)) continue;
      try {
        await onToggleLayer(layer.id, nextEnabled, { selectAfterToggle: false });
      } catch (_) {
        // Individual row errors are surfaced by onToggleLayer.
      }
    }
  };
  const getGroupMoveState = (layerRows) => {
    const indices = (Array.isArray(layerRows) ? layerRows : [])
      .map((layer) => globalLayerIndexById.get(String(layer?.id || "")))
      .filter((value) => Number.isFinite(value));
    if (indices.length === 0) {
      return {
        canMoveUp: false,
        canMoveDown: false,
      };
    }
    const minIndex = Math.min(...indices);
    const maxIndex = Math.max(...indices);
    return {
      canMoveUp: minIndex > 0,
      canMoveDown: maxIndex < manageableLayers.length - 1,
    };
  };
  const moveLayerGroup = async (layerRows, direction) => {
    if (!onMoveLayer) return;
    const rows = Array.isArray(layerRows) ? layerRows : [];
    const layerIds = rows
      .map((layer) => String(layer?.id || ""))
      .filter(Boolean);
    if (layerIds.length === 0) return;
    await onMoveLayer(layerIds[0], direction, {
      groupLayerIds: layerIds,
    });
  };

  const renderLayerRows = (layerRows, options = {}) =>
    layerRows.map((layer) => {
      const isCompact = Boolean(options.compact);
      const badge = getBadgeStyles(layer.owner_type, palette);
      const isSelected = selectedLayerId === layer.id;
      const pinLayerKey = getPinLayerKeyFromLayer(layer);
      const globalIndex = globalLayerIndexById.get(String(layer?.id || ""));
      const isFirst = globalIndex <= 0;
      const isLast = globalIndex >= manageableLayers.length - 1;

      return (
        <View
          key={layer.id}
          style={[
            styles.layerRow,
            isCompact && styles.layerRowCompact,
            isSelected && styles.layerRowSelected,
            !layer.isEnabled && styles.layerRowMuted,
          ]}
        >
          <TouchableOpacity
            style={styles.rowMainPress}
            activeOpacity={0.9}
            onPress={() => {
              if (!layer.isEnabled) {
                onToggleLayer(layer.id, true, {
                  selectAfterToggle: true,
                });
                return;
              }
              onSelectLayer(layer.id);
              if (onOpenLayerPosts) {
                onOpenLayerPosts(layer);
              }
            }}
          >
            <View style={styles.rowLeft}>
              <Text style={[styles.layerName, isCompact && styles.layerNameCompact]}>
                {layer.panelDisplayName || formatLayerDisplayName(layer)}
              </Text>
              <View style={[styles.rowMeta, isCompact && styles.rowMetaCompact]}>
                <View
                  style={[
                    styles.ownerBadge,
                    isCompact && styles.ownerBadgeCompact,
                    { backgroundColor: badge.backgroundColor },
                  ]}
                >
                  <Text
                    style={[
                      styles.ownerBadgeText,
                      isCompact && styles.ownerBadgeTextCompact,
                      { color: badge.color },
                    ]}
                  >
                    {OWNER_LABELS[layer.owner_type] || "System"}
                  </Text>
                </View>

                {layer.ownerCommunityName ? (
                  <Text
                    style={[
                      styles.communityText,
                      isCompact && styles.communityTextCompact,
                    ]}
                  >
                    {layer.ownerCommunityName}
                  </Text>
                ) : null}
                <Text style={[styles.pinKeyText, isCompact && styles.pinKeyTextCompact]}>
                  Posts as {pinLayerKey}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <View style={[styles.rowRight, isCompact && styles.rowRightCompact]}>
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
            <View
              style={[
                styles.reorderButtons,
                isCompact && styles.reorderButtonsCompact,
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.reorderBtn,
                  isCompact && styles.reorderBtnCompact,
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
                  isCompact && styles.reorderBtnCompact,
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
              <Text style={[styles.selectedPill, isCompact && styles.selectedPillCompact]}>
                Pinned
              </Text>
            ) : null}
            {isSelected && layer.isEnabled && !layer.isForcedEnabled ? (
              <Text style={[styles.selectedPill, isCompact && styles.selectedPillCompact]}>
                Selected
              </Text>
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
        </View>
      );
    });

  const renderParentToggleRow = ({
    groupKey,
    title,
    layerRows,
    expanded,
    onToggleExpanded,
    onToggleParent,
    allowExpand = true,
    metaLabel = "",
    onOpenParent = null,
  }) => {
    const rows = Array.isArray(layerRows) ? layerRows : [];
    const parentOnDerived = isGroupEnabled(rows);
    const parentOn = Object.prototype.hasOwnProperty.call(
      groupToggleState,
      groupKey,
    )
      ? Boolean(groupToggleState[groupKey])
      : parentOnDerived;
    const parentCanToggle = canToggleGroup(rows);
    const selectedWithinGroup = rows.some((layer) => layer?.id === selectedLayerId);
    const { canMoveUp, canMoveDown } = getGroupMoveState(rows);

    return (
      <View style={styles.subMenuSection}>
        <View
          style={[
            styles.parentRow,
            !parentOn && styles.parentRowMuted,
            selectedWithinGroup && styles.parentRowSelected,
          ]}
        >
          <TouchableOpacity
            style={styles.parentRowMain}
            activeOpacity={0.9}
            onPress={() => {
              if (allowExpand) {
                onToggleExpanded && onToggleExpanded((previous) => !previous);
                return;
              }
              if (onOpenParent) onOpenParent();
            }}
          >
            <Text style={styles.subMenuToggleTitle}>{title}</Text>
            <Text style={styles.subMenuToggleMeta}>{metaLabel}</Text>
          </TouchableOpacity>
          {allowExpand ? (
            <Text style={styles.subMenuToggleChevron}>
              {expanded && parentOn ? "▾" : "▸"}
            </Text>
          ) : null}
          <View style={styles.reorderButtons}>
            <TouchableOpacity
              style={[
                styles.reorderBtn,
                !canMoveUp && styles.reorderBtnDisabled,
              ]}
              disabled={!canMoveUp}
              onPress={(event) => {
                event?.stopPropagation?.();
                void moveLayerGroup(rows, -1);
              }}
            >
              <Text style={styles.reorderBtnText}>↑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.reorderBtn,
                !canMoveDown && styles.reorderBtnDisabled,
              ]}
              disabled={!canMoveDown}
              onPress={(event) => {
                event?.stopPropagation?.();
                void moveLayerGroup(rows, 1);
              }}
            >
              <Text style={styles.reorderBtnText}>↓</Text>
            </TouchableOpacity>
          </View>
          <Switch
            value={parentOn}
            disabled={!parentCanToggle}
            trackColor={{
              false: palette.border,
              true: palette.primary,
            }}
            thumbColor={palette.onPrimary}
            onValueChange={(nextValue) => {
              setGroupToggleState((previous) => ({
                ...previous,
                [groupKey]: Boolean(nextValue),
              }));
              onToggleParent(nextValue);
            }}
          />
        </View>
        {allowExpand && parentOn && expanded ? (
          <View style={styles.subMenuContent}>
            {renderLayerRows(rows, { compact: true })}
          </View>
        ) : null}
      </View>
    );
  };

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
                    renderParentToggleRow({
                      groupKey: "friend",
                      title: "Friend",
                      layerRows: friendLayers,
                      expanded: showFriendLayersList,
                      onToggleExpanded: setShowFriendLayersList,
                      onToggleParent: (nextValue) => {
                        if (!nextValue) setShowFriendLayersList(false);
                        if (nextValue) setShowFriendLayersList(true);
                        void setLayerRowsEnabled(friendLayers, nextValue);
                      },
                      allowExpand: true,
                      metaLabel: `${friendLayers.length} ${
                        friendLayers.length === 1 ? "sublayer" : "sublayers"
                      }`,
                    })
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
                  ) : null}
                  {myPostsLayers.length > 0 ? (
                    renderParentToggleRow({
                      groupKey: "my-posts",
                      title: "MyPosts",
                      layerRows: myPostsLayers,
                      expanded: showMyPostsLayersList,
                      onToggleExpanded: setShowMyPostsLayersList,
                      onToggleParent: (nextValue) => {
                        if (!nextValue) setShowMyPostsLayersList(false);
                        if (nextValue) setShowMyPostsLayersList(true);
                        void setLayerRowsEnabled(myPostsLayers, nextValue);
                      },
                      allowExpand: true,
                      metaLabel: `${myPostsLayers.length} ${
                        myPostsLayers.length === 1 ? "sublayer" : "sublayers"
                      }`,
                    })
                  ) : null}
                  {friendLayers.length > 0 ? (
                    renderParentToggleRow({
                      groupKey: "friend",
                      title: "Friend",
                      layerRows: friendLayers,
                      expanded: showFriendLayersList,
                      onToggleExpanded: setShowFriendLayersList,
                      onToggleParent: (nextValue) => {
                        if (!nextValue) setShowFriendLayersList(false);
                        if (nextValue) setShowFriendLayersList(true);
                        void setLayerRowsEnabled(friendLayers, nextValue);
                      },
                      allowExpand: true,
                      metaLabel: `${friendLayers.length} ${
                        friendLayers.length === 1 ? "sublayer" : "sublayers"
                      }`,
                    })
                  ) : null}
                  {publicLayers.length > 0 ? (
                    renderParentToggleRow({
                      groupKey: "public",
                      title: "Public",
                      layerRows: publicLayers,
                      allowExpand: false,
                      metaLabel: "All public posts",
                      onOpenParent: () => {
                        if (!publicPrimaryLayer?.id) return;
                        if (!publicPrimaryLayer.isEnabled) {
                          onToggleLayer(publicPrimaryLayer.id, true, {
                            selectAfterToggle: true,
                          });
                          return;
                        }
                        onSelectLayer(publicPrimaryLayer.id);
                        if (onOpenLayerPosts) {
                          onOpenLayerPosts(publicPrimaryLayer);
                        }
                      },
                      onToggleParent: (nextValue) => {
                        void setLayerRowsEnabled(publicLayers, nextValue);
                      },
                    })
                  ) : null}
                  {otherLayers.length > 0 ? (
                    renderParentToggleRow({
                      groupKey: "other-layers",
                      title: "Other Layers",
                      layerRows: otherLayers,
                      expanded: showOtherLayersList,
                      onToggleExpanded: setShowOtherLayersList,
                      onToggleParent: (nextValue) => {
                        if (!nextValue) setShowOtherLayersList(false);
                        if (nextValue) setShowOtherLayersList(true);
                        void setLayerRowsEnabled(otherLayers, nextValue);
                      },
                      allowExpand: true,
                      metaLabel: `${otherLayers.length} ${
                        otherLayers.length === 1 ? "layer" : "layers"
                      }`,
                    })
                  ) : null}
                  {myCollectionLayers.length > 0 &&
                  myPostsLayers.length === 0 &&
                  friendLayers.length === 0 &&
                  publicLayers.length === 0 &&
                  otherLayers.length === 0 ? (
                    <>
                      <Text style={styles.sectionTitle}>All Layers</Text>
                      <View style={styles.subMenuContent}>
                        {renderLayerRows(myCollectionLayers, { compact: true })}
                      </View>
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
    subSectionTitle: {
      marginTop: 4,
      marginBottom: 8,
      fontSize: 13,
      fontWeight: "800",
      color: palette.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.2,
    },
    myPostsAudienceTabs: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 8,
    },
    myPostsAudienceTab: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      backgroundColor: isDark ? "#1b2130" : "#f2f6ff",
      alignItems: "center",
      paddingVertical: 7,
      paddingHorizontal: 10,
    },
    myPostsAudienceTabActive: {
      borderColor: palette.primary,
      backgroundColor: isDark ? "rgba(99,102,241,0.24)" : "rgba(99,102,241,0.12)",
    },
    myPostsAudienceTabText: {
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
    },
    myPostsAudienceTabTextActive: {
      color: palette.primary,
    },
    emptyText: {
      fontSize: 13,
      color: palette.subtext,
      marginBottom: 8,
      lineHeight: 18,
    },
    subMenuSection: {
      marginTop: 6,
      marginBottom: 10,
    },
    parentRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      backgroundColor: isDark ? "#1b2130" : "#f2f6ff",
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 8,
    },
    parentRowMain: {
      flex: 1,
      justifyContent: "center",
      gap: 2,
    },
    parentRowMuted: {
      opacity: 0.72,
    },
    parentRowSelected: {
      borderColor: palette.primary,
    },
    subMenuToggleRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radius,
      backgroundColor: isDark ? "#1b2130" : "#f2f6ff",
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 8,
    },
    subMenuToggleTitle: {
      flex: 1,
      color: palette.text,
      fontSize: 12,
      fontWeight: "800",
    },
    subMenuToggleMeta: {
      color: palette.subtext,
      fontSize: 11,
      fontWeight: "700",
    },
    subMenuToggleChevron: {
      color: palette.subtext,
      fontSize: 12,
      fontWeight: "800",
      lineHeight: 14,
    },
    subMenuContent: {
      marginTop: 8,
      marginLeft: 12,
      borderLeftWidth: 1,
      borderLeftColor: palette.border,
      paddingLeft: 10,
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
    layerRowCompact: {
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: SIZES.radius,
      marginBottom: 6,
      gap: 8,
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
    rowMainPress: {
      flex: 1,
      minWidth: 0,
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
    rowMetaCompact: {
      gap: 6,
    },
    ownerBadge: {
      alignSelf: "flex-start",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    ownerBadgeCompact: {
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    ownerBadgeText: {
      fontSize: 11,
      fontWeight: "700",
    },
    ownerBadgeTextCompact: {
      fontSize: 10,
    },
    communityText: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.subtext,
    },
    communityTextCompact: {
      fontSize: 10,
    },
    pinKeyText: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.primary,
      textTransform: "capitalize",
    },
    pinKeyTextCompact: {
      fontSize: 10,
    },
    layerNameCompact: {
      fontSize: 13,
      marginBottom: 4,
    },
    rowRightCompact: {
      gap: 6,
    },
    reorderButtonsCompact: {
      gap: 4,
    },
    reorderBtnCompact: {
      width: 24,
      height: 24,
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
    selectedPillCompact: {
      fontSize: 10,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
  });

export default LayersControlPanel;
