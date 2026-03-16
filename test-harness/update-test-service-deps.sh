#!/bin/bash
# Update SDK dist files in test service node_modules
# This is needed because test services have local copies (not symlinks)

SDK_ROOT="/c/Projects/rollgate-sdks/packages"

echo "Updating sdk-node test service dependencies..."
# sdk-core for node test service
rm -rf "$SDK_ROOT/sdk-node/test-service/node_modules/@rollgate/sdk-core/dist"
mkdir -p "$SDK_ROOT/sdk-node/test-service/node_modules/@rollgate/sdk-core/dist"
cp "$SDK_ROOT/sdk-core/dist/"* "$SDK_ROOT/sdk-node/test-service/node_modules/@rollgate/sdk-core/dist/"
cp "$SDK_ROOT/sdk-core/package.json" "$SDK_ROOT/sdk-node/test-service/node_modules/@rollgate/sdk-core/package.json"
# sdk-node for node test service
cp "$SDK_ROOT/sdk-node/dist/"* "$SDK_ROOT/sdk-node/test-service/node_modules/@rollgate/sdk-node/dist/"

echo "Updating sdk-react-native test service dependencies..."
# sdk-core for react-native test service
rm -rf "$SDK_ROOT/sdk-react-native/test-service/node_modules/@rollgate/sdk-core/dist"
mkdir -p "$SDK_ROOT/sdk-react-native/test-service/node_modules/@rollgate/sdk-core/dist"
cp "$SDK_ROOT/sdk-core/dist/"* "$SDK_ROOT/sdk-react-native/test-service/node_modules/@rollgate/sdk-core/dist/"
cp "$SDK_ROOT/sdk-core/package.json" "$SDK_ROOT/sdk-react-native/test-service/node_modules/@rollgate/sdk-core/package.json"

echo "Done!"
