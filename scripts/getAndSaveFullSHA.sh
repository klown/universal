#!/bin/sh

# Copyright 2020 OCAD University
#
# Licensed under the New BSD license. You may not use this file except in
# compliance with this License.
#
# You may obtain a copy of the License at
# https://github.com/GPII/universal/blob/master/LICENSE.txt

# This script provide fetches the full SHA of the version of the gpii-univesal
# given in the short version of the SHA and then writes that version to the file
# gpii-version.json

GPII_APP_DIR=${GPII_APP_DIR:-"/app"}
GPII_APP_TAG=${GPII_APP_TAG:-""}

log() {
  echo "$(date +'%Y-%m-%d %H:%M:%S') - $1"
}

log "GPII_APP_TAG: '${GPII_APP_TAG}'"
GPII_SHORT_SHA=`echo $GPII_APP_TAG | sed -e 's/^[0-9]*-//'`
log "GPII_SHORT_SHA: '${GPII_SHORT_SHA}'"

NUM_TRIES=10
DELAY=2
for i in `seq 1 $NUM_TRIES`
do
    GPII_FULL_SHA=$(curl --silent https://api.github.com/repos/GPII/universal/commits/${GPII_SHORT_SHA} | jq -r '.sha')
    if [ "$GPII_FULL_SHA" != "null" ]; then
        break;
    fi
    sleep $DELAY
done

if [ "$GPII_FULL_SHA" = "null" ]; then
    log "Failed to retrieve full SHA"
    exit 1
fi

log "Successfully retrieved full SHA - ${GPII_FULL_SHA}"
log "Writing full SHA into ${GPII_APP_DIR}/gpii-version.json"
echo "{version: $GPII_FULL_SHA}" > "${GPII_APP_DIR}/gpii-version.json"
err=$?
if [ "$err" != '0' ]; then
    log "Failed to write gpii-version.json ($err)"
    exit $err
fi
VERSION_CONTENTS=`cat "${GPII_APP_DIR}/gpii-version.json"`
log "${VERSION_CONTENTS}"
exit $err
