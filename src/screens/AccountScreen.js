import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { supabase, getCurrentUser, signIn, signUp, signOut } from '../services/supabase';
import { COLORS, SIZES } from '../constants/theme';

const AccountScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  useEffect(() => {
    loadUser();
    
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setCurrentUser(session.user);
        } else {
          setCurrentUser(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const loadUser = async () => {
    const user = await getCurrentUser();
    setCurrentUser(user);
  };

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await signIn(email, password);
      if (error) throw error;

      Alert.alert('Success', 'Signed in successfully!');
      clearForm();
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    if (!username.trim()) {
      Alert.alert('Error', 'Please enter a username');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    console.log('Attempting sign up with:', { email, username });

    setLoading(true);
    try {
      const { data, error } = await signUp(
        email,
        password,
        username.toLowerCase().trim(),
        displayName.trim() || username.trim()
      );

      console.log('Sign up response:', { data, error });

      if (error) throw error;

      // With email confirmation disabled, user should be logged in automatically
      if (data?.user) {
        Alert.alert('Success', 'Account created! You are now signed in.');
        clearForm();
      } else {
        Alert.alert(
          'Success',
          'Account created! Please check your email to verify your account.',
          [{ text: 'OK', onPress: () => setIsSignUp(false) }]
        );
        clearForm();
      }
    } catch (error) {
      console.error('Sign up error:', error);
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const clearForm = () => {
    setEmail('');
    setPassword('');
    setUsername('');
    setDisplayName('');
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    clearForm();
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      const { error } = await signOut();
      if (error) throw error;
      
      Alert.alert('Success', 'Signed out successfully!');
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  if (currentUser) {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.navigate('Map')}
          >
            <Text style={styles.backButtonText}>{'< Map'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.profileContainer}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>Vent</Text>
            <Text style={styles.tagline}>Share your world</Text>
          </View>

          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>
              {currentUser.user_metadata?.display_name || 'User'}
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
              {loading ? 'Signing out...' : 'Sign Out'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.navigate('Map')}
        >
          <Text style={styles.backButtonText}>{'< Map'}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>Vent</Text>
          <Text style={styles.tagline}>Share your world</Text>
        </View>

        <View style={styles.form}>
          {isSignUp && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Username"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoComplete="username"
              />
              <TextInput
                style={styles.input}
                placeholder="Display Name (optional)"
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
            </>
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={isSignUp ? 'new-password' : 'password'}
          />

          <TouchableOpacity
            style={styles.button}
            onPress={isSignUp ? handleSignUp : handleSignIn}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading
                ? (isSignUp ? 'Creating account...' : 'Signing in...')
                : (isSignUp ? 'Create Account' : 'Sign In')}
            </Text>
          </TouchableOpacity>
        </View>

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
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          </Text>
          <TouchableOpacity onPress={toggleMode}>
            <Text style={styles.footerLink}>
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scrollContent: {
    flexGrow: 1,
    padding: SIZES.xxl,
    justifyContent: 'center',
  },
  profileContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SIZES.xxl,
  },
  logo: {
    alignItems: 'center',
    marginBottom: SIZES.xxl * 2,
  },
  logoText: {
    fontSize: 48,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: SIZES.sm,
  },
  tagline: {
    fontSize: SIZES.md,
    color: COLORS.gray,
  },
  form: {
    marginBottom: SIZES.xxl,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: SIZES.radiusLg,
    padding: SIZES.lg,
    fontSize: SIZES.md,
    marginBottom: SIZES.lg,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: SIZES.radiusLg,
    padding: SIZES.lg,
    alignItems: 'center',
  },
  signOutButton: {
    backgroundColor: COLORS.danger,
    marginTop: SIZES.xxl,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: SIZES.md,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SIZES.xxl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    marginHorizontal: SIZES.md,
    color: COLORS.gray,
    fontSize: SIZES.sm,
  },
  socialButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SIZES.lg,
    marginBottom: SIZES.xxl,
  },
  socialButton: {
    width: 56,
    height: 56,
    borderRadius: SIZES.radiusFull,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  socialIcon: {
    fontSize: 24,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  footerText: {
    color: COLORS.gray,
    fontSize: SIZES.sm,
  },
  footerLink: {
    color: COLORS.primary,
    fontSize: SIZES.sm,
    fontWeight: '600',
  },
  profileInfo: {
    alignItems: 'center',
    marginBottom: SIZES.xxl,
  },
  displayName: {
    fontSize: SIZES.xxl,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: SIZES.xs,
  },
  username: {
    fontSize: SIZES.md,
    color: COLORS.primary,
    marginBottom: SIZES.sm,
  },
  email: {
    fontSize: SIZES.sm,
    color: COLORS.gray,
  },
  topBar: {
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingHorizontal: SIZES.lg,
    paddingBottom: SIZES.sm,
  },
  backButton: {
    paddingVertical: SIZES.sm,
    paddingRight: SIZES.lg,
  },
  backButtonText: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.primary,
  },
});

export default AccountScreen;
