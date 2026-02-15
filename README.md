# Vent App (Mobile)

A location-based social media app designed for mobile devices.

---

## How to Test the App

You can run the app on a physical phone using Expo Go or on a mobile emulator.

---

## Setup Instructions

### 1. Clone the Repository
git clone https://github.com/TheVenters/VentApp_Mobile.git

### 2. Navigate Into the Project Directory
cd <repo-folder-name>

Put API Key .env file in directory

### 3. Start supabase
supabase start

### 4. Start the Expo Development Server
npm install


npx expo start --tunnel


### 5. Open the Application

Choose one of the following options:

On a Phone (Recommended)
- Install Expo Go from the App Store or Google Play Store
- Scan the QR code shown in the terminal or browser

On an Emulator
- Launch your iOS Simulator or Android Emulator
- Download and launch Expo Go on the emulator
- Enter the URL returned by npx expo start

---

## Password Reset Smoke Test

Use a fresh OTP code from your reset email:

`npm run smoke:reset -- --email you@example.com --token 123456 --password NewPass123`

This directly calls the `reset-password-with-otp` edge function and fails fast with the backend error message.
