# Web to React Native Migration Guide

This document explains the key changes made when converting the Vent app from a web application to React Native.

## Overview

The original Vent app was a vanilla JavaScript web application using:
- HTML/CSS for UI
- Leaflet.js for maps
- Supabase for backend
- Direct DOM manipulation

The React Native version uses:
- React Native components
- React Native Maps
- Same Supabase backend
- React state management

## Component Conversions

### HTML → React Native Components

| Web (HTML)            | React Native              |
|-----------------------|---------------------------|
| `<div>`               | `<View>`                  |
| `<span>`, `<p>`       | `<Text>`                  |
| `<button>`            | `<TouchableOpacity>`      |
| `<input type="text">` | `<TextInput>`             |
| `<input type="checkbox">` | Custom component      |
| `<select>`            | `<Picker>` (or custom)    |
| `<img>`               | `<Image>`                 |
| `<a>`                 | `<TouchableOpacity>` + navigation |
| `<form>`              | `<View>` (no form tags)   |

### Example Conversion

**Before (Web):**
\`\`\`html
<div class="search-container">
  <input 
    type="text" 
    class="search-bar" 
    placeholder="Search..." 
    id="searchInput"
  />
  <button class="search-button" onclick="handleSearch()">
    Search
  </button>
</div>
\`\`\`

**After (React Native):**
\`\`\`jsx
<View style={styles.searchContainer}>
  <TextInput
    style={styles.searchInput}
    placeholder="Search..."
    value={searchQuery}
    onChangeText={setSearchQuery}
  />
  <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
    <Text style={styles.searchButtonText}>Search</Text>
  </TouchableOpacity>
</View>
\`\`\`

## Styling Conversions

### CSS → StyleSheet

**Before (CSS):**
\`\`\`css
.search-container {
  position: fixed;
  bottom: 20px;
  left: 90px;
  right: 20px;
  background: white;
  border-radius: 25px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  gap: 10px;
}

.search-bar {
  flex: 1;
  padding: 14px 20px;
  font-size: 16px;
  border: none;
}
\`\`\`

**After (React Native StyleSheet):**
\`\`\`javascript
const styles = StyleSheet.create({
  searchContainer: {
    position: 'absolute',
    bottom: 20,
    left: 90,
    right: 20,
    backgroundColor: 'white',
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5, // Android shadow
    flexDirection: 'row', // flex is default
    gap: 10,
  },
  searchInput: {
    flex: 1,
    padding: 14,
    paddingHorizontal: 20,
    fontSize: 16,
  },
});
\`\`\`

### Key Styling Differences

1. **Flexbox is default**: No need for `display: flex`
2. **No CSS classes**: Use `style` prop with StyleSheet objects
3. **Different property names**: 
   - `background` → `backgroundColor`
   - `border` → separate `borderWidth`, `borderColor`, etc.
   - Shorthand properties don't work (must be explicit)
4. **Shadows differ by platform**:
   - iOS: `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`
   - Android: `elevation`
5. **No CSS selectors**: Each component needs explicit styles
6. **Units**: All numbers are in density-independent pixels (no px, %, em)

## Map Implementation

### Leaflet → React Native Maps

**Before (Leaflet):**
\`\`\`javascript
const map = L.map("map").setView([39.7392, -104.9903], 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors',
}).addTo(map);

L.marker([lat, lng]).addTo(map).bindPopup("Hello!");
\`\`\`

**After (React Native Maps):**
\`\`\`jsx
<MapView
  style={{ flex: 1 }}
  initialRegion={{
    latitude: 39.7392,
    longitude: -104.9903,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  }}
  provider={PROVIDER_GOOGLE}
>
  <Marker
    coordinate={{ latitude: lat, longitude: lng }}
    title="Hello!"
  />
</MapView>
\`\`\`

### Key Differences:
- Different API structure
- Markers are components, not imperative API
- No tile layers (uses native map providers)
- Region instead of zoom levels
- Requires platform-specific configuration

## Event Handling

### DOM Events → React Native Events

| Web                    | React Native           |
|------------------------|------------------------|
| `onclick`              | `onPress`              |
| `onsubmit`             | N/A (use button press) |
| `onchange`             | `onChangeText`         |
| `addEventListener`     | Props (onPress, etc.)  |
| `onkeydown`            | `onKeyPress`           |
| `onfocus`              | `onFocus`              |
| `onblur`               | `onBlur`               |

**Before:**
\`\`\`javascript
document.getElementById('btn').addEventListener('click', handleClick);
\`\`\`

**After:**
\`\`\`jsx
<TouchableOpacity onPress={handleClick}>
  <Text>Button</Text>
</TouchableOpacity>
\`\`\`

## State Management

### Vanilla JS → React Hooks

**Before (global variables):**
\`\`\`javascript
let currentUser = null;
let pins = [];
let isPlacingPin = false;

function updateUser(user) {
  currentUser = user;
  renderUI();
}
\`\`\`

**After (React hooks):**
\`\`\`javascript
const [currentUser, setCurrentUser] = useState(null);
const [pins, setPins] = useState([]);
const [isPlacingPin, setIsPlacingPin] = useState(false);

const updateUser = (user) => {
  setCurrentUser(user);
  // UI updates automatically
};
\`\`\`

## Navigation

### DOM Manipulation → React Navigation

**Before:**
\`\`\`javascript
function openAccountPage() {
  document.getElementById('accountOverlay').classList.add('active');
}

function closeAccountPage() {
  document.getElementById('accountOverlay').classList.remove('active');
}
\`\`\`

**After:**
\`\`\`javascript
// In navigation setup
<Tab.Navigator>
  <Tab.Screen name="Map" component={MapScreen} />
  <Tab.Screen name="Account" component={AccountScreen} />
</Tab.Navigator>

// In component
navigation.navigate('Account');
\`\`\`

## File Structure

### Before (Web):
\`\`\`
VentApp/
├── index.html
├── main.js
└── styles.css
\`\`\`

### After (React Native):
\`\`\`
VentApp-RN/
├── App.js
├── package.json
├── app.json
└── src/
    ├── components/
    ├── screens/
    ├── services/
    └── constants/
\`\`\`

## Platform-Specific Code

React Native allows platform-specific code:

\`\`\`javascript
import { Platform } from 'react-native';

const styles = StyleSheet.create({
  container: {
    paddingTop: Platform.OS === 'ios' ? 20 : 0,
  },
});

// Or use Platform.select
const headerHeight = Platform.select({
  ios: 44,
  android: 56,
  web: 64,
});
\`\`\`

## Native Features

### Camera Access

**Web (browser API):**
\`\`\`javascript
navigator.mediaDevices.getUserMedia({ video: true })
\`\`\`

**React Native (Expo Camera):**
\`\`\`javascript
import * as Camera from 'expo-camera';

const { status } = await Camera.requestCameraPermissionsAsync();
\`\`\`

### Geolocation

**Web:**
\`\`\`javascript
navigator.geolocation.getCurrentPosition(callback);
\`\`\`

**React Native:**
\`\`\`javascript
import * as Location from 'expo-location';

const location = await Location.getCurrentPositionAsync({});
\`\`\`

## Modal/Overlay Patterns

**Before (CSS overlay):**
\`\`\`html
<div class="modal-overlay" id="pinModalOverlay">
  <div class="modal">
    <!-- content -->
  </div>
</div>
\`\`\`

**After (React Native Modal):**
\`\`\`jsx
<Modal
  visible={showModal}
  animationType="slide"
  transparent={true}
  onRequestClose={closeModal}
>
  <View style={styles.overlay}>
    <View style={styles.modal}>
      {/* content */}
    </View>
  </View>
</Modal>
\`\`\`

## Realtime Subscriptions

The Supabase realtime subscriptions work the same way, but are managed in useEffect hooks:

\`\`\`javascript
useEffect(() => {
  const subscription = supabase
    .channel('pins')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pins' }, 
      (payload) => {
        // Handle change
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}, []);
\`\`\`

## Common Pitfalls

1. **No `innerHTML` or `textContent`**: Must use `<Text>` components
2. **No `document.getElementById()`**: Use refs or state
3. **Can't use `window` or `document`**: Platform-specific APIs instead
4. **No CSS animations**: Use Animated API or Reanimated
5. **Different box model**: No border-box by default
6. **Forms don't exist**: No submit events, handle via buttons
7. **No `hover` states on mobile**: Use `activeOpacity` on TouchableOpacity
8. **Absolute positioning**: Works differently, often relative to parent

## Testing on Different Platforms

### Web Version:
- Open in browser
- DevTools work normally
- Responsive design with media queries

### React Native:
- iOS: Use iOS Simulator or device
- Android: Use Android Emulator or device
- Web: `expo start --web` (uses React Native Web)

Each platform may need specific testing as behavior can differ.

## Performance Considerations

1. **List rendering**: Use `FlatList` instead of `map()` for long lists
2. **Image optimization**: Use appropriate formats and sizes
3. **Minimize re-renders**: Use `React.memo`, `useMemo`, `useCallback`
4. **Native driver animations**: Enable for better performance
5. **Map optimization**: Limit number of markers, use clustering

## Next Steps for Complete Migration

Features not yet migrated:
1. Messaging/Chat system
2. Communities functionality  
3. Advanced map views (satellite, terrain)
4. Compass
5. Media upload from device (vs URL)
6. Profile editing
7. Social auth (Google, Apple, Facebook)

These would follow the same conversion patterns shown above.
