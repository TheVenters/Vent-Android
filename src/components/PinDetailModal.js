import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
  Dimensions,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { COLORS, SIZES } from "../constants/theme";

const VISIBILITY_OPTIONS = ["public", "friends", "private"];
const COMMENT_INDENT_WIDTH = 12;
const COMMENT_MAX_VISUAL_DEPTH = 3;
const COMMENT_AUTO_COLLAPSE_DEPTH = 2;
const COMMENT_PREVIEW_CHILD_COUNT = 3;

const normalizeVisibility = (value) => {
  const layer = String(value || "").toLowerCase();
  return VISIBILITY_OPTIONS.includes(layer) ? layer : "public";
};

const visibilityLabel = (value) =>
  String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);

const isRenderableMediaUrl = (value) => {
  const uri = String(value || "").trim();
  if (!uri) return false;
  return !uri.toLowerCase().startsWith("storage://");
};

const inferMediaTypeFromUrl = (value) => {
  const uri = String(value || "").trim().toLowerCase();
  if (!uri) return "photo";
  if (uri.startsWith("data:video/")) return "video";
  if (/\.(mp4|mov|m4v)(\?|#|$)/i.test(uri)) return "video";
  return "photo";
};

const PinDetailModal = ({
  visible,
  pin,
  currentUserId,
  isAdmin,
  pinVoteSummary,
  isSubmittingVote,
  pinComments,
  isLoadingComments,
  isSubmittingComment,
  deletingCommentId,
  associatedLayers,
  onVote,
  onAddComment,
  onDeleteComment,
  onClose,
  onUpdate,
  onDelete,
  onMediaLoadError,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState("");
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [mediaAspectRatio, setMediaAspectRatio] = useState(4 / 3);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [isPhotoViewerVisible, setIsPhotoViewerVisible] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [replyToCommentId, setReplyToCommentId] = useState(null);
  const [expandedReplyThreads, setExpandedReplyThreads] = useState({});
  const modalMediaScrollRef = useRef(null);
  const photoViewerScrollRef = useRef(null);
  const viewerWidth = Dimensions.get("window").width;
  const viewerHeight = Dimensions.get("window").height;
  const modalMediaWidth = Math.max(1, viewerWidth - SIZES.xl * 2);

  const isOwner = pin?.user_id === currentUserId;
  const mediaUrls = useMemo(() => {
    const topLevelList = Array.isArray(pin?.media_urls) ? pin.media_urls : [];
    const geometryList = Array.isArray(pin?.geometry?.media_urls)
      ? pin.geometry.media_urls
      : [];
    const primary = String(pin?.media_url || "").trim();

    // Match the marker/callout precedence so the modal uses the same
    // freshest hydrated URL instead of preferring stale geometry values.
    const normalizedList = [...topLevelList, ...geometryList]
      .map((value) => String(value || "").trim())
      .filter(isRenderableMediaUrl);

    if (isRenderableMediaUrl(primary)) {
      normalizedList.unshift(primary);
    }

    if (normalizedList.length > 0) {
      return Array.from(new Set(normalizedList));
    }
    return isRenderableMediaUrl(primary) ? [primary] : [];
  }, [pin?.geometry?.media_urls, pin?.media_url, pin?.media_urls]);
  const mediaTypes = useMemo(() => {
    const topLevelTypes = Array.isArray(pin?.media_types) ? pin.media_types : [];
    const geometryTypes = Array.isArray(pin?.geometry?.media_types)
      ? pin.geometry.media_types
      : [];
    const normalized = [...topLevelTypes, ...geometryTypes]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    if (normalized.length > 0) return normalized;
    const primaryType = String(pin?.media_type || "").trim().toLowerCase();
    return primaryType ? [primaryType] : [];
  }, [pin?.geometry?.media_types, pin?.media_type, pin?.media_types]);
  const isMediaPin =
    pin?.type === "media" ||
    pin?.type === "photo" ||
    pin?.type === "video" ||
    mediaUrls.length > 0;

  useEffect(() => {
    if (pin) {
      setContent(pin.content || "");
      setCaption(pin.caption || "");
      setVisibility(normalizeVisibility(pin.layer));
      setCommentDraft("");
      setReplyToCommentId(null);
      setExpandedReplyThreads({});
      setIsEditing(false);
      setActiveMediaIndex(0);
      setIsPhotoViewerVisible(false);
    }
  }, [pin]);

  const activeMediaUrl =
    mediaUrls[Math.max(0, Math.min(activeMediaIndex, mediaUrls.length - 1))] || null;
  const mediaTypeForIndex = (index) => {
    const safeIndex = Math.max(0, Math.min(mediaUrls.length - 1, Number(index) || 0));
    const fromList = String(mediaTypes[safeIndex] || "")
      .trim()
      .toLowerCase();
    if (fromList) return fromList;
    if (safeIndex === 0) {
      const primaryType = String(pin?.media_type || "")
        .trim()
        .toLowerCase();
      if (primaryType) return primaryType;
    }
    return inferMediaTypeFromUrl(mediaUrls[safeIndex]);
  };
  const activeMediaType = mediaTypeForIndex(activeMediaIndex);
  const modalVideoSource =
    !isPhotoViewerVisible && activeMediaType === "video"
      ? String(activeMediaUrl || "").trim() || null
      : null;
  const viewerVideoSource =
    isPhotoViewerVisible && activeMediaType === "video"
      ? String(activeMediaUrl || "").trim() || null
      : null;
  const modalVideoPlayer = useVideoPlayer(modalVideoSource, (player) => {
    player.loop = true;
  });
  const viewerVideoPlayer = useVideoPlayer(viewerVideoSource, (player) => {
    player.loop = true;
  });
  const hasBodyContent = String(pin?.content || "").trim().length > 0;

  useEffect(() => {
    try {
      if (modalVideoSource) {
        modalVideoPlayer.play();
      } else {
        modalVideoPlayer.pause();
      }
    } catch (_error) {}
  }, [modalVideoPlayer, modalVideoSource]);

  useEffect(() => {
    try {
      if (viewerVideoSource) {
        viewerVideoPlayer.play();
      } else {
        viewerVideoPlayer.pause();
      }
    } catch (_error) {}
  }, [viewerVideoPlayer, viewerVideoSource]);

  useEffect(() => {
    if (!activeMediaUrl || activeMediaType === "video") {
      setMediaAspectRatio(4 / 3);
      return;
    }

    Image.prefetch(activeMediaUrl).catch(() => {});

    Image.getSize(
      activeMediaUrl,
      (width, height) => {
        if (width > 0 && height > 0) {
          setMediaAspectRatio(width / height);
        } else {
          setMediaAspectRatio(4 / 3);
        }
      },
      () => setMediaAspectRatio(4 / 3),
    );
  }, [activeMediaType, activeMediaUrl]);

  useEffect(() => {
    if (mediaUrls.length <= 1) return;
    const targetX = Math.max(0, activeMediaIndex) * modalMediaWidth;
    requestAnimationFrame(() => {
      modalMediaScrollRef.current?.scrollTo?.({
        x: targetX,
        y: 0,
        animated: true,
      });
    });
  }, [activeMediaIndex, mediaUrls.length, modalMediaWidth]);

  useEffect(() => {
    if (!isPhotoViewerVisible) return;
    const targetX = Math.max(0, activeMediaIndex) * viewerWidth;
    requestAnimationFrame(() => {
      photoViewerScrollRef.current?.scrollTo?.({
        x: targetX,
        y: 0,
        animated: false,
      });
    });
  }, [activeMediaIndex, isPhotoViewerVisible, viewerWidth]);

  const handleSave = () => {
    if (!caption.trim()) {
      Alert.alert("Error", "Title cannot be empty");
      return;
    }
    const updates = {
      caption: caption.trim(),
      layer: normalizeVisibility(visibility),
    };
    if (!isMediaPin) {
      updates.content = content.trim();
    }
    onUpdate(pin.id, updates);
    setIsEditing(false);
  };

  const handleDelete = () => {
    Alert.alert("Delete Pin", "Are you sure you want to delete this pin?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDelete(pin.id),
      },
    ]);
  };

  const handleClose = () => {
    setIsEditing(false);
    onClose();
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const comments = Array.isArray(pinComments) ? pinComments : [];
  const canComment = Boolean(currentUserId);
  const { commentById, rootComments, childrenByParentId } = useMemo(() => {
    const byId = new Map();
    comments.forEach((comment) => {
      const commentId = String(comment?.id || "");
      if (!commentId) return;
      byId.set(commentId, comment);
    });

    const roots = [];
    const byParentId = new Map();
    comments.forEach((comment) => {
      const commentId = String(comment?.id || "");
      if (!commentId) return;
      const parentId = String(comment?.parent_comment_id || "");
      if (parentId && parentId !== commentId && byId.has(parentId)) {
        const siblings = byParentId.get(parentId) || [];
        siblings.push(comment);
        byParentId.set(parentId, siblings);
        return;
      }
      roots.push(comment);
    });

    if (roots.length === 0 && byId.size > 0) {
      byId.forEach((comment) => {
        roots.push(comment);
      });
    }

    return {
      commentById: byId,
      rootComments: roots,
      childrenByParentId: byParentId,
    };
  }, [comments]);
  const commentRows = useMemo(() => {
    const rows = [];
    const visited = new Set();
    const stack = [];

    for (let index = rootComments.length - 1; index >= 0; index -= 1) {
      stack.push({
        kind: "comment",
        comment: rootComments[index],
        depth: 0,
      });
    }

    while (stack.length > 0) {
      const next = stack.pop();
      if (next.kind === "toggle") {
        rows.push(next);
        continue;
      }

      const comment = next.comment;
      const commentId = String(comment?.id || "");
      if (!commentId || visited.has(commentId)) continue;
      visited.add(commentId);

      const depth = Number(next.depth || 0);
      rows.push({ kind: "comment", comment, depth });

      const children = childrenByParentId.get(commentId) || [];
      if (children.length === 0) continue;

      const expanded = Boolean(expandedReplyThreads[commentId]);
      const collapseByDepth = depth >= COMMENT_AUTO_COLLAPSE_DEPTH;
      const collapseByCount = children.length > COMMENT_PREVIEW_CHILD_COUNT;
      const needsThreadToggle = collapseByDepth || collapseByCount;
      const collapseOnHideCount = collapseByDepth
        ? children.length
        : Math.max(0, children.length - COMMENT_PREVIEW_CHILD_COUNT);

      let visibleChildren = children;
      let hiddenCount = 0;

      if (!expanded && collapseByDepth) {
        visibleChildren = [];
        hiddenCount = children.length;
      } else if (!expanded && collapseByCount) {
        visibleChildren = children.slice(0, COMMENT_PREVIEW_CHILD_COUNT);
        hiddenCount = children.length - visibleChildren.length;
      }

      if (needsThreadToggle) {
        stack.push({
          kind: "toggle",
          parentId: commentId,
          depth: depth + 1,
          expanded,
          hiddenCount,
          totalCount: children.length,
          collapseByDepth,
          collapseByCount,
          collapseOnHideCount,
        });
      }

      for (let index = visibleChildren.length - 1; index >= 0; index -= 1) {
        stack.push({
          kind: "comment",
          comment: visibleChildren[index],
          depth: depth + 1,
        });
      }
    }

    return rows;
  }, [rootComments, childrenByParentId, expandedReplyThreads]);
  const hideRepliesParentId = useMemo(() => {
    let candidate = null;

    commentRows.forEach((row, index) => {
      if (row.kind !== "toggle" || !row.expanded) return;
      const collapseOnHideCount = Number(row.collapseOnHideCount || 0);
      if (collapseOnHideCount <= 0) return;

      const rowDepth = Number(row.depth || 0);
      if (
        !candidate ||
        collapseOnHideCount < candidate.collapseOnHideCount ||
        (collapseOnHideCount === candidate.collapseOnHideCount &&
          rowDepth > candidate.rowDepth) ||
        (collapseOnHideCount === candidate.collapseOnHideCount &&
          rowDepth === candidate.rowDepth &&
          index > candidate.index)
      ) {
        candidate = {
          parentId: row.parentId,
          collapseOnHideCount,
          rowDepth,
          index,
        };
      }
    });

    return candidate?.parentId || null;
  }, [commentRows]);
  const replyingToComment = replyToCommentId
    ? commentById.get(replyToCommentId) || null
    : null;

  useEffect(() => {
    if (!replyToCommentId) return;
    if (!commentById.has(replyToCommentId)) {
      setReplyToCommentId(null);
    }
  }, [commentById, replyToCommentId]);

  if (!pin) return null;

  const handleSubmitComment = async () => {
    if (!onAddComment) return;
    const trimmed = commentDraft.trim();
    if (!trimmed) return;
    const success = await onAddComment(trimmed, {
      parentCommentId: replyToCommentId || null,
    });
    if (success) {
      setCommentDraft("");
      setReplyToCommentId(null);
    }
  };

  const handleDeleteComment = (commentId) => {
    if (!onDeleteComment) return;
    Alert.alert("Delete Comment", "Are you sure you want to delete this comment?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          onDeleteComment(commentId);
        },
      },
    ]);
  };
  const handleToggleThread = (commentId) => {
    const normalizedCommentId = String(commentId || "");
    if (!normalizedCommentId) return;
    setExpandedReplyThreads((previous) => {
      const next = { ...(previous || {}) };
      if (next[normalizedCommentId]) {
        delete next[normalizedCommentId];
      } else {
        next[normalizedCommentId] = true;
      }
      return next;
    });
  };

  const renderThreadRail = (depth = 0) => {
    if (depth <= 0) return null;
    return (
      <View style={styles.commentThreadRail} pointerEvents="none">
        <View style={styles.commentThreadRailLine} />
        <View style={styles.commentThreadRailDot} />
      </View>
    );
  };

  const renderCommentRow = (comment, depth = 0) => {
    const indentDepth = Math.min(depth, COMMENT_MAX_VISUAL_DEPTH);
    const overflowDepth = Math.max(0, depth - COMMENT_MAX_VISUAL_DEPTH);
    const parentCommentId = String(comment?.parent_comment_id || "");
    const parentComment = parentCommentId
      ? commentById.get(parentCommentId) || null
      : null;
    const handle = String(comment?.author_username || "");
    const displayName = String(comment?.author_name || "Anonymous");
    const parentHandle = parentComment?.author_username
      ? `@${parentComment.author_username}`
      : parentComment?.author_name || "comment";
    const parentPreview = String(parentComment?.content || "")
      .replace(/\s+/g, " ")
      .trim();
    const canDeleteThisComment =
      Boolean(currentUserId) &&
      (String(comment?.user_id || "") === String(currentUserId) ||
        String(pin?.user_id || "") === String(currentUserId));
    const deletingThisComment = deletingCommentId === comment.id;
    const isReplyingToThisComment = replyToCommentId === comment.id;
    const canReply = Boolean(currentUserId);

    return (
      <View
        key={comment.id}
        style={[
          styles.commentRow,
          { paddingLeft: indentDepth * COMMENT_INDENT_WIDTH },
        ]}
      >
        {renderThreadRail(depth)}
        <View style={[styles.commentItem, depth > 0 && styles.commentChildItem]}>
          {parentComment && (
            <View style={styles.replyContextRow}>
              <View style={styles.replyContextAccent} />
              <Text style={styles.replyContextText} numberOfLines={1}>
                Reply to {parentHandle}
                {parentPreview ? `: ${parentPreview}` : ""}
              </Text>
            </View>
          )}
          <View style={styles.commentMetaRow}>
            <Text style={styles.commentAuthor}>{handle ? `@${handle}` : displayName}</Text>
            <View style={styles.commentMetaActions}>
              {overflowDepth > 0 && (
                <Text style={styles.commentDepthBadge}>+{overflowDepth}</Text>
              )}
              <Text style={styles.commentDate}>{formatDate(comment.created_at)}</Text>
              {canReply && (
                <TouchableOpacity
                  style={styles.commentReplyButton}
                  disabled={isSubmittingComment}
                  onPress={() => setReplyToCommentId(comment.id)}
                >
                  <Text style={styles.commentReplyText}>
                    {isReplyingToThisComment ? "Replying" : "Reply"}
                  </Text>
                </TouchableOpacity>
              )}
              {canDeleteThisComment && (
                <TouchableOpacity
                  style={[
                    styles.commentDeleteButton,
                    Boolean(deletingCommentId) && styles.commentDeleteButtonDisabled,
                  ]}
                  disabled={Boolean(deletingCommentId)}
                  onPress={() => handleDeleteComment(comment.id)}
                >
                  <Text style={styles.commentDeleteText}>
                    {deletingThisComment ? "Deleting..." : "Delete"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <Text style={styles.commentBody}>{comment.content}</Text>
        </View>
      </View>
    );
  };
  const renderThreadToggle = (row) => {
    if (row.expanded && row.parentId !== hideRepliesParentId) {
      return null;
    }

    const indentDepth = Math.min(row.depth || 0, COMMENT_MAX_VISUAL_DEPTH);
    const overflowDepth = Math.max(
      0,
      Number(row.depth || 0) - COMMENT_MAX_VISUAL_DEPTH,
    );
    const hiddenCount = Number(row.hiddenCount || 0);
    const totalCount = Number(row.totalCount || 0);
    const collapseOnHideCount = Number(row.collapseOnHideCount || 0);
    const repliesWord = hiddenCount === 1 ? "reply" : "replies";
    const hideWord = collapseOnHideCount === 1 ? "reply" : "replies";
    const label = row.expanded
      ? `Hide ${collapseOnHideCount} ${hideWord}`
      : row.collapseByDepth
        ? `Continue thread (${totalCount} replies)`
        : `View ${hiddenCount} more ${repliesWord}`;

    return (
      <View
        key={`toggle-${row.parentId}`}
        style={[
          styles.commentRow,
          { paddingLeft: indentDepth * COMMENT_INDENT_WIDTH },
        ]}
      >
        {renderThreadRail(row.depth)}
        <TouchableOpacity
          style={styles.commentThreadToggleButton}
          disabled={isSubmittingComment}
          onPress={() => handleToggleThread(row.parentId)}
        >
          {overflowDepth > 0 && (
            <Text style={styles.commentDepthBadge}>+{overflowDepth}</Text>
          )}
          <Text style={styles.commentThreadToggleText}>{label}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={styles.modal}>
          <View style={styles.header}>
            <View>
              <Text style={styles.authorName}>
                {pin.author_name || "Anonymous"}
              </Text>
              {pin.author_username && (
                <Text style={styles.username}>@{pin.author_username}</Text>
              )}
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content}>
            {/* Media Preview */}
            {isMediaPin && mediaUrls.length > 0 && (
              <View style={styles.mediaContainer}>
                {activeMediaType === "video" ? (
                  <>
                    <TouchableOpacity
                      activeOpacity={0.95}
                      onPress={() => setIsPhotoViewerVisible(true)}
                    >
                      <VideoView
                        player={modalVideoPlayer}
                        style={styles.mediaVideo}
                        nativeControls
                        contentFit="contain"
                      />
                    </TouchableOpacity>
                    <Text style={styles.mediaZoomHint}>Tap video to open full screen</Text>
                    {mediaUrls.length > 1 ? (
                      <View style={styles.mediaPagerRow}>
                        <TouchableOpacity
                          style={styles.mediaPagerBtn}
                          onPress={() =>
                            setActiveMediaIndex((prev) =>
                              prev <= 0 ? mediaUrls.length - 1 : prev - 1,
                            )
                          }
                        >
                          <Text style={styles.mediaPagerBtnText}>Prev</Text>
                        </TouchableOpacity>
                        <Text style={styles.mediaPagerLabel}>
                          {activeMediaIndex + 1} / {mediaUrls.length}
                        </Text>
                        <TouchableOpacity
                          style={styles.mediaPagerBtn}
                          onPress={() =>
                            setActiveMediaIndex((prev) =>
                              prev >= mediaUrls.length - 1 ? 0 : prev + 1,
                            )
                          }
                        >
                          <Text style={styles.mediaPagerBtnText}>Next</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    <ScrollView
                      ref={modalMediaScrollRef}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      onMomentumScrollEnd={(event) => {
                        const offsetX = Number(event?.nativeEvent?.contentOffset?.x || 0);
                        const nextIndex = Math.round(
                          offsetX / Math.max(1, modalMediaWidth),
                        );
                        if (Number.isFinite(nextIndex)) {
                          setActiveMediaIndex(
                            Math.max(0, Math.min(mediaUrls.length - 1, nextIndex)),
                          );
                        }
                      }}
                    >
                      {mediaUrls.map((mediaUrl, index) => (
                        <TouchableOpacity
                          key={`modal-media-${index}`}
                          activeOpacity={0.95}
                          onPress={() => {
                            setActiveMediaIndex(index);
                            setIsPhotoViewerVisible(true);
                          }}
                          style={[styles.mediaPage, { width: modalMediaWidth }]}
                        >
                          <Image
                            source={{ uri: mediaUrl }}
                            style={[
                              styles.mediaImage,
                              { aspectRatio: mediaAspectRatio },
                            ]}
                            resizeMode="contain"
                            onError={() => onMediaLoadError?.(pin, mediaUrl)}
                          />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={styles.mediaZoomHint}>Tap image to zoom</Text>
                    {mediaUrls.length > 1 ? (
                      <View style={styles.mediaPagerRow}>
                        <TouchableOpacity
                          style={styles.mediaPagerBtn}
                          onPress={() =>
                            setActiveMediaIndex((prev) =>
                              prev <= 0 ? mediaUrls.length - 1 : prev - 1,
                            )
                          }
                        >
                          <Text style={styles.mediaPagerBtnText}>Prev</Text>
                        </TouchableOpacity>
                        <Text style={styles.mediaPagerLabel}>
                          {activeMediaIndex + 1} / {mediaUrls.length}
                        </Text>
                        <TouchableOpacity
                          style={styles.mediaPagerBtn}
                          onPress={() =>
                            setActiveMediaIndex((prev) =>
                              prev >= mediaUrls.length - 1 ? 0 : prev + 1,
                            )
                          }
                        >
                          <Text style={styles.mediaPagerBtnText}>Next</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            )}

            {/* Content/Caption */}
            {isEditing ? (
              <View style={styles.editContainer}>
                <Text style={styles.label}>Title</Text>
                <TextInput
                  style={styles.input}
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="Edit title..."
                />
                <Text style={[styles.label, { marginTop: SIZES.md }]}>
                  Visibility
                </Text>
                <View style={styles.visibilitySelector}>
                  {VISIBILITY_OPTIONS.map((option) => {
                    const selected = visibility === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        style={[
                          styles.visibilityButton,
                          selected && styles.visibilityButtonSelected,
                        ]}
                        onPress={() => setVisibility(option)}
                      >
                        <Text
                          style={[
                            styles.visibilityButtonText,
                            selected && styles.visibilityButtonTextSelected,
                          ]}
                        >
                          {visibilityLabel(option)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {!isMediaPin && (
                  <>
                    <Text style={[styles.label, { marginTop: SIZES.md }]}>
                      Content
                    </Text>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      value={content}
                      onChangeText={setContent}
                      multiline
                      numberOfLines={4}
                      textAlignVertical="top"
                      placeholder="Edit content..."
                    />
                  </>
                )}
              </View>
            ) : (
              <View style={styles.contentContainer}>
                <Text style={styles.postTitleText}>
                  {pin.caption || "Untitled"}
                </Text>
                {hasBodyContent ? (
                  <Text style={styles.contentText}>{pin.content}</Text>
                ) : null}
              </View>
            )}

            {/* Metadata */}
            <View style={styles.metadata}>
              <Text style={styles.metaText}>{formatDate(pin.created_at)}</Text>
              <Text style={styles.metaText}>
                📍 {pin.layer.charAt(0).toUpperCase() + pin.layer.slice(1)}
              </Text>
            </View>
            {Array.isArray(associatedLayers) && associatedLayers.length > 0 && (
              <Text style={styles.layerMetaText}>
                Layers: {associatedLayers.join(", ")}
              </Text>
            )}
            {pin.posted_from_current_location && (
              <Text style={styles.locationFlareMeta}>
                ✦ Posted from this location
              </Text>
            )}

            <View style={styles.voteRow}>
              <TouchableOpacity
                style={[
                  styles.voteButton,
                  styles.voteButtonLeft,
                  pinVoteSummary?.userVote === 1 && styles.voteButtonUpActive,
                ]}
                disabled={isSubmittingVote || isOwner}
                onPress={() => onVote && onVote(1)}
              >
                <Text
                  style={[
                    styles.voteButtonText,
                    pinVoteSummary?.userVote === 1 &&
                      styles.voteButtonTextUpActive,
                  ]}
                >
                  👍 {pinVoteSummary?.upvotes || 0}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.voteButton,
                  pinVoteSummary?.userVote === -1 &&
                    styles.voteButtonDownActive,
                ]}
                disabled={isSubmittingVote || isOwner}
                onPress={() => onVote && onVote(-1)}
              >
                <Text
                  style={[
                    styles.voteButtonText,
                    pinVoteSummary?.userVote === -1 &&
                      styles.voteButtonTextDownActive,
                  ]}
                >
                  👎 {pinVoteSummary?.downvotes || 0}
                </Text>
              </TouchableOpacity>
            </View>

            {!currentUserId && (
              <Text style={styles.voteHint}>Sign in to vote on this pin</Text>
            )}
            {isOwner && (
              <Text style={styles.voteHint}>
                You cannot vote on your own pin
              </Text>
            )}

            <View style={styles.commentsSection}>
              <Text style={styles.commentsTitle}>Comments ({comments.length})</Text>

              {isLoadingComments ? (
                <Text style={styles.commentHint}>Loading comments...</Text>
              ) : comments.length === 0 ? (
                <Text style={styles.commentHint}>No comments yet.</Text>
              ) : (
                commentRows.map((row) =>
                  row.kind === "comment"
                    ? renderCommentRow(row.comment, row.depth)
                    : renderThreadToggle(row),
                )
              )}

              {canComment ? (
                <View style={styles.commentComposer}>
                  {replyingToComment && (
                    <View style={styles.replyingBanner}>
                      <Text style={styles.replyingBannerText}>
                        Replying to{" "}
                        {replyingToComment.author_username
                          ? `@${replyingToComment.author_username}`
                          : replyingToComment.author_name || "Anonymous"}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setReplyToCommentId(null)}
                        disabled={isSubmittingComment}
                      >
                        <Text style={styles.replyingBannerCancel}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={styles.commentComposerRow}>
                    <TextInput
                      style={styles.commentInput}
                      value={commentDraft}
                      onChangeText={setCommentDraft}
                      placeholder={
                        replyingToComment ? "Write a reply..." : "Add a comment..."
                      }
                      editable={!isSubmittingComment}
                      maxLength={500}
                    />
                    <TouchableOpacity
                      style={[
                        styles.commentSubmitButton,
                        (!commentDraft.trim() || isSubmittingComment) &&
                          styles.commentSubmitButtonDisabled,
                      ]}
                      disabled={!commentDraft.trim() || isSubmittingComment}
                      onPress={handleSubmitComment}
                    >
                      <Text style={styles.commentSubmitText}>
                        {isSubmittingComment
                          ? "Posting..."
                          : replyingToComment
                            ? "Reply"
                            : "Comment"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : !currentUserId ? (
                <Text style={styles.commentHint}>Sign in to add comments</Text>
              ) : null}
            </View>
          </ScrollView>

          {/* Actions */}
          {(isOwner || isAdmin) && (
            <View style={styles.actions}>
              {isEditing ? (
                <>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      setContent(pin.content || "");
                      setCaption(pin.caption || "");
                      setVisibility(normalizeVisibility(pin.layer));
                      setIsEditing(false);
                    }}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSave}
                  >
                    <Text style={styles.saveText}>Save</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={handleDelete}
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                  {isOwner && (
                    <TouchableOpacity
                      style={styles.editButton}
                      onPress={() => setIsEditing(true)}
                    >
                      <Text style={styles.editText}>Edit</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )}
        </View>

        <Modal
          visible={isPhotoViewerVisible}
          animationType="fade"
          transparent={false}
          onRequestClose={() => setIsPhotoViewerVisible(false)}
        >
          <View style={styles.photoViewerModal}>
            <View style={styles.photoViewerTopBar}>
              <Text style={styles.photoViewerCount}>
                {activeMediaIndex + 1} / {mediaUrls.length}
              </Text>
              <TouchableOpacity
                style={styles.photoViewerCloseButton}
                onPress={() => setIsPhotoViewerVisible(false)}
              >
                <Text style={styles.photoViewerCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              ref={photoViewerScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => {
                const offsetX = Number(event?.nativeEvent?.contentOffset?.x || 0);
                const nextIndex = Math.round(offsetX / Math.max(1, viewerWidth));
                if (Number.isFinite(nextIndex)) {
                  setActiveMediaIndex(
                    Math.max(0, Math.min(mediaUrls.length - 1, nextIndex)),
                  );
                }
              }}
            >
              {mediaUrls.map((mediaUrl, index) => (
                <View
                  key={`media-viewer-${index}`}
                  style={[styles.photoViewerPage, { width: viewerWidth }]}
                >
                  {mediaTypeForIndex(index) === "video" ? (
                    index === activeMediaIndex ? (
                      <View style={styles.photoViewerVideoContainer}>
                        <VideoView
                          player={viewerVideoPlayer}
                          style={styles.photoViewerVideo}
                          nativeControls
                          contentFit="contain"
                        />
                      </View>
                    ) : (
                      <View style={styles.photoViewerVideoPlaceholder}>
                        <Text style={styles.videoIcon}>🎬</Text>
                        <Text style={styles.videoText}>Video</Text>
                      </View>
                    )
                  ) : (
                    <ScrollView
                      style={styles.photoViewerZoomScroll}
                      contentContainerStyle={[
                        styles.photoViewerZoomContent,
                        { width: viewerWidth, minHeight: viewerHeight * 0.78 },
                      ]}
                      maximumZoomScale={4}
                      minimumZoomScale={1}
                      centerContent
                      showsHorizontalScrollIndicator={false}
                      showsVerticalScrollIndicator={false}
                      pinchGestureEnabled
                    >
                      <Image
                        source={{ uri: mediaUrl }}
                        style={[
                          styles.photoViewerImage,
                          { width: viewerWidth, height: viewerHeight * 0.78 },
                        ]}
                        resizeMode="contain"
                        onError={() => onMediaLoadError?.(pin, mediaUrl)}
                      />
                    </ScrollView>
                  )}
                </View>
              ))}
            </ScrollView>
            <Text style={styles.photoViewerHint}>
              {activeMediaType === "video"
                ? "Tap play to preview video. Swipe sideways to move between media."
                : "Pinch to zoom. Swipe sideways to move between photos."}
            </Text>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modal: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: SIZES.radiusXl,
    borderTopRightRadius: SIZES.radiusXl,
    maxHeight: "88%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: SIZES.xl,
    paddingTop: SIZES.xl,
    paddingBottom: SIZES.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  authorName: {
    fontSize: SIZES.xl,
    fontWeight: "700",
    color: COLORS.dark,
  },
  username: {
    fontSize: SIZES.md,
    color: COLORS.primary,
    marginTop: SIZES.xs,
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 22,
    backgroundColor: COLORS.light,
  },
  closeText: {
    fontSize: 30,
    color: COLORS.gray,
  },
  content: {
    paddingHorizontal: SIZES.xl,
    paddingTop: SIZES.lg,
  },
  mediaContainer: {
    marginBottom: SIZES.lg,
    borderRadius: SIZES.radiusLg,
    overflow: "hidden",
  },
  mediaPage: {
    justifyContent: "center",
  },
  mediaImage: {
    width: "100%",
    aspectRatio: 4 / 3,
    minHeight: 180,
    maxHeight: 420,
    borderRadius: SIZES.radiusLg,
    backgroundColor: COLORS.light,
  },
  videoPlaceholder: {
    width: "100%",
    height: 200,
    backgroundColor: COLORS.dark,
    borderRadius: SIZES.radiusLg,
    justifyContent: "center",
    alignItems: "center",
  },
  videoIcon: {
    fontSize: 48,
    marginBottom: SIZES.sm,
  },
  videoText: {
    color: COLORS.white,
    fontSize: SIZES.lg,
  },
  videoHintText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: SIZES.sm,
    marginTop: SIZES.sm,
    textAlign: "center",
    paddingHorizontal: SIZES.lg,
  },
  mediaVideo: {
    width: "100%",
    minHeight: 220,
    maxHeight: 420,
    borderRadius: SIZES.radiusLg,
    backgroundColor: COLORS.dark,
  },
  mediaZoomHint: {
    marginTop: SIZES.sm,
    color: COLORS.gray,
    fontSize: SIZES.sm,
    fontWeight: "600",
    textAlign: "center",
  },
  mediaPagerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: SIZES.sm,
    gap: SIZES.sm,
  },
  mediaPagerBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusFull,
    paddingHorizontal: SIZES.md,
    paddingVertical: SIZES.xs,
    backgroundColor: COLORS.light,
  },
  mediaPagerBtnText: {
    color: COLORS.dark,
    fontSize: SIZES.sm,
    fontWeight: "700",
  },
  mediaPagerLabel: {
    color: COLORS.gray,
    fontSize: SIZES.sm,
    fontWeight: "700",
  },
  contentContainer: {
    marginBottom: SIZES.lg,
  },
  postTitleText: {
    fontSize: SIZES.xl,
    fontWeight: "700",
    color: COLORS.dark,
    marginBottom: SIZES.sm,
  },
  contentText: {
    fontSize: SIZES.lg,
    color: COLORS.dark,
    lineHeight: 30,
  },
  photoViewerModal: {
    flex: 1,
    backgroundColor: "#05070d",
  },
  photoViewerTopBar: {
    paddingTop: Platform.OS === "ios" ? 56 : 20,
    paddingHorizontal: SIZES.lg,
    paddingBottom: SIZES.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  photoViewerCount: {
    color: COLORS.white,
    fontSize: SIZES.md,
    fontWeight: "700",
  },
  photoViewerCloseButton: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: SIZES.radiusFull,
    paddingHorizontal: SIZES.md,
    paddingVertical: SIZES.xs,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  photoViewerCloseText: {
    color: COLORS.white,
    fontSize: SIZES.sm,
    fontWeight: "700",
  },
  photoViewerPage: {
    flex: 1,
    justifyContent: "center",
  },
  photoViewerVideoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 320,
    paddingHorizontal: SIZES.lg,
  },
  photoViewerVideoContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SIZES.md,
  },
  photoViewerVideo: {
    width: "100%",
    height: "78%",
    backgroundColor: "#05070d",
    borderRadius: SIZES.radiusLg,
  },
  photoViewerZoomScroll: {
    flex: 1,
  },
  photoViewerZoomContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  photoViewerImage: {
    backgroundColor: "#05070d",
  },
  photoViewerHint: {
    color: "rgba(255,255,255,0.72)",
    fontSize: SIZES.sm,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: SIZES.lg,
    paddingBottom: Platform.OS === "ios" ? 28 : 18,
  },
  editContainer: {
    marginBottom: SIZES.lg,
  },
  label: {
    fontSize: SIZES.md,
    fontWeight: "600",
    color: COLORS.dark,
    marginBottom: SIZES.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    padding: SIZES.lg,
    fontSize: SIZES.lg,
  },
  textArea: {
    minHeight: 100,
  },
  visibilitySelector: {
    flexDirection: "row",
    gap: SIZES.sm,
  },
  visibilityButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    paddingVertical: SIZES.sm,
    alignItems: "center",
    backgroundColor: COLORS.white,
  },
  visibilityButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}20`,
  },
  visibilityButtonText: {
    fontSize: SIZES.sm,
    fontWeight: "600",
    color: COLORS.gray,
  },
  visibilityButtonTextSelected: {
    color: COLORS.primary,
  },
  metadata: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: SIZES.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  metaText: {
    fontSize: SIZES.md,
    color: COLORS.gray,
  },
  locationFlareMeta: {
    marginTop: SIZES.sm,
    fontSize: SIZES.sm,
    fontWeight: "700",
    color: "#FF7A59",
  },
  layerMetaText: {
    marginTop: SIZES.sm,
    fontSize: SIZES.sm,
    color: COLORS.gray,
    fontWeight: "600",
  },
  voteRow: {
    flexDirection: "row",
    marginTop: SIZES.lg,
    marginBottom: SIZES.md,
  },
  voteButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: COLORS.white,
  },
  voteButtonLeft: {
    marginRight: SIZES.sm,
  },
  voteButtonUpActive: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  voteButtonDownActive: {
    backgroundColor: COLORS.danger,
    borderColor: COLORS.danger,
  },
  voteButtonText: {
    fontSize: SIZES.lg,
    fontWeight: "600",
    color: COLORS.dark,
  },
  voteButtonTextUpActive: {
    color: COLORS.white,
  },
  voteButtonTextDownActive: {
    color: COLORS.white,
  },
  voteHint: {
    marginTop: SIZES.sm,
    fontSize: SIZES.sm,
    color: COLORS.gray,
  },
  commentsSection: {
    marginTop: SIZES.lg,
    paddingTop: SIZES.md,
    paddingBottom: SIZES.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  commentsTitle: {
    fontSize: SIZES.lg,
    fontWeight: "700",
    color: COLORS.dark,
  },
  commentHint: {
    marginTop: SIZES.sm,
    fontSize: SIZES.sm,
    color: COLORS.gray,
  },
  commentRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "stretch",
  },
  commentThreadRail: {
    width: 10,
    marginTop: SIZES.md,
    marginRight: SIZES.xs,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  commentThreadRailLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: `${COLORS.primary}30`,
  },
  commentThreadRailDot: {
    marginTop: 16,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: `${COLORS.primary}80`,
  },
  commentItem: {
    marginTop: SIZES.md,
    flex: 1,
    padding: SIZES.md,
    borderRadius: SIZES.radiusLg,
    backgroundColor: COLORS.light,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  commentChildItem: {
    backgroundColor: COLORS.white,
    borderColor: `${COLORS.primary}25`,
  },
  replyContextRow: {
    marginBottom: SIZES.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: SIZES.xs,
  },
  replyContextAccent: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: SIZES.radiusSm,
    backgroundColor: `${COLORS.primary}60`,
  },
  replyContextText: {
    flex: 1,
    fontSize: SIZES.xs,
    color: COLORS.gray,
    fontWeight: "600",
  },
  commentMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SIZES.xs,
    gap: SIZES.sm,
  },
  commentMetaActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SIZES.sm,
  },
  commentDepthBadge: {
    fontSize: SIZES.xs,
    fontWeight: "700",
    color: COLORS.gray,
  },
  commentAuthor: {
    flex: 1,
    fontSize: SIZES.sm,
    fontWeight: "700",
    color: COLORS.dark,
  },
  commentDate: {
    fontSize: SIZES.xs,
    color: COLORS.gray,
  },
  commentReplyButton: {
    paddingHorizontal: SIZES.sm,
    paddingVertical: 4,
    borderRadius: SIZES.radiusSm,
    backgroundColor: `${COLORS.primary}20`,
  },
  commentReplyText: {
    fontSize: SIZES.xs,
    fontWeight: "700",
    color: COLORS.primary,
  },
  commentDeleteButton: {
    paddingHorizontal: SIZES.sm,
    paddingVertical: 4,
    borderRadius: SIZES.radiusSm,
    backgroundColor: `${COLORS.danger}20`,
  },
  commentDeleteButtonDisabled: {
    opacity: 0.6,
  },
  commentDeleteText: {
    fontSize: SIZES.xs,
    fontWeight: "700",
    color: COLORS.danger,
  },
  commentThreadToggleButton: {
    flex: 1,
    marginTop: SIZES.xs,
    paddingVertical: SIZES.sm,
    paddingHorizontal: SIZES.md,
    borderRadius: SIZES.radiusLg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    flexDirection: "row",
    alignItems: "center",
    gap: SIZES.sm,
  },
  commentThreadToggleText: {
    fontSize: SIZES.sm,
    fontWeight: "600",
    color: COLORS.primary,
  },
  commentBody: {
    fontSize: SIZES.md,
    color: COLORS.dark,
    lineHeight: 22,
  },
  commentComposer: {
    marginTop: SIZES.md,
    gap: SIZES.sm,
  },
  commentComposerRow: {
    flexDirection: "row",
    gap: SIZES.sm,
    alignItems: "center",
  },
  replyingBanner: {
    paddingHorizontal: SIZES.md,
    paddingVertical: SIZES.sm,
    borderRadius: SIZES.radiusLg,
    backgroundColor: `${COLORS.primary}15`,
    borderWidth: 1,
    borderColor: `${COLORS.primary}35`,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: SIZES.sm,
  },
  replyingBannerText: {
    flex: 1,
    fontSize: SIZES.sm,
    fontWeight: "600",
    color: COLORS.primary,
  },
  replyingBannerCancel: {
    fontSize: SIZES.xs,
    fontWeight: "700",
    color: COLORS.gray,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    paddingHorizontal: SIZES.md,
    paddingVertical: SIZES.sm,
    fontSize: SIZES.md,
    color: COLORS.dark,
    backgroundColor: COLORS.white,
  },
  commentSubmitButton: {
    paddingHorizontal: SIZES.md,
    paddingVertical: SIZES.sm,
    borderRadius: SIZES.radiusLg,
    backgroundColor: COLORS.primary,
  },
  commentSubmitButtonDisabled: {
    opacity: 0.6,
  },
  commentSubmitText: {
    fontSize: SIZES.sm,
    fontWeight: "700",
    color: COLORS.white,
  },
  actions: {
    flexDirection: "row",
    padding: SIZES.xl,
    gap: SIZES.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  deleteButton: {
    flex: 1,
    paddingVertical: SIZES.lg,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radiusLg,
    alignItems: "center",
  },
  deleteText: {
    fontSize: SIZES.md,
    fontWeight: "600",
    color: COLORS.danger,
  },
  editButton: {
    flex: 1,
    paddingVertical: SIZES.lg,
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radiusLg,
    alignItems: "center",
  },
  editText: {
    fontSize: SIZES.md,
    fontWeight: "600",
    color: COLORS.white,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: SIZES.lg,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radiusLg,
    alignItems: "center",
  },
  cancelText: {
    fontSize: SIZES.md,
    fontWeight: "600",
    color: COLORS.dark,
  },
  saveButton: {
    flex: 1,
    paddingVertical: SIZES.lg,
    backgroundColor: COLORS.success,
    borderRadius: SIZES.radiusLg,
    alignItems: "center",
  },
  saveText: {
    fontSize: SIZES.md,
    fontWeight: "600",
    color: COLORS.white,
  },
});

export default PinDetailModal;
