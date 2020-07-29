#!/usr/bin/env bash

set -ex

$@

find /usr/local/lib/node_modules/npm/node_modules/node-gyp/gyp/pylib/gyp/ \
    -name '*.pyc' \
    -delete

if [[ -d /app/node_modules ]]; then
    rm -rf /app/node_modules/.bin/.cache

    find /app/node_modules -type f \
        -name '.*' \
        -or -name index.html \
        -or -name bower.json \
        -or -name karma.conf.js \
        -or -iname 'README*' \
        -or -iname 'CHANGELOG*' \
        -or -iname 'HISTORY*' \
        -or -iname 'CONTRIBUTING*' \
        -or -name Makefile \
        -delete
fi

find /tmp/ -mindepth 1 -maxdepth 1 -exec rm -rf '{}' +

rm \
    /root/.config \
    /root/.cache \
    /root/.node-gyp \
    /root/.npm \
    -rf
