#!/bin/bash
echo "Pushing without hooks..."
git push --no-verify "$@"