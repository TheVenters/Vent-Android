import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { COLORS, SIZES } from '../constants/theme';

const CommunitiesScreen = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.navigate('Map')}
        >
          <Text style={styles.backButtonText}>{'< Map'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Communities</Text>
      </View>
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Coming Soon</Text>
        <Text style={styles.emptyText}>
          Communities will let you connect with groups of people who share your interests.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingHorizontal: SIZES.xl,
    paddingBottom: SIZES.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SIZES.md,
  },
  backButton: {
    paddingVertical: SIZES.sm,
    paddingRight: SIZES.sm,
  },
  backButtonText: {
    fontSize: SIZES.md,
    fontWeight: '600',
    color: COLORS.primary,
  },
  title: {
    fontSize: SIZES.xxl,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SIZES.xxl * 2,
  },
  emptyTitle: {
    fontSize: SIZES.lg,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: SIZES.sm,
  },
  emptyText: {
    fontSize: SIZES.md,
    color: COLORS.gray,
    textAlign: 'center',
  },
});

export default CommunitiesScreen;
