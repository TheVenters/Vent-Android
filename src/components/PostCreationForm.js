import React, { useState } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  COLORS,
  SIZES,
  GEOMETRY_TYPES,
  LAYERS,
} from '../constants/theme';

const PostCreationForm = ({
  visible,
  onClose,
  onSubmit,
  selectedLayer,
  onLayerChange,
  userLocation,
  isDrawingMode,
  onStartDrawing,
}) => {
  const LOCATION_MODES = {
    CURRENT: 'current',
    PICK_ON_MAP: 'pick_on_map',
  };

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [geometryType, setGeometryType] = useState(GEOMETRY_TYPES.POINT);
  const [layer, setLayer] = useState(selectedLayer || LAYERS.PUBLIC);
  const [locationMode, setLocationMode] = useState(LOCATION_MODES.CURRENT);
  const [hashtags, setHashtags] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState(4 / 3);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('photo');

  const pickImage = async (useCamera = false) => {
    try {
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Camera permission is required');
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Gallery permission is required');
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

  const handleGeometrySelect = (type) => {
    setGeometryType(type);
    if (type !== GEOMETRY_TYPES.POINT && onStartDrawing) {
      onStartDrawing(type);
    }
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return;
    }

    if (locationMode === LOCATION_MODES.CURRENT && !userLocation) {
      Alert.alert('Location unavailable', 'Unable to read your current location right now.');
      return;
    }

    const tagList = hashtags
      .split(/[,\s#]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    onSubmit({
      title,
      content,
      geometryType,
      layer,
      hashtags: tagList,
      mediaUrl,
      mediaType: mediaUrl ? mediaType : null,
      locationMode,
      location: locationMode === LOCATION_MODES.CURRENT && userLocation
        ? { latitude: userLocation.latitude, longitude: userLocation.longitude }
        : null,
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>New Post</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>X</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
          {/* Title */}
          <TextInput
            style={styles.titleInput}
            placeholder="Title"
            placeholderTextColor={COLORS.gray}
            value={title}
            onChangeText={setTitle}
          />

          {/* Content */}
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What's on your mind?"
            placeholderTextColor={COLORS.gray}
            value={content}
            onChangeText={setContent}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Media */}
          {selectedImage ? (
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
                <Text style={styles.removePreviewText}>X</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.mediaRow}>
              <TouchableOpacity
                style={styles.mediaBtn}
                onPress={() => pickImage(true)}
              >
                <Text style={styles.mediaBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mediaBtn}
                onPress={() => pickImage(false)}
              >
                <Text style={styles.mediaBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Geometry Type */}
          <Text style={styles.sectionLabel}>Geometry</Text>
          <View style={styles.geometryRow}>
            {Object.values(GEOMETRY_TYPES).map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.geometryBtn,
                  geometryType === type && styles.geometryBtnActive,
                ]}
                onPress={() => handleGeometrySelect(type)}
              >
                <Text
                  style={[
                    styles.geometryBtnText,
                    geometryType === type && styles.geometryBtnTextActive,
                  ]}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Layer Selector */}
          <Text style={styles.sectionLabel}>Layer</Text>
          <View style={styles.layerRow}>
            {Object.values(LAYERS).map((l) => (
              <TouchableOpacity
                key={l}
                style={[
                  styles.layerBtn,
                  layer === l && styles.layerBtnActive,
                ]}
                onPress={() => setLayer(l)}
              >
                <Text
                  style={[
                    styles.layerBtnText,
                    layer === l && styles.layerBtnTextActive,
                  ]}
                >
                  {l.charAt(0).toUpperCase() + l.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Location Mode */}
          <Text style={styles.sectionLabel}>Pin Location</Text>
          <View style={styles.locationModeRow}>
            <TouchableOpacity
              style={[
                styles.locationModeBtn,
                locationMode === LOCATION_MODES.CURRENT && styles.locationModeBtnActive,
              ]}
              onPress={() => setLocationMode(LOCATION_MODES.CURRENT)}
            >
              <Text
                style={[
                  styles.locationModeBtnText,
                  locationMode === LOCATION_MODES.CURRENT && styles.locationModeBtnTextActive,
                ]}
              >
                Current Location
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.locationModeBtn,
                locationMode === LOCATION_MODES.PICK_ON_MAP && styles.locationModeBtnActive,
              ]}
              onPress={() => setLocationMode(LOCATION_MODES.PICK_ON_MAP)}
            >
              <Text
                style={[
                  styles.locationModeBtnText,
                  locationMode === LOCATION_MODES.PICK_ON_MAP && styles.locationModeBtnTextActive,
                ]}
              >
                Choose on Map
              </Text>
            </TouchableOpacity>
          </View>

          {/* Hashtags */}
          <Text style={styles.sectionLabel}>Hashtags</Text>
          <TextInput
            style={styles.input}
            placeholder="#tag1 #tag2 #tag3"
            placeholderTextColor={COLORS.gray}
            value={hashtags}
            onChangeText={setHashtags}
          />
        </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
              <Text style={styles.submitBtnText}>Post</Text>
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
  container: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: SIZES.radiusXl,
    borderTopRightRadius: SIZES.radiusXl,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.dark,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.gray,
  },
  scrollContent: {
    padding: 16,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radius,
    padding: 12,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    color: COLORS.dark,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radius,
    padding: 12,
    fontSize: 14,
    marginBottom: 10,
    color: COLORS.dark,
  },
  textArea: {
    minHeight: 60,
  },
  previewContainer: {
    position: 'relative',
    marginBottom: 10,
    borderRadius: SIZES.radius,
    overflow: 'hidden',
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    minHeight: 180,
    maxHeight: 420,
    borderRadius: SIZES.radius,
    backgroundColor: COLORS.light,
  },
  removePreview: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePreviewText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '700',
  },
  mediaRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  mediaBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radius,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  mediaBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: 6,
    marginTop: 4,
  },
  geometryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  geometryBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radius,
    alignItems: 'center',
  },
  geometryBtnActive: {
    backgroundColor: COLORS.primary,
  },
  geometryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.dark,
  },
  geometryBtnTextActive: {
    color: COLORS.white,
  },
  layerRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  layerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radius,
  },
  layerBtnActive: {
    backgroundColor: COLORS.primary,
  },
  layerBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.dark,
  },
  layerBtnTextActive: {
    color: COLORS.white,
  },
  locationModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  locationModeBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radius,
    alignItems: 'center',
  },
  locationModeBtnActive: {
    backgroundColor: COLORS.primary,
  },
  locationModeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.dark,
  },
  locationModeBtnTextActive: {
    color: COLORS.white,
  },
  actions: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: COLORS.light,
    borderRadius: SIZES.radius,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radius,
    alignItems: 'center',
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
});

export default PostCreationForm;
