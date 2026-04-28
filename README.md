# Vent App Mobile

Vent App is a React Native/Expo mobile app for location-based social posting. Users can view and create map pins, use layers, join communities, message friends, and report issues.

## What You Need First

Install these before trying to run the app:

- **Node.js**: installs `npm`, which downloads and runs the project tools.
- **Git**: downloads the repository.
- **Android Studio** for Android emulator/device builds, or **Xcode** for iPhone simulator builds on macOS.
- **Expo development build tooling**: this app uses a custom Expo dev client, not Expo Go.
- **Project environment variables**: ask the project owner for the `.env` file and put it in the project root next to `package.json`.

The `.env` file must include the Supabase URL and anon key used by the app. Without it, login, maps data, pins, communities, and messages will not work correctly.

## First-Time Setup

1. Clone the repository:

   ```sh
   git clone https://github.com/TheVenters/VentApp_Mobile.git
   ```

2. Move into the project folder:

   ```sh
   cd VentApp_Mobile
   ```

3. Add the `.env` file to this folder.

4. Install project dependencies:

   ```sh
   npm install
   ```

## Running the App

This project uses an Expo development build. You must install that dev build on a simulator, emulator, or physical device before the Metro dev server can open the app.

## Included Android Build Files

- **Signed, universal APK**: use this for direct Android testing outside Google Play. This file can be installed on an Android phone or emulator.

To install the APK on a connected Android device or emulator:

```sh
adb install Vent-Andriod.apk
```

If the app is already installed and you want to replace it:

```sh
adb install -r Vent-Adnriod.apk
``

### Android

1. Start an Android emulator from Android Studio, or plug in an Android phone with USB debugging enabled.

2. Build and install the Android dev client:

   ```sh
   npm run android
   ```

3. Start the Metro dev server:

   ```sh
   npm start
   ```

4. Open the installed Vent development app on the device/emulator. It should connect to Metro automatically. If it does not, use the URL/QR code shown in the terminal.

## Common Commands

- `npm start`: starts Expo Metro for the custom dev client.
- `npm run start:android`: starts Metro and targets Android.
- `npm run start:clear`: starts Metro with a cleared cache.
- `npm run android`: builds and installs the Android dev client.

## Local Supabase

The app normally connects to the Supabase project named in `.env`. For local database work, Docker must be running.

```sh
./supabase/supabase.sh start
./supabase/supabase.sh status
./supabase/supabase.sh stop
```

To pull the live remote Supabase schema:

```sh
npm run db:schema:pull
```

This updates `supabase/main_schema_snapshot.sql` and writes a dated `supabase/remote_schema_schema-sync-YYYYMMDD.sql` copy.

## Notes About File Comments

Source files include comments at the top that explain what each file is responsible for. Important helper functions and screen/component entry points also have short comments explaining their role. JSON files such as `package.json`, `app.json`, and `eas.json` cannot contain comments, so their purpose is documented here instead:

- `package.json`: npm scripts, dependency list, and package metadata.
- `app.json`: Expo app configuration for name, icons, splash screen, platform settings, and plugins.
- `eas.json`: Expo Application Services build configuration.
- `tsconfig.json`: TypeScript checking settings.
