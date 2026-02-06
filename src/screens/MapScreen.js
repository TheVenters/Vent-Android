import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase, getCurrentUser } from '../services/supabase';
import { COLORS, SIZES, DEFAULT_REGION, PIN_TYPES, LAYERS } from '../constants/theme';
import PinModal from '../components/PinModal';
import CustomMarker from '../components/CustomMarker';

const MapScreen = ({ navigation }) => {
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [pins, setPins] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState(LAYERS.PUBLIC);
  const [isPlacingPin, setIsPlacingPin] = useState(false);
  const [pendingPinLocation, setPendingPinLocation] = useState(null);
  const [pendingPinType, setPendingPinType] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapType, setMapType] = useState('standard');
  const mapRef = useRef(null);

  useEffect(() => {
    initializeUser();
    requestLocationPermission();
    loadPins();
    subscribeToPins();
  }, [selectedLayer]);

  const initializeUser = async () => {
    const user = await getCurrentUser();
    setCurrentUser(user);
  };

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        setRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      }
    } catch (error) {
      console.error('Error getting location:', error);
    }
  };

  const loadPins = async () => {
    try {
      const { data, error } = await supabase
        .from('pins')
        .select('*')
        .eq('layer', selectedLayer)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPins(data || []);
    } catch (error) {
      console.error('Error loading pins:', error);
    }
  };

  const subscribeToPins = () => {
    const subscription = supabase
      .channel(`pins-${selectedLayer}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pins',
          filter: `layer=eq.${selectedLayer}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setPins((prev) => [payload.new, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setPins((prev) =>
              prev.map((pin) => (pin.id === payload.new.id ? payload.new : pin))
            );
          } else if (payload.eventType === 'DELETE') {
            setPins((prev) => prev.filter((pin) => pin.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const handleMapPress = (event) => {
    if (isPlacingPin) {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      setPendingPinLocation({ latitude, longitude });
      setShowPinModal(true);
      setIsPlacingPin(false);
    }
  };

  const startPinPlacement = (type) => {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Please sign in to create posts');
      navigation.navigate('Account');
      return;
    }
    setIsPlacingPin(true);
    setPendingPinType(type);
    Alert.alert('Place Pin', 'Tap on the map to place your pin');
  };

  const handleCreatePin = async (pinData) => {
    try {
      const { error } = await supabase.from('pins').insert([
        {
          user_id: currentUser.id,
          type: pendingPinType,
          content: pinData.content,
          caption: pinData.caption,
          media_url: pinData.mediaUrl,
          media_type: pinData.mediaType,
          lat: pendingPinLocation.latitude,
          lng: pendingPinLocation.longitude,
          layer: selectedLayer,
          author_name: currentUser.user_metadata?.display_name || 'Anonymous',
          author_username: currentUser.user_metadata?.username || '',
        },
      ]);

      if (error) throw error;
      
      setShowPinModal(false);
      setPendingPinLocation(null);
      setPendingPinType(null);
      Alert.alert('Success', 'Pin created successfully!');
    } catch (error) {
      console.error('Error creating pin:', error);
      Alert.alert('Error', 'Failed to create pin. Please try again.');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      // Use a geocoding service here
      // For now, we'll just show an alert
      Alert.alert('Search', `Searching for: ${searchQuery}`);
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={region}
        mapType={mapType}
        onPress={handleMapPress}
        showsUserLocation
        showsMyLocationButton
      >
        {pins.map((pin) => (
          <CustomMarker key={pin.id} pin={pin} />
        ))}
      </MapView>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search location or community..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
      </View>

      {/* FAB Menu */}
      <View style={styles.fabContainer}>
        <TouchableOpacity
          style={[styles.fabButton, { backgroundColor: COLORS.warning }]}
          onPress={() => startPinPlacement(PIN_TYPES.TEXT)}
        >
          <Text style={styles.fabIcon}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.fabButton, { backgroundColor: COLORS.success }]}
          onPress={() => startPinPlacement(PIN_TYPES.MEDIA)}
        >
          <Text style={styles.fabIcon}>📸</Text>
        </TouchableOpacity>
      </View>

      {/* Layer Selector */}
      <View style={styles.layerContainer}>
        <TouchableOpacity
          style={[styles.layerButton, selectedLayer === LAYERS.PUBLIC && styles.layerButtonActive]}
          onPress={() => setSelectedLayer(LAYERS.PUBLIC)}
        >
          <Text style={styles.layerText}>Public</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, selectedLayer === LAYERS.FRIENDS && styles.layerButtonActive]}
          onPress={() => setSelectedLayer(LAYERS.FRIENDS)}
        >
          <Text style={styles.layerText}>Friends</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.layerButton, selectedLayer === LAYERS.PRIVATE && styles.layerButtonActive]}
          onPress={() => setSelectedLayer(LAYERS.PRIVATE)}
        >
          <Text style={styles.layerText}>Private</Text>
        </TouchableOpacity>
      </View>

      {/* Pin Creation Modal */}
      {showPinModal && (
        <PinModal
          visible={showPinModal}
          type={pendingPinType}
          onClose={() => {
            setShowPinModal(false);
            setPendingPinLocation(null);
            setPendingPinType(null);
          }}
          onSubmit={handleCreatePin}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 20,
    right: 20,
    backgroundColor: COLORS.white,
    borderRadius: SIZES.radiusXl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  searchInput: {
    padding: SIZES.lg,
    fontSize: SIZES.md,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    gap: SIZES.md,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: SIZES.radiusFull,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 24,
  },
  layerContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 80,
    left: 20,
    flexDirection: 'row',
    gap: SIZES.sm,
  },
  layerButton: {
    paddingHorizontal: SIZES.lg,
    paddingVertical: SIZES.sm,
    backgroundColor: COLORS.white,
    borderRadius: SIZES.radiusLg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  layerButtonActive: {
    backgroundColor: COLORS.primary,
  },
  layerText: {
    fontSize: SIZES.sm,
    fontWeight: '600',
  },
});

export default MapScreen;
