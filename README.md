# Vent App - React Native

A location-based social media app converted from web to React Native, supporting both mobile (iOS/Android) and web platforms.

## Features

- 🗺️ Interactive map with location-based posts
- 📍 Create text and media pins at specific locations
- 🤝 Friends system with messaging
- 👤 User authentication with Supabase
- 🌍 Multiple map layers (Public, Friends, Private, Events)
- 📱 Cross-platform: iOS, Android, and Web

## Tech Stack

- **React Native** - Mobile app framework
- **Expo** - Development platform
- **React Native Maps** - Map functionality
- **Supabase** - Backend (auth, database, realtime)
- **React Navigation** - Navigation
- **Expo Location** - GPS/Location services
- **Expo Camera & Image Picker** - Media capture

## Setup Instructions

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Expo CLI: `npm install -g expo-cli`
- Supabase account and project

### Installation

1. **Install dependencies:**
   \`\`\`bash
   npm install
   # or
   yarn install
   \`\`\`

2. **Configure Supabase:**
   
   Open `src/services/supabase.js` and update:
   \`\`\`javascript
   const SUPABASE_URL = 'your-supabase-url';
   const SUPABASE_ANON_KEY = 'your-supabase-anon-key';
   \`\`\`

3. **Set up Supabase database:**
   
   Use the migrations from the original `/supabase/migrations` folder to set up your database schema.

### Running the App

**Start the development server:**
\`\`\`bash
npm start
# or
expo start
\`\`\`

**Run on specific platform:**
\`\`\`bash
# iOS
npm run ios
# or
expo start --ios

# Android
npm run android
# or
expo start --android

# Web
npm run web
# or
expo start --web
\`\`\`

### Google Maps API Key (Required for Android)

1. Get a Google Maps API key from [Google Cloud Console](https://console.cloud.google.com/)
2. Add to `app.json`:
   \`\`\`json
   {
     "expo": {
       "android": {
         "config": {
           "googleMaps": {
             "apiKey": "YOUR_GOOGLE_MAPS_API_KEY"
           }
         }
       }
     }
   }
   \`\`\`

## Project Structure

\`\`\`
VentApp-RN/
├── App.js                      # Main app entry with navigation
├── app.json                    # Expo configuration
├── package.json                # Dependencies
├── babel.config.js             # Babel configuration
└── src/
    ├── components/             # Reusable components
    │   ├── CustomMarker.js     # Map marker component
    │   └── PinModal.js         # Pin creation modal
    ├── screens/                # Screen components
    │   ├── MapScreen.js        # Main map view
    │   ├── AccountScreen.js    # Authentication
    │   └── FriendsScreen.js    # Friends management
    ├── services/               # Services
    │   └── supabase.js         # Supabase client
    └── constants/              # Constants
        └── theme.js            # Colors, sizes, etc.
\`\`\`

## Key Differences from Web Version

### Component Changes
- `<div>` → `<View>`
- `<span>`, `<p>` → `<Text>`
- `<button>` → `<TouchableOpacity>` or `<Pressable>`
- `<input>` → `<TextInput>`
- CSS files → StyleSheet objects

### Styling Changes
- All styles use React Native's StyleSheet API
- Flexbox is the default layout (no need for `display: flex`)
- No CSS classes or selectors
- Styles are objects, not strings
- Limited CSS properties (no `grid`, different box model)

### Map Library
- Leaflet → React Native Maps
- Different API and marker system
- Platform-specific configuration needed

### Native Features
- Camera access via `expo-camera`
- Location via `expo-location`
- Image picker via `expo-image-picker`
- Requires permission handling

### Navigation
- No React Router
- Using React Navigation (@react-navigation/native)
- Bottom tab navigation instead of sidebar menu

## TODO / Next Steps

### Not Yet Implemented (from original app):
- [ ] Messaging/Chat functionality
- [ ] Communities feature
- [ ] Multiple map view styles (satellite, terrain, etc.)
- [ ] Compass functionality
- [ ] Advanced search (geocoding)
- [ ] Media upload from device (currently URL-based)
- [ ] Profile editing
- [ ] Social login (Google, Apple, Facebook)

### Recommended Enhancements:
- [ ] Add push notifications
- [ ] Implement image caching
- [ ] Add offline support
- [ ] Implement proper error boundaries
- [ ] Add loading states
- [ ] Add analytics
- [ ] Improve map performance with clustering
- [ ] Add unit tests

## Platform-Specific Notes

### iOS
- Requires info.plist permissions (already configured in app.json)
- Maps work out of the box with Apple Maps

### Android
- Requires Google Maps API key
- Need to enable location permissions in AndroidManifest.xml

### Web
- React Native Web handles the conversion
- Maps may have limited functionality on web
- Consider fallback to Leaflet for web if needed

## Troubleshooting

**Maps not showing on Android:**
- Ensure you've added Google Maps API key to app.json
- Run `expo prebuild` to regenerate native code

**Location not working:**
- Check permissions in app settings
- On iOS simulator, go to Features → Location

**Supabase errors:**
- Verify your Supabase URL and key
- Check that tables exist in your database
- Ensure RLS policies are configured correctly

## Building for Production

\`\`\`bash
# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android

# Build for Web
expo build:web
\`\`\`

Note: You'll need an Expo account and EAS CLI for production builds.

## License

Same as original project

## Support

For issues or questions, please refer to:
- [React Native Documentation](https://reactnative.dev/)
- [Expo Documentation](https://docs.expo.dev/)
- [Supabase Documentation](https://supabase.io/docs)
