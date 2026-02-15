import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  supabase,
  getCurrentUser,
  signIn,
  signUp,
  signOut,
  resetPassword,
  resetPasswordWithOtp,
} from "../services/supabase";
import { SIZES } from "../constants/theme";
import { useAppTheme } from "../context/ThemeContext";

const AccountScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [resetStep, setResetStep] = useState(null);
  const [resetEmail, setResetEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const { palette } = useAppTheme();
  const styles = createStyles(palette);

  useEffect(() => {
    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.user) {
        setCurrentUser(session.user);
      } else {
        setCurrentUser(null);
        setAvatarUrl(null);
        setResetStep(null);
        setResetEmail("");
        setOtpCode("");
        setNewPassword("");
        setConfirmPassword("");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    loadProfile(currentUser.id);
  }, [currentUser?.id]);

  const loadUser = async () => {
    const user = await getCurrentUser();
    setCurrentUser(user);
    if (user?.id) {
      await loadProfile(user.id);
    } else {
      setAvatarUrl(null);
    }
  };

  const loadProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      setAvatarUrl(data?.avatar_url || null);
    } catch (error) {
      const message = String(error?.message || "").toLowerCase();
      const isNetworkError =
        message.includes("network request failed") ||
        message.includes("fetch failed");
      if (!isNetworkError) {
        console.error("Error loading profile avatar:", error);
      }
      setAvatarUrl(null);
    }
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter email and password");
      return;
    }

    setLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) throw error;

      Alert.alert("Success", "Signed in successfully!");
      clearForm();
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter email and password");
      return;
    }
    if (!username.trim()) {
      Alert.alert("Error", "Please enter a username");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await signUp(
        email,
        password,
        username.toLowerCase().trim(),
        displayName.trim() || username.trim(),
      );

      if (error) throw error;

      if (data?.user) {
        Alert.alert("Success", "Account created! You are now signed in.");
        clearForm();
      } else {
        Alert.alert(
          "Success",
          "Account created! Please check your email to verify your account.",
          [{ text: "OK", onPress: () => setIsSignUp(false) }],
        );
        clearForm();
      }
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const clearForm = () => {
    setEmail("");
    setPassword("");
    setUsername("");
    setDisplayName("");
    setResetStep(null);
    setResetEmail("");
    setOtpCode("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    clearForm();
  };

  const handleForgotPassword = () => {
    setResetStep("email");
    setResetEmail(email.trim());
  };

  const cancelReset = () => {
    setResetStep(null);
    setResetEmail("");
    setOtpCode("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSendResetCode = async () => {
    const trimmedEmail = resetEmail.trim();
    if (!trimmedEmail) {
      Alert.alert("Error", "Please enter your email address");
      return;
    }

    setLoading(true);
    try {
      const { error } = await resetPassword(trimmedEmail);
      if (error) throw error;

      Alert.alert(
        "Code Sent",
        "If an account exists with that email, you will receive a reset code. Please check your inbox.",
      );
      setResetStep("otp");
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const trimmedOtp = otpCode.trim();
    if (!trimmedOtp || trimmedOtp.length < 6) {
      Alert.alert("Error", "Please enter the code from your email");
      return;
    }
    if (!newPassword.trim()) {
      Alert.alert("Error", "Please enter a new password");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const resetResult = await resetPasswordWithOtp(
        resetEmail.trim(),
        trimmedOtp,
        newPassword,
      );
      if (resetResult.error) throw resetResult.error;

      Alert.alert("Success", "Your password has been reset successfully!", [
        {
          text: "OK",
          onPress: () => {
            setResetStep(null);
            setResetEmail("");
            setOtpCode("");
            setNewPassword("");
            setConfirmPassword("");
          },
        },
      ]);
    } catch (error) {
      Alert.alert(
        "Error",
        error?.message ||
          "Failed to reset password. Please request a new code and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const { error } = await signOut();
      if (error) throw error;

      Alert.alert("Success", "Signed out successfully!");
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePickAvatar = async () => {
    if (!currentUser?.id) return;

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Needed", "Please allow photo library access.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert("Error", "Unable to process selected image.");
        return;
      }

      const nextAvatarUrl = `data:image/jpeg;base64,${asset.base64}`;
      setLoading(true);

      const existingProfileRes = await supabase
        .from("profiles")
        .select("username")
        .eq("id", currentUser.id)
        .maybeSingle();
      if (existingProfileRes.error) throw existingProfileRes.error;

      const fallbackUsername = `user-${currentUser.id.slice(0, 8)}`;
      const usernameValue =
        existingProfileRes.data?.username ||
        currentUser.user_metadata?.username ||
        fallbackUsername;

      const upsertRes = await supabase.from("profiles").upsert(
        {
          id: currentUser.id,
          username: usernameValue,
          display_name:
            currentUser.user_metadata?.display_name ||
            currentUser.user_metadata?.username ||
            usernameValue,
          avatar_url: nextAvatarUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (upsertRes.error) throw upsertRes.error;

      const { error: updateMetaError } = await supabase.auth.updateUser({
        data: {
          avatar_url: nextAvatarUrl,
        },
      });
      if (updateMetaError) throw updateMetaError;

      setAvatarUrl(nextAvatarUrl);
      await loadUser();
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to update profile image.");
    } finally {
      setLoading(false);
    }
  };

  const TopBar = () => (
    <View style={styles.topBar}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.navigate("Map")}
      >
        <Text style={styles.backButtonText}>{"< Map"}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate("Settings")}
      >
        <Text style={styles.settingsButtonText}>Settings</Text>
      </TouchableOpacity>
    </View>
  );

  if (currentUser) {
    return (
      <View style={styles.container}>
        <TopBar />
        <View style={styles.profileContainer}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>Vent</Text>
            <Text style={styles.tagline}>Share your world</Text>
          </View>

          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handlePickAvatar}
            disabled={loading}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitial}>
                {String(
                  currentUser.user_metadata?.username ||
                    currentUser.user_metadata?.display_name ||
                    currentUser.email ||
                    "U",
                )
                  .trim()
                  .charAt(0)
                  .toUpperCase()}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={handlePickAvatar}
            disabled={loading}
          >
            <Text style={styles.avatarButtonText}>
              {loading ? "Saving..." : "Change Profile Image"}
            </Text>
          </TouchableOpacity>

          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>
              {currentUser.user_metadata?.display_name || "User"}
            </Text>
            {currentUser.user_metadata?.username && (
              <Text style={styles.username}>
                @{currentUser.user_metadata.username}
              </Text>
            )}
            <Text style={styles.email}>{currentUser.email}</Text>
          </View>

          <TouchableOpacity
            style={[styles.button, styles.signOutButton]}
            onPress={handleSignOut}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? "Signing out..." : "Sign Out"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <TopBar />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>Vent</Text>
          <Text style={styles.tagline}>Share your world</Text>
        </View>

        {resetStep === "email" ? (
          <View style={styles.form}>
            <Text style={styles.resetTitle}>Reset Password</Text>
            <Text style={styles.resetSubtitle}>
              Enter your email address and we'll send you a code to reset your
              password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={palette.subtext}
              value={resetEmail}
              onChangeText={setResetEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoFocus
            />
            <TouchableOpacity
              style={styles.button}
              onPress={handleSendResetCode}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? "Sending..." : "Send Reset Code"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={cancelReset}
            >
              <Text style={styles.cancelButtonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        ) : resetStep === "otp" ? (
          <View style={styles.form}>
            <Text style={styles.resetTitle}>Reset Password</Text>
            <Text style={styles.resetSubtitle}>
              We sent a code to {resetEmail}. Enter it below along with your
              new password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Reset code"
              placeholderTextColor={palette.subtext}
              value={otpCode}
              onChangeText={setOtpCode}
              keyboardType="number-pad"
              maxLength={8}
              autoFocus
            />
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor={palette.subtext}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor={palette.subtext}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
            />
            <TouchableOpacity
              style={styles.button}
              onPress={handleResetPassword}
              disabled={loading}
            >
              <Text style={styles.buttonText}>
                {loading ? "Resetting..." : "Reset Password"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.resendButton}
              onPress={handleSendResetCode}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>Resend Code</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={cancelReset}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.form}>
              {isSignUp && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Username"
                    placeholderTextColor={palette.subtext}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoComplete="username"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Display Name (optional)"
                    placeholderTextColor={palette.subtext}
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoCapitalize="words"
                  />
                </>
              )}
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={palette.subtext}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={palette.subtext}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={isSignUp ? "new-password" : "password"}
              />

              <TouchableOpacity
                style={styles.button}
                onPress={isSignUp ? handleSignUp : handleSignIn}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {loading
                    ? isSignUp
                      ? "Creating account..."
                      : "Signing in..."
                    : isSignUp
                      ? "Create Account"
                      : "Sign In"}
                </Text>
              </TouchableOpacity>
            </View>

            {!isSignUp && (
              <TouchableOpacity
                style={styles.forgotPasswordButton}
                onPress={handleForgotPassword}
              >
                <Text style={styles.forgotPasswordText}>
                  Forgot Password?
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.socialButtons}>
              <TouchableOpacity style={styles.socialButton}>
                <Text style={styles.socialIcon}>🌐</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.socialButton}>
                <Text style={styles.socialIcon}>🍎</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.socialButton}>
                <Text style={styles.socialIcon}>📱</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {isSignUp
                  ? "Already have an account? "
                  : "Don't have an account? "}
              </Text>
              <TouchableOpacity onPress={toggleMode}>
                <Text style={styles.footerLink}>
                  {isSignUp ? "Sign In" : "Sign Up"}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const createStyles = (palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    scrollContent: {
      flexGrow: 1,
      padding: SIZES.xxl,
      justifyContent: "center",
    },
    profileContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: SIZES.xxl,
    },
    logo: {
      alignItems: "center",
      marginBottom: SIZES.xxl * 2,
    },
    logoText: {
      fontSize: 48,
      fontWeight: "700",
      color: palette.primary,
      marginBottom: SIZES.sm,
    },
    tagline: {
      fontSize: SIZES.md,
      color: palette.subtext,
    },
    form: {
      marginBottom: SIZES.xxl,
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: SIZES.radiusLg,
      padding: SIZES.lg,
      fontSize: SIZES.md,
      marginBottom: SIZES.lg,
      color: palette.text,
      backgroundColor: palette.surface,
    },
    button: {
      backgroundColor: palette.primary,
      borderRadius: SIZES.radiusLg,
      padding: SIZES.lg,
      alignItems: "center",
    },
    signOutButton: {
      backgroundColor: palette.danger,
      marginTop: SIZES.xxl,
    },
    buttonText: {
      color: palette.onPrimary,
      fontSize: SIZES.md,
      fontWeight: "600",
    },
    resetTitle: {
      fontSize: SIZES.xxl,
      fontWeight: "700",
      color: palette.text,
      marginBottom: SIZES.sm,
    },
    resetSubtitle: {
      fontSize: SIZES.sm,
      color: palette.subtext,
      marginBottom: SIZES.xxl,
      lineHeight: SIZES.xl,
    },
    forgotPasswordButton: {
      alignItems: "center",
      marginTop: SIZES.md,
      marginBottom: SIZES.sm,
    },
    forgotPasswordText: {
      color: palette.primary,
      fontSize: SIZES.sm,
      fontWeight: "600",
    },
    cancelButton: {
      alignItems: "center",
      marginTop: SIZES.lg,
      padding: SIZES.sm,
    },
    cancelButtonText: {
      color: palette.subtext,
      fontSize: SIZES.sm,
      fontWeight: "600",
    },
    resendButton: {
      alignItems: "center",
      marginTop: SIZES.lg,
      padding: SIZES.sm,
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: SIZES.xxl,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: palette.border,
    },
    dividerText: {
      marginHorizontal: SIZES.md,
      color: palette.subtext,
      fontSize: SIZES.sm,
    },
    socialButtons: {
      flexDirection: "row",
      justifyContent: "center",
      gap: SIZES.lg,
      marginBottom: SIZES.xxl,
    },
    socialButton: {
      width: 56,
      height: 56,
      borderRadius: SIZES.radiusFull,
      backgroundColor: palette.mutedSurface,
      justifyContent: "center",
      alignItems: "center",
    },
    socialIcon: {
      fontSize: 24,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
    },
    footerText: {
      color: palette.subtext,
      fontSize: SIZES.sm,
    },
    footerLink: {
      color: palette.primary,
      fontSize: SIZES.sm,
      fontWeight: "600",
    },
    profileInfo: {
      alignItems: "center",
      marginBottom: SIZES.xxl,
    },
    avatarWrap: {
      width: 92,
      height: 92,
      borderRadius: 46,
      backgroundColor: palette.mutedSurface,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: SIZES.md,
      overflow: "hidden",
    },
    avatarImage: {
      width: "100%",
      height: "100%",
    },
    avatarInitial: {
      fontSize: 34,
      fontWeight: "800",
      color: palette.primary,
    },
    avatarButton: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      marginBottom: SIZES.lg,
    },
    avatarButtonText: {
      color: palette.text,
      fontSize: 13,
      fontWeight: "700",
    },
    displayName: {
      fontSize: SIZES.xxl,
      fontWeight: "700",
      color: palette.text,
      marginBottom: SIZES.xs,
    },
    username: {
      fontSize: SIZES.md,
      color: palette.primary,
      marginBottom: SIZES.sm,
    },
    email: {
      fontSize: SIZES.sm,
      color: palette.subtext,
    },
    topBar: {
      paddingTop: Platform.OS === "ios" ? 50 : 20,
      paddingHorizontal: SIZES.lg,
      paddingBottom: SIZES.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    backButton: {
      paddingVertical: SIZES.sm,
      paddingRight: SIZES.lg,
    },
    backButtonText: {
      fontSize: SIZES.md,
      fontWeight: "600",
      color: palette.primary,
    },
    settingsButton: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    settingsButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.text,
    },
  });

export default AccountScreen;
