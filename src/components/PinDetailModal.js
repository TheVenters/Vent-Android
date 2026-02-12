import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { COLORS, SIZES } from '../constants/theme';

const PinDetailModal = ({
  visible,
  pin,
  currentUserId,
  pinVoteSummary,
  isSubmittingVote,
  onVote,
  onClose,
  onUpdate,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState('');
  const [caption, setCaption] = useState('');
  const [mediaAspectRatio, setMediaAspectRatio] = useState(4 / 3);

  const isOwner = pin?.user_id === currentUserId;
  const isMediaPin = pin?.type === 'media' || pin?.type === 'photo' || pin?.type === 'video';

  useEffect(() => {
    if (pin) {
      setContent(pin.content || '');
      setCaption(pin.caption || '');
      setIsEditing(false);
    }
  }, [pin]);

  useEffect(() => {
    if (!pin?.media_url || pin?.media_type === 'video') {
      setMediaAspectRatio(4 / 3);
      return;
    }

    Image.getSize(
      pin.media_url,
      (width, height) => {
        if (width > 0 && height > 0) {
          setMediaAspectRatio(width / height);
        } else {
          setMediaAspectRatio(4 / 3);
        }
      },
      () => setMediaAspectRatio(4 / 3)
    );
  }, [pin?.media_url, pin?.media_type]);

  const handleSave = () => {
    if (isMediaPin) {
      onUpdate(pin.id, { caption });
    } else {
      if (!content.trim()) {
        Alert.alert('Error', 'Content cannot be empty');
        return;
      }
      onUpdate(pin.id, { content });
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Pin',
      'Are you sure you want to delete this pin?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(pin.id),
        },
      ]
    );
  };

  const handleClose = () => {
    setIsEditing(false);
    onClose();
  };

  if (!pin) return null;

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                {pin.author_name || 'Anonymous'}
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
            {isMediaPin && pin.media_url && (
              <View style={styles.mediaContainer}>
                {pin.media_type === 'video' ? (
                  <View style={styles.videoPlaceholder}>
                    <Text style={styles.videoIcon}>🎬</Text>
                    <Text style={styles.videoText}>Video</Text>
                  </View>
                ) : (
                  <Image
                    source={{ uri: pin.media_url }}
                    style={[styles.mediaImage, { aspectRatio: mediaAspectRatio }]}
                    resizeMode="contain"
                  />
                )}
              </View>
            )}

            {/* Content/Caption */}
            {isEditing ? (
              <View style={styles.editContainer}>
                <Text style={styles.label}>
                  {isMediaPin ? 'Caption' : 'Content'}
                </Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={isMediaPin ? caption : content}
                  onChangeText={isMediaPin ? setCaption : setContent}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  placeholder={isMediaPin ? 'Edit caption...' : 'Edit content...'}
                />
              </View>
            ) : (
              <View style={styles.contentContainer}>
                <Text style={styles.postTitleText}>
                  {pin.caption || 'Untitled'}
                </Text>
                <Text style={styles.contentText}>
                  {pin.content || 'No caption'}
                </Text>
              </View>
            )}

            {/* Metadata */}
            <View style={styles.metadata}>
              <Text style={styles.metaText}>
                {formatDate(pin.created_at)}
              </Text>
              <Text style={styles.metaText}>
                📍 {pin.layer.charAt(0).toUpperCase() + pin.layer.slice(1)}
              </Text>
            </View>
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
                  pinVoteSummary?.userVote === 1 && styles.voteButtonActive,
                ]}
                disabled={!currentUserId || isSubmittingVote || isOwner}
                onPress={() => onVote && onVote(1)}
              >
                <Text
                  style={[
                    styles.voteButtonText,
                    pinVoteSummary?.userVote === 1 && styles.voteButtonTextActive,
                  ]}
                >
                  👍 {pinVoteSummary?.upvotes || 0}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.voteButton,
                  pinVoteSummary?.userVote === -1 && styles.voteButtonActive,
                ]}
                disabled={!currentUserId || isSubmittingVote || isOwner}
                onPress={() => onVote && onVote(-1)}
              >
                <Text
                  style={[
                    styles.voteButtonText,
                    pinVoteSummary?.userVote === -1 && styles.voteButtonTextActive,
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
              <Text style={styles.voteHint}>You cannot vote on your own pin</Text>
            )}
          </ScrollView>

          {/* Actions */}
          {isOwner && (
            <View style={styles.actions}>
              {isEditing ? (
                <>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      setContent(pin.content || '');
                      setCaption(pin.caption || '');
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
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => setIsEditing(true)}
                  >
                    <Text style={styles.editText}>Edit</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modal: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: SIZES.radiusXl,
    borderTopRightRadius: SIZES.radiusXl,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: SIZES.xl,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  authorName: {
    fontSize: SIZES.lg,
    fontWeight: '700',
    color: COLORS.dark,
  },
  username: {
    fontSize: SIZES.sm,
    color: COLORS.primary,
    marginTop: SIZES.xs,
  },
  closeButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 24,
    color: COLORS.gray,
  },
  content: {
    padding: SIZES.xl,
  },
  mediaContainer: {
    marginBottom: SIZES.lg,
    borderRadius: SIZES.radiusLg,
    overflow: 'hidden',
  },
  mediaImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    minHeight: 180,
    maxHeight: 420,
    borderRadius: SIZES.radiusLg,
    backgroundColor: COLORS.light,
  },
  videoPlaceholder: {
    width: '100%',
    height: 200,
    backgroundColor: COLORS.dark,
    borderRadius: SIZES.radiusLg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoIcon: {
    fontSize: 48,
    marginBottom: SIZES.sm,
  },
  videoText: {
    color: COLORS.white,
    fontSize: SIZES.md,
  },
  contentContainer: {
    marginBottom: SIZES.lg,
  },
  postTitleText: {
    fontSize: SIZES.lg,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: SIZES.sm,
  },
  contentText: {
    fontSize: SIZES.md,
    color: COLORS.dark,
    lineHeight: 24,
  },
  editContainer: {
    marginBottom: SIZES.lg,
  },
  label: {
    fontSize: SIZES.sm,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: SIZES.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    padding: SIZES.lg,
    fontSize: SIZES.md,
  },
  textArea: {
    minHeight: 100,
  },
  metadata: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: SIZES.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  metaText: {
    fontSize: SIZES.sm,
    color: COLORS.gray,
  },
  locationFlareMeta: {
    marginTop: SIZES.sm,
    fontSize: SIZES.xs,
    fontWeight: '700',
    color: '#FF7A59',
  },
  voteRow: {
    flexDirection: 'row',
    marginTop: SIZES.md,
  },
  voteButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: COLORS.white,
  },
  voteButtonLeft: {
    marginRight: SIZES.sm,
  },
  voteButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  voteButtonText: {
    fontSize: SIZES.sm,
    fontWeight: '600',
    color: COLORS.dark,
  },
  voteButtonTextActive: {
    color: COLORS.white,
  },
  voteHint: {
    marginTop: SIZES.sm,
    fontSize: SIZES.xs,
    color: COLORS.gray,
  },
  actions: {
    flexDirection: 'row',
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
    alignItems: 'center',
  },
  deleteText: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.danger,
  },
  editButton: {
    flex: 1,
    paddingVertical: SIZES.lg,
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radiusLg,
    alignItems: 'center',
  },
  editText: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: SIZES.lg,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radiusLg,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.dark,
  },
  saveButton: {
    flex: 1,
    paddingVertical: SIZES.lg,
    backgroundColor: COLORS.success,
    borderRadius: SIZES.radiusLg,
    alignItems: 'center',
  },
  saveText: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
});

export default PinDetailModal;
