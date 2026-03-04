# Vent App (Mobile)

A location-based social media app for iOS, Android, and web.

---

## Development Build Workflow (No Expo Go)

This project is configured for **Expo development builds**.
Use the custom dev client, not Expo Go.

---

## Setup Instructions

### 1. Clone the Repository
git clone https://github.com/TheVenters/VentApp_Mobile.git

### 2. Navigate Into the Project Directory
cd <repo-folder-name>

Put API Key .env file in directory

### 3. Install Dependencies
`npm install`

### 4. Build and Install the Dev Client (once per platform change)
`npm run ios`
or
`npm run android`

### 5. Start the Dev Server for Development Builds
`npm start`

Optional helpers:
- `npm run start:ios`
- `npm run start:android`
- `npm run start:clear`

### 6. Open the Application

Choose one of the following options:

On a Phone or Emulator
- Launch the installed Vent development build.
- Connect to the Metro server started with `npm start`.

### 7. Local Supabase (Optional)
Local stack via Docker:
- `./supabase/supabase.sh start`
- `./supabase/supabase.sh status`
- `./supabase/supabase.sh stop`

### 8. Pull Live Remote Supabase Schema
Docker must be running.

`npm run db:schema:pull`

This updates:
- `supabase/main_schema_snapshot.sql`
- `supabase/remote_schema_schema-sync-YYYYMMDD.sql`

---

## Password Reset Smoke Test

Use a fresh OTP code from your reset email:

`npm run smoke:reset -- --email you@example.com --token 123456 --password NewPass123`

This directly calls the `reset-password-with-otp` edge function and fails fast with the backend error message.
