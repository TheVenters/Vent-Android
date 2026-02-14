import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
} from 'react-native';
import MapView, { Polyline, Polygon, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase, getCurrentUser } from '../services/supabase';
import { COLORS, SIZES, DEFAULT_REGION, LAYERS, GEOMETRY_TYPES } from '../constants/theme';
import PinDetailModal from '../components/PinDetailModal';
import CustomMarker from '../components/CustomMarker';
import ActionButtonCluster from '../components/ActionButtonCluster';
import { useAppTheme } from '../context/ThemeContext';
import { MAP_DARK_STYLE } from '../constants/mapDarkStyle';

const MapScreen = ({ navigation }) => {
  const { isDark, palette } = useAppTheme();
  const styles = createStyles(palette);
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [pins, setPins] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState(LAYERS.PUBLIC);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedPin, setSelectedPin] = useState(null);
  const [pinVoteSummary, setPinVoteSummary] = useState({
    upvotes: 0,
    downvotes: 0,
    userVote: 0,
  });
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [mapType, setMapType] = useState('standard');
  const [userLocation, setUserLocation] = useState(null);

  // Drawing mode state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isPickingPostLocation, setIsPickingPostLocation] = useState(false);
  const [drawingCoords, setDrawingCoords] = useState([]);
  const [drawingType, setDrawingType] = useState(null);
  const [pendingPostData, setPendingPostData] = useState(null);

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
        const loc = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setUserLocation(loc);
        setRegion({
          ...loc,
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
            setPins((prev) => {
              if (prev.some((pin) => pin.id === payload.new.id)) {
                return prev;
              }
              return [payload.new, ...prev];
            });
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
    if (isPickingPostLocation && pendingPostData) {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      const nextPostData = {
        ...pendingPostData,
        location: { latitude, longitude },
      };
      setPendingPostData(nextPostData);
      setIsPickingPostLocation(false);
      handlePostSubmit(nextPostData);
      return;
    }

    if (isDrawingMode) {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      setDrawingCoords((prev) => [...prev, { latitude, longitude }]);
    }
  };

  const handleStartDrawing = (geometryType) => {
    setIsDrawingMode(true);
    setDrawingType(geometryType);
    setDrawingCoords([]);
  };

  const handleFinishDrawing = () => {
    setIsDrawingMode(false);
    // Drawing coords are kept for submission
  };

  const handlePostSubmit = async (postData) => {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Please sign in to create posts');
      navigation.navigate('Account');
      return;
    }

    if (postData.locationMode === 'pick_on_map' && !postData.location) {
      setPendingPostData(postData);
      setIsPickingPostLocation(true);
      Alert.alert('Select Location', 'Tap on the map to place this post.');
      return;
    }

    // If Line/Plane geometry and not yet drawn, enter drawing mode
    if (
      postData.geometryType !== GEOMETRY_TYPES.POINT &&
      drawingCoords.length === 0
    ) {
      setPendingPostData(postData);
      handleStartDrawing(postData.geometryType);
      return;
    }

    try {
      const insertData = {
        user_id: currentUser.id,
        type: postData.mediaUrl ? 'media' : 'text',
        content: postData.content,
        caption: postData.title,
        media_url: postData.mediaUrl || null,
        media_type: postData.mediaType,
        lat: postData.location?.latitude || userLocation?.latitude || region.latitude,
        lng: postData.location?.longitude || userLocation?.longitude || region.longitude,
        layer: postData.layer,
        author_name: currentUser.user_metadata?.display_name || 'Anonymous',
        author_username: currentUser.user_metadata?.username || '',
        posted_from_current_location: postData.locationMode === 'current',
      };

      // Store geometry data if line/plane
      if (postData.geometryType !== GEOMETRY_TYPES.POINT && drawingCoords.length > 0) {
        insertData.geometry_type = postData.geometryType;
        insertData.geometry_coords = JSON.stringify(drawingCoords);
      }

      const { error } = await supabase.from('pins').insert([insertData]);
      if (error) throw error;

      setDrawingCoords([]);
      setDrawingType(null);
      setPendingPostData(null);
      setIsPickingPostLocation(false);
      Alert.alert('Success', 'Post created!');
    } catch (error) {
      console.error('Error creating post:', error);
      Alert.alert('Error', 'Failed to create post. Please try again.');
    }
  };

  const handleSearch = useCallback((location) => {
    if (!location || !location.latitude || !location.longitude) return;

    if (mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        800
      );
    }
  }, []);

  const loadPinVotes = async (pinId) => {
    try {
      const { data, error } = await supabase
        .from('pin_votes')
        .select('user_id, vote')
        .eq('pin_id', pinId);

      if (error) throw error;

      const summary = { upvotes: 0, downvotes: 0, userVote: 0 };
      (data || []).forEach((voteRow) => {
        if (voteRow.vote === 1) summary.upvotes += 1;
        if (voteRow.vote === -1) summary.downvotes += 1;
        if (voteRow.user_id === currentUser?.id) {
          summary.userVote = voteRow.vote;
        }
      });

      setPinVoteSummary(summary);
    } catch (error) {
      console.error('Error loading pin votes:', error);
      setPinVoteSummary({ upvotes: 0, downvotes: 0, userVote: 0 });
    }
  };

  const handlePinPress = (pin) => {
    setSelectedPin(pin);
    loadPinVotes(pin.id);
    setShowDetailModal(true);
  };

  const handleVotePin = async (vote) => {
    if (!selectedPin || !currentUser) {
      Alert.alert('Sign In Required', 'Please sign in to vote on pins');
      return;
    }

    if (selectedPin.user_id === currentUser.id) return;

    try {
      setIsSubmittingVote(true);

      if (pinVoteSummary.userVote === vote) {
        const { error } = await supabase
          .from('pin_votes')
          .delete()
          .eq('pin_id', selectedPin.id)
          .eq('user_id', currentUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('pin_votes')
          .upsert(
            {
              pin_id: selectedPin.id,
              user_id: currentUser.id,
              vote,
            },
            { onConflict: 'pin_id,user_id' }
          );
        if (error) throw error;
      }

      await loadPinVotes(selectedPin.id);
    } catch (error) {
      console.error('Error voting on pin:', error);
      Alert.alert('Error', 'Failed to submit vote. Please try again.');
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleUpdatePin = async (pinId, updates) => {
    try {
      const { error } = await supabase
        .from('pins')
        .update(updates)
        .eq('id', pinId);

      if (error) throw error;

      setPins((prev) =>
        prev.map((pin) => (pin.id === pinId ? { ...pin, ...updates } : pin))
      );
      setSelectedPin((prev) => (prev ? { ...prev, ...updates } : null));
      Alert.alert('Success', 'Pin updated!');
    } catch (error) {
      console.error('Error updating pin:', error);
      Alert.alert('Error', 'Failed to update pin');
    }
  };

  const handleDeletePin = async (pinId) => {
    try {
      const { error } = await supabase
        .from('pins')
        .delete()
        .eq('id', pinId);

      if (error) throw error;

      setPins((prev) => prev.filter((pin) => pin.id !== pinId));
      setShowDetailModal(false);
      setSelectedPin(null);
      Alert.alert('Success', 'Pin deleted!');
    } catch (error) {
      console.error('Error deleting pin:', error);
      Alert.alert('Error', 'Failed to delete pin');
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
        customMapStyle={isDark ? MAP_DARK_STYLE : []}
        onPress={(isDrawingMode || isPickingPostLocation) ? handleMapPress : undefined}
        zoomEnabled
        scrollEnabled
        scrollDuringRotateOrZoomEnabled={true}
        rotateEnabled={false}
        pitchEnabled={false}
        moveOnMarkerPress={false}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {pins.map((pin) => (
          <CustomMarker key={pin.id} pin={pin} onPress={handlePinPress} />
        ))}

        {/* Drawing mode: render in-progress polyline/polygon */}
        {isDrawingMode && drawingCoords.length >= 2 && drawingType === GEOMETRY_TYPES.LINE && (
          <Polyline
            coordinates={drawingCoords}
            strokeColor={COLORS.primary}
            strokeWidth={3}
          />
        )}
        {isDrawingMode && drawingCoords.length >= 3 && drawingType === GEOMETRY_TYPES.PLANE && (
          <Polygon
            coordinates={drawingCoords}
            strokeColor={COLORS.primary}
            fillColor="rgba(102, 126, 234, 0.2)"
            strokeWidth={2}
          />
        )}
      </MapView>

      {/* Drawing Mode Done Bar */}
      {isDrawingMode && (
        <View style={styles.drawingBar}>
          <Text style={styles.drawingBarText}>
            Tap map to add points ({drawingCoords.length} placed)
          </Text>
          <TouchableOpacity
            style={styles.drawingDoneBtn}
            onPress={() => {
              handleFinishDrawing();
              // If we have pending post data, re-submit with coords
              if (pendingPostData) {
                handlePostSubmit(pendingPostData);
              }
            }}
          >
            <Text style={styles.drawingDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Pick Location Bar */}
      {isPickingPostLocation && (
        <View style={styles.drawingBar}>
          <Text style={styles.drawingBarText}>
            Tap on the map where you want to place this post
          </Text>
          <TouchableOpacity
            style={styles.drawingDoneBtn}
            onPress={() => {
              setIsPickingPostLocation(false);
              setPendingPostData(null);
            }}
          >
            <Text style={styles.drawingDoneBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Action Button Cluster */}
      {!isDrawingMode && !isPickingPostLocation && (
        <ActionButtonCluster
          navigation={navigation}
          mapRef={mapRef}
          pins={pins}
          selectedLayer={selectedLayer}
          onLayerChange={setSelectedLayer}
          onPostSubmit={handlePostSubmit}
          userLocation={userLocation}
          isDrawingMode={isDrawingMode}
          onStartDrawing={handleStartDrawing}
          onSearch={handleSearch}
        />
      )}

      {/* Pin Detail Modal */}
      <PinDetailModal
        visible={showDetailModal}
        pin={selectedPin}
        currentUserId={currentUser?.id}
        pinVoteSummary={pinVoteSummary}
        isSubmittingVote={isSubmittingVote}
        onVote={handleVotePin}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedPin(null);
          setPinVoteSummary({ upvotes: 0, downvotes: 0, userVote: 0 });
        }}
        onUpdate={handleUpdatePin}
        onDelete={handleDeletePin}
      />
    </View>
  );
};

const createStyles = (palette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  map: {
    flex: 1,
  },
  drawingBar: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surface,
    borderRadius: SIZES.radiusLg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  drawingBarText: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.text,
    flex: 1,
  },
  drawingDoneBtn: {
    backgroundColor: palette.primary,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: SIZES.radius,
    marginLeft: 12,
  },
  drawingDoneBtnText: {
    color: palette.onPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
});

export default MapScreen;
