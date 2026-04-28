// File purpose: Legacy/simple modal for creating a quick pin with optional title, description, and image URL.

import React, { useState } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import { COLORS, SIZES, PIN_TYPES } from '../constants/theme';

// Renders the quick post modal and submits simple pin data.
const PinModal = ({ visible, type, onClose, onSubmit }) => {
  const [content, setContent] = useState('');
  const [caption, setCaption] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('photo');
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState(4 / 3);

// Supports the pickImage workflow in this file.
  const pickImage = async (useCamera = false) => {
    try {
      // Request permissions
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Camera permission is required to take photos');
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Gallery permission is required to select photos');
          return;
        }
      }

      const options = {
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 1,
      };

      const result = useCamera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setSelectedImage(asset.uri);
        setMediaUrl(asset.uri);
        setMediaType(asset.type === 'video' ? 'video' : 'photo');
        if (asset.width && asset.height) {
          setPreviewAspectRatio(asset.width / asset.height);
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

// Handles submit interactions or requests.
  const handleSubmit = () => {
    if (type === PIN_TYPES.TEXT && !content.trim()) {
      Alert.alert('Error', 'Please enter some text');
      return;
    }
    if (type === PIN_TYPES.MEDIA && !mediaUrl.trim()) {
      Alert.alert('Error', 'Please select or enter media');
      return;
    }

    onSubmit({
      content,
      caption,
      mediaUrl,
      mediaType: type === PIN_TYPES.MEDIA ? mediaType : null,
    });

    // Reset form
    setContent('');
    setCaption('');
    setMediaUrl('');
    setMediaType('photo');
    setSelectedImage(null);
    setPreviewAspectRatio(4 / 3);
  };

// Handles close interactions or requests.
  const handleClose = () => {
    setContent('');
    setCaption('');
    setMediaUrl('');
    setMediaType('photo');
    setSelectedImage(null);
    setPreviewAspectRatio(4 / 3);
    onClose();
  };

// Gets title for the caller.
  const getTitle = () => {
    switch (type) {
      case PIN_TYPES.TEXT:
        return '📝 Add Text';
      case PIN_TYPES.MEDIA:
        return '📸 Add Media';
      default:
        return 'Add Pin';
    }
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
            <Text style={styles.title}>{getTitle()}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content}>
            {type === PIN_TYPES.MEDIA && (
              <>
                {/* Image Preview */}
                {selectedImage && (
                  <View style={styles.previewContainer}>
                    <Image
                      source={{ uri: selectedImage }}
                      style={[styles.preview, { aspectRatio: previewAspectRatio }]}
                      resizeMode="contain"
                    />
                    <TouchableOpacity
                      style={styles.removePreview}
                      onPress={() => {
                        setSelectedImage(null);
                        setMediaUrl('');
                        setPreviewAspectRatio(4 / 3);
                      }}
                    >
                      <Text style={styles.removePreviewText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Camera/Gallery Buttons */}
                {!selectedImage && (
                  <View style={styles.mediaPickerButtons}>
                    <TouchableOpacity
                      style={styles.pickerButton}
                      onPress={() => pickImage(true)}
                    >
                      <Text style={styles.pickerIcon}>📷</Text>
                      <Text style={styles.pickerText}>Camera</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.pickerButton}
                      onPress={() => pickImage(false)}
                    >
                      <Text style={styles.pickerIcon}>🖼️</Text>
                      <Text style={styles.pickerText}>Gallery</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* URL Input (alternative) */}
                {!selectedImage && (
                  <>
                    <Text style={styles.orText}>or paste a URL</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Paste media URL here..."
                      value={mediaUrl}
                      onChangeText={(url) => {
                        setMediaUrl(url);
                        setSelectedImage(null);
                      }}
                      autoCapitalize="none"
                      keyboardType="url"
                    />
                  </>
                )}
              </>
            )}

            <Text style={styles.label}>
              {type === PIN_TYPES.MEDIA ? 'Caption' : 'Your text'}
            </Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder={
                type === PIN_TYPES.MEDIA
                  ? 'Add a caption...'
                  : 'Enter your text...'
              }
              value={type === PIN_TYPES.MEDIA ? caption : content}
              onChangeText={type === PIN_TYPES.MEDIA ? setCaption : setContent}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={styles.hint}>
              {type === PIN_TYPES.MEDIA
                ? 'Share a moment with media'
                : 'Share your thoughts with the community'}
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={handleClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
              <Text style={styles.submitText}>Post</Text>
            </TouchableOpacity>
          </View>
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
    alignItems: 'center',
    padding: SIZES.xl,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: SIZES.lg,
    fontWeight: '700',
    color: COLORS.dark,
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
  mediaTypeToggle: {
    flexDirection: 'row',
    gap: SIZES.md,
    marginBottom: SIZES.lg,
  },
  mediaTypeButton: {
    flex: 1,
    paddingVertical: SIZES.md,
    paddingHorizontal: SIZES.lg,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radiusLg,
    alignItems: 'center',
  },
  mediaTypeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  mediaTypeText: {
    fontSize: SIZES.md,
    fontWeight: '600',
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
    marginBottom: SIZES.lg,
  },
  textArea: {
    minHeight: 100,
  },
  previewContainer: {
    position: 'relative',
    marginBottom: SIZES.lg,
    borderRadius: SIZES.radiusLg,
    overflow: 'hidden',
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    minHeight: 180,
    maxHeight: 420,
    borderRadius: SIZES.radiusLg,
    backgroundColor: COLORS.light,
  },
  removePreview: {
    position: 'absolute',
    top: SIZES.sm,
    right: SIZES.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePreviewText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  mediaPickerButtons: {
    flexDirection: 'row',
    gap: SIZES.md,
    marginBottom: SIZES.lg,
  },
  pickerButton: {
    flex: 1,
    paddingVertical: SIZES.xl,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radiusLg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  pickerIcon: {
    fontSize: 32,
    marginBottom: SIZES.sm,
  },
  pickerText: {
    fontSize: SIZES.sm,
    fontWeight: '600',
    color: COLORS.gray,
  },
  orText: {
    textAlign: 'center',
    color: COLORS.gray,
    fontSize: SIZES.sm,
    marginBottom: SIZES.md,
  },
  hint: {
    fontSize: SIZES.xs,
    color: COLORS.gray,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    padding: SIZES.xl,
    gap: SIZES.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
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
  submitButton: {
    flex: 1,
    paddingVertical: SIZES.lg,
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radiusLg,
    alignItems: 'center',
  },
  submitText: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.white,
  },
});

export default PinModal;
