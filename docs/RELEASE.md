# Releasing ShiftPay (Android)

Package: `io.github.zorrasz626.shiftpay` (permanent once on Play: never change it).
Build config lives in `app.json` and `eas.json`; `android/` is generated (CNG) and git-ignored.

## One-time setup
1. `npx eas-cli login` (Expo account).
2. `npx eas-cli init`: links the project; writes `extra.eas.projectId` and `owner` into `app.json`. Commit that.
3. RevenueCat key: `npx eas-cli env:create --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value <key> --environment production --environment preview --visibility plaintext`.
   Never commit it; `.env` is only for local runs. Without it the app runs as Free.
4. Signing: `npx eas-cli credentials -p android` → let EAS generate and keep the upload keystore.
   Back it up from the same menu (download keystore). Enrol in Play App Signing when creating the app in Play Console.

## Builds
- Test APK (sideload): `npx eas-cli build -p android --profile preview`
- Store bundle (AAB): `npx eas-cli build -p android --profile production`
- Dev client: `--profile development` needs `npx expo install expo-dev-client` first (not installed today).
- Upload: `npx eas-cli submit -p android --profile production` (needs a Play service-account key), or upload the AAB by hand.

## Versions
- `version` in `app.json` (e.g. 1.0.0) is the user-visible versionName: bump it by hand per release.
- `versionCode` is owned by EAS (`cli.appVersionSource: "remote"`); the production profile auto-increments it on every build.
  Do not set `android.versionCode` in `app.json`. To seed or inspect: `npx eas-cli build:version:get -p android` / `build:version:set`.
- Local builds (`gradlew assembleRelease`) always use versionCode 1 and the debug key: for testing only, never upload them.

## Target SDK
Expo SDK 58 / RN 0.88 defaults: compileSdk 37, targetSdk 36, minSdk 24 (from `react-native/gradle/libs.versions.toml`).
Play requires targetSdk 35+ for new apps, so no `expo-build-properties` override is needed. Re-check on each Expo SDK upgrade.

## Permissions
`android.blockedPermissions` in `app.json` removes template defaults the app does not use
(storage read/write, SYSTEM_ALERT_WINDOW, FCM push `c2dm.RECEIVE`: reminders are local notifications). Re-check the merged manifest after adding any native library.
