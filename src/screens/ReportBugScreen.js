import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StatusBar as RNStatusBar,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../context/ThemeContext';
import { getCurrentUser } from '../services/supabase';
import { getCurrentTelemetryScreen, submitBugReport } from '../services/telemetry';

const MIN_REPORT_LENGTH = 8;

const formatErrorMessage = (error) => {
  if (!error) return 'Unknown error';
  const message = String(error?.message || '').trim();
  if (message) return message;
  try {
    return JSON.stringify(error);
  } catch (_) {
    return 'Unknown error';
  }
};

const ReportBugScreen = ({ navigation, route }) => {
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(
    insets.top || 0,
    Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0,
  );
  const styles = createStyles(palette, topInset);
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    let active = true;
    const loadUser = async () => {
      const user = await getCurrentUser();
      if (!active) return;
      setUserId(user?.id || null);
    };
    loadUser();
    return () => {
      active = false;
    };
  }, []);

  const pickScreenshot = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission?.granted) {
        Alert.alert('Permission needed', 'Photo library permission is required.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.72,
        base64: true,
        selectionLimit: 1,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Automatic,
      });
      if (result.canceled) return;
      const asset = Array.isArray(result.assets) ? result.assets[0] : null;
      if (asset?.uri) {
        setScreenshot({
          uri: asset.uri,
          base64: asset.base64 || null,
          mimeType: asset.mimeType || null,
          fileName: asset.fileName || null,
          fileSize:
            typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize)
              ? asset.fileSize
              : null,
        });
      }
    } catch (error) {
      Alert.alert('Error', formatErrorMessage(error));
    }
  };

  const handleSubmit = async () => {
    const trimmed = String(description || '').trim();
    if (trimmed.length < MIN_REPORT_LENGTH) {
      Alert.alert(
        'More detail needed',
        `Please include at least ${MIN_REPORT_LENGTH} characters so we can reproduce the issue.`,
      );
      return;
    }
    if (screenshot && !userId) {
      Alert.alert(
        'Sign in required for screenshots',
        'You can still submit a text bug report now, or sign in first to attach a screenshot.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const fromScreen =
        route?.params?.fromScreen || getCurrentTelemetryScreen() || 'unknown';
      const result = await submitBugReport({
        description: trimmed,
        screenshot,
        currentScreen: fromScreen,
        metadata: {
          reportedFrom: 'settings',
          appVersion:
            Constants?.expoConfig?.version ||
            Constants?.manifest?.version ||
            'unknown',
          fromScreen,
          userSignedIn: Boolean(userId),
          screenshotMimeType: screenshot?.mimeType || null,
          screenshotFileSize:
            typeof screenshot?.fileSize === 'number' ? screenshot.fileSize : null,
        },
      });

      if (result.error) {
        throw result.error;
      }

      if (screenshot && !result?.screenshotPath) {
        const reason =
          result?.uploadError ||
          'Screenshot upload failed, but your text report was submitted.';
        Alert.alert('Report sent without screenshot', reason);
      } else if (result?.uploadError) {
        Alert.alert('Report sent', result.uploadError);
      }

      Alert.alert(
        'Thanks for the report',
        'Your bug report has been sent. We will review it and follow up in future updates.',
      );
      setDescription('');
      setScreenshot(null);
      navigation.goBack();
    } catch (error) {
      Alert.alert('Could not submit report', formatErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{'< Settings'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Report a Bug</Text>
        <Text style={styles.subtitle}>
          Describe what happened, what you expected, and the steps you took.
        </Text>

        <TextInput
          style={styles.descriptionInput}
          multiline
          textAlignVertical="top"
          editable={!submitting}
          value={description}
          onChangeText={setDescription}
          maxLength={2000}
          placeholderTextColor={palette.subtext}
        />

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.secondaryButton, submitting && styles.buttonDisabled]}
            onPress={pickScreenshot}
            disabled={submitting}
          >
            <Text style={styles.secondaryButtonText}>
              {screenshot ? 'Replace Screenshot' : 'Attach Screenshot'}
            </Text>
          </TouchableOpacity>
          {screenshot && (
            <TouchableOpacity
              style={[styles.secondaryButton, submitting && styles.buttonDisabled]}
              onPress={() => setScreenshot(null)}
              disabled={submitting}
            >
              <Text style={styles.secondaryButtonText}>Remove</Text>
            </TouchableOpacity>
          )}
        </View>

        {screenshot?.uri && (
          <Image source={{ uri: screenshot.uri }} style={styles.previewImage} />
        )}

        <TouchableOpacity
          style={[
            styles.submitButton,
            (submitting || description.trim().length < MIN_REPORT_LENGTH) &&
              styles.buttonDisabled,
          ]}
          disabled={submitting || description.trim().length < MIN_REPORT_LENGTH}
          onPress={handleSubmit}
        >
          <Text style={styles.submitButtonText}>
            {submitting ? 'Submitting...' : 'Send Bug Report'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (palette, topInset = 0) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    topBar: {
      paddingHorizontal: 20,
      paddingTop: Math.max(topInset + 10, 56),
      paddingBottom: 8,
    },
    backText: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.primary,
    },
    content: {
      paddingHorizontal: 24,
      paddingBottom: 36,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: palette.text,
      marginTop: 12,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 20,
      color: palette.subtext,
      marginBottom: 16,
    },
    descriptionInput: {
      minHeight: 170,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      color: palette.text,
      fontSize: 15,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    actionRow: {
      marginTop: 12,
      flexDirection: 'row',
      gap: 10,
    },
    secondaryButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    secondaryButtonText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: '600',
    },
    previewImage: {
      marginTop: 12,
      width: '100%',
      height: 220,
      borderRadius: 12,
      backgroundColor: palette.mutedSurface,
    },
    submitButton: {
      marginTop: 16,
      borderRadius: 12,
      backgroundColor: palette.primary,
      paddingVertical: 14,
      alignItems: 'center',
    },
    submitButtonText: {
      color: palette.onPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });

export default ReportBugScreen;
